# SportSnap

Ứng dụng nhận diện môn thể thao qua ảnh, sử dụng FastAPI và React + TypeScript.
Slice 3 cung cấp camera quét đa khung hình, chọn một ảnh từ thư viện và kết quả nhận diện.

## Run it

Yêu cầu: Python 3.12 và Node.js 24 (kèm npm). Các lệnh dưới đây dùng PowerShell,
bắt đầu từ thư mục gốc của dự án.

### Backend

```powershell
Copy-Item .env.example .env
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Nếu PowerShell không cho phép kích hoạt môi trường, dùng trực tiếp
`.\.venv\Scripts\python.exe -m pip install -r requirements.txt` và
`.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000`.

Đặt hai tệp do nhóm cung cấp tại `backend/models/best_model.keras` và
`backend/models/labels.json`. Hai tệp này không được đưa vào Git; không sửa đổi,
chuyển đổi hoặc huấn luyện lại. Backend vẫn khởi động khi chưa có một trong hai tệp.

Kiểm tra tại [trạng thái API](http://localhost:8000/api/health).
Khi có mô hình hợp lệ, API trả `model_loaded: true` và số lớp đọc từ tệp nhãn.
Khi thiếu tệp, API trả HTTP 200:

```json
{"status":"ok","model_loaded":false,"num_classes":0,"preprocess":"mobilenet_v2","reason":"model_missing"}
```

Nếu tệp không đọc được, mô hình lỗi hoặc nhãn không hợp lệ, backend vẫn chạy và
trả `model_loaded: false, reason: "model_load_failed"`. Chi tiết lỗi chỉ có trong log backend.
`status: "ok"` cho biết API đang hoạt động; `model_loaded` cho biết mô hình đã sẵn sàng hay chưa.

`GET /api/classes` trả danh sách nhãn theo đúng thứ tự huấn luyện (danh sách rỗng
khi mô hình chưa sẵn sàng). Gửi một ảnh bằng trường multipart `file`:

```powershell
curl.exe -X POST http://localhost:8000/api/predict -F "file=@path/to/photo.jpg"
```

API nhận JPEG, PNG và WebP, mặc định tối đa 12 MB mỗi ảnh. Kết quả gồm `label`,
`confidence`, `top3`, `is_uncertain`, `threshold` và `latency_ms`.
`confidence < CONFIDENCE_THRESHOLD` (mặc định 0.60) trả `is_uncertain: true`.
`POST /api/scan` nhận từ 2 đến 6 khung hình trong các trường multipart `files`
lặp lại. Kết quả lấy trung bình toàn bộ vector xác suất, kèm `per_frame` và
`agreement` (tỷ lệ khung hình có nhãn đứng đầu trùng nhãn kết quả):

```powershell
curl.exe -X POST http://localhost:8000/api/scan -F "files=@path/to/frame-1.jpg" -F "files=@path/to/frame-2.jpg"
```

Thiếu hoặc thừa khung hình trả 400 `bad_request`. Một khung hình hỏng hoặc
không hợp lệ làm toàn bộ lượt quét thất bại; không bỏ qua khung hình lỗi.
Lỗi trả `{"error":{"code":"...","message":"..."}}` với thông báo tiếng Việt:
415 `unsupported_format`, 422 `invalid_image`, 413 `file_too_large`,
503 `model_not_loaded`; thiếu trường ảnh hoặc multipart không hợp lệ trả
400 `bad_request`. Lỗi suy luận trả 500 `internal_error`, không lộ chi tiết nội bộ.

`.env` được đọc từ thư mục gốc dù chạy lệnh trong `backend/`. `BASE_DIR` mặc định
là thư mục gốc; các đường dẫn tương đối trong `.env` được tính từ `BASE_DIR`.
Giữ `PREPROCESS=mobilenet_v2` theo notebook huấn luyện. Các giới hạn mặc định nằm trong `.env.example`.
TensorFlow được cố định ở phiên bản `2.20.0`; nếu cài đặt thất bại, dừng và báo lỗi.

### Frontend khi phát triển

Mở terminal thứ hai tại thư mục gốc, giữ backend đang chạy:

```powershell
cd frontend
npm install
npm run dev
```

Mở [SportSnap](http://localhost:5173). Vite chuyển tiếp `/api` tới
`http://localhost:8000`. Trang Quét mở camera sau khi được cấp quyền, ưu tiên camera
sau. Bấm **Quét đa khung hình** để chụp 4 khung hình cách nhau khoảng 300 ms và
gửi tới `/api/scan`. Khung hình được thu nhỏ tối đa 640 px, JPEG chất lượng 0.85.
Để giữ toàn bộ payload dưới 1,5 MB (có chừa dung lượng cho multipart), ứng dụng lần
lượt giảm chất lượng xuống 0.75, 0.65, 0.55, giảm cạnh tối đa xuống 512 px, rồi
giảm còn 3 hoặc tối thiểu 2 khung hình; nếu vẫn quá lớn sẽ báo lỗi trước khi gửi.
Kết quả hiển thị nhãn gốc từ API, độ tin cậy, ba dự đoán hàng đầu, độ đồng thuận
và cảnh báo màu hổ phách khi không chắc chắn.

Chọn **Thư viện** hoặc **Chọn ảnh từ thư viện** để gửi một ảnh tới `/api/predict`.
Có thể quay lại camera, chọn ảnh khác hoặc thử lại khi có lỗi. Camera dừng khi
hiện kết quả, chuyển sang thư viện, rời trang hoặc đưa ứng dụng xuống nền;
bấm mở lại camera để tiếp tục. Lỗi quyền truy cập, thiếu camera, kết nối không
an toàn, ảnh không hợp lệ, mô hình chưa sẵn sàng và lỗi mạng đều có thông báo tiếng Việt.
Giao diện sáng/tối theo hệ thống. Hai trang Hàng loạt và Phân tích hiện là trang chờ.

Trên Android Chrome và iOS Safari, mở ứng dụng qua HTTPS để dùng camera;
HTTP chỉ hỗ trợ camera khi chạy ở localhost. Địa chỉ HTTP LAN sẽ hiển thị hướng
dẫn dùng HTTPS hoặc chọn ảnh từ thư viện. Kiểm tra trên điện thoại: cấp/từ chối
quyền camera, quét bằng camera sau, xem tiến độ 4 khung hình, độ đồng thuận,
quay lại camera và chuyển sang chọn ảnh. Nút xem vùng AI chú ý hiện là nút chờ; AR triển khai
ở Slice 5. Chỉ hiện nút AR khi có đủ cặp `.glb`/`.usdz` do nhóm cung cấp tại
`frontend/public/models3d/` và nhãn tương ứng trong `src/lib/sports3d.ts`
(`football`, `basketball`, `golf`). Thêm tệp trước khi chạy Vite/build lại.
Không tải tài nguyên 3D từ bên ngoài.

### Chạy bản build trên một cổng

```powershell
cd frontend
npm run build
cd ../backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Build frontend trước khi khởi động backend (hoặc khởi động lại backend sau khi build).
FastAPI phục vụ `frontend/dist` tại [trang chủ](http://localhost:8000/),
đồng thời giữ API tại `/api`. Khi chưa build frontend, API vẫn chạy bình thường.

### Kiểm tra

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
cd ../frontend
npx tsc --noEmit
npm run build
npm test
```

Bộ kiểm tra xác nhận trạng thái, suy luận, tiền xử lý, EXIF, ngưỡng không chắc chắn,
định dạng ảnh, ảnh hỏng, giới hạn dung lượng, CORS và phục vụ frontend.
Các kiểm tra đa khung hình xác nhận trung bình xác suất (khác bỏ phiếu đa số),
độ đồng thuận, ngưỡng không chắc chắn, giới hạn 2–6 khung hình và các lỗi API.
`npm test` kiểm tra chụp/cancel, khoảng cách khung hình, từng bước giảm dung lượng,
thông báo lỗi camera, gọi API và bộ kiểm tra nền canvas hiện có.
Golden test là điều kiện bắt buộc: cần hai tệp mô hình gốc và bộ ảnh trong
`backend/tests/golden/`; thiếu dữ liệu sẽ báo lỗi thay vì bỏ qua.
Bộ golden ban đầu gồm tám ảnh mẫu tổng hợp với kết quả thực từ mô hình,
được cho phép dùng làm mốc hồi quy khi chưa có ảnh xuất từ notebook.
Bộ này chưa xác nhận độ chính xác trên ảnh thể thao hoặc tính tương đương với
notebook. Xem `backend/tests/golden/README.md` để tạo bộ ứng viên từ dữ liệu kiểm thử.
Trên checkout chưa có mô hình, vẫn chạy backend như trên; có thể kiểm tra riêng
phần không cần mô hình bằng `python -m pytest -q --ignore=tests/golden`.

Xem [SPEC.md](SPEC.md) và [AGENTS.md](AGENTS.md) để biết phạm vi từng slice.
