# SportSnap

Ứng dụng nhận diện môn thể thao qua ảnh, sử dụng FastAPI và React + TypeScript.
Slice 0 cung cấp khung ứng dụng và kiểm tra trạng thái; các tính năng nhận diện được triển khai ở các slice sau.

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
`http://localhost:8000`. Trang hiển thị trạng thái kết nối và mô hình bằng tiếng Việt.
Chưa có chức năng tải ảnh hoặc suy luận ở Slice 0.

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

Bộ kiểm tra xác nhận khởi động khi thiếu từng tệp, lỗi tải mô hình, tải một lần,
CORS và phục vụ frontend. Kiểm tra tích hợp dùng mô hình thật khi hai tệp có sẵn;
trên checkout chưa có mô hình, chỉ kiểm tra tích hợp này được bỏ qua.

Xem [SPEC.md](SPEC.md) và [AGENTS.md](AGENTS.md) để biết phạm vi từng slice.
