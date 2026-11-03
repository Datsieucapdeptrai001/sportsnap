# SportSnap

Ứng dụng nhận diện môn thể thao qua ảnh, sử dụng FastAPI và React + TypeScript.
Slice 2 cung cấp trang Quét một ảnh, kết quả nhận diện và điều hướng trên điện thoại/máy tính.

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
`http://localhost:8000`. Tại trang Quét, chọn một ảnh để gửi tới `/api/predict`.
Trang hiển thị ảnh xem trước, trạng thái tải, kết quả và các lỗi bằng tiếng Việt.
Kết quả có nhãn gốc từ API, độ tin cậy, ba dự đoán hàng đầu và cảnh báo màu hổ phách
khi không chắc chắn. Có thể chọn ảnh khác, xóa ảnh hoặc thử lại khi có lỗi.
Giao diện sáng/tối theo hệ thống. Hai trang Hàng loạt và Phân tích hiện là trang chờ.

Trên Android Chrome, mở ứng dụng qua HTTPS để kiểm tra trình chọn ảnh/chụp ảnh
của điện thoại; không dùng địa chỉ HTTP LAN để nghiệm thu HTTPS. Live camera
được triển khai ở Slice 3. Nút xem vùng AI chú ý hiện là nút chờ; AR triển khai
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
```

Bộ kiểm tra xác nhận trạng thái, suy luận, tiền xử lý, EXIF, ngưỡng không chắc chắn,
định dạng ảnh, ảnh hỏng, giới hạn dung lượng, CORS và phục vụ frontend.
Golden test là điều kiện bắt buộc: cần hai tệp mô hình gốc và bộ ảnh trong
`backend/tests/golden/`; thiếu dữ liệu sẽ báo lỗi thay vì bỏ qua.
Bộ golden ban đầu gồm tám ảnh mẫu tổng hợp với kết quả thực từ mô hình,
được cho phép dùng làm mốc hồi quy khi chưa có ảnh xuất từ notebook.
Bộ này chưa xác nhận độ chính xác trên ảnh thể thao hoặc tính tương đương với
notebook. Xem `backend/tests/golden/README.md` để tạo bộ ứng viên từ dữ liệu kiểm thử.
Trên checkout chưa có mô hình, vẫn chạy backend như trên; có thể kiểm tra riêng
phần không cần mô hình bằng `python -m pytest -q --ignore=tests/golden`.

Xem [SPEC.md](SPEC.md) và [AGENTS.md](AGENTS.md) để biết phạm vi từng slice.
