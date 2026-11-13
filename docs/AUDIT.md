# SportSnap — System Audit (`docs/AUDIT.md`)

Ngày kiểm toán: 2026-11-12  
Gốc dự án: `D:\tgmt`  
Nhánh làm việc: `feat/smart-photo-library`

---

## 1. Tech Stack hiện tại

- **Hệ điều hành & Runtime (CPU-only):** Windows 11, Python 3.12.3, Node.js 24 (`npm`).
- **Backend:** FastAPI `0.162.0`, Uvicorn `0.54.0`, Pydantic `2.14.2`, pydantic-settings `2.16.2`, TensorFlow `2.20.0` (Windows: `tensorflow==2.20.0`, Linux/Docker: `tensorflow-cpu==2.20.0`), NumPy `2.5.4`, Pillow `13.0.0`, python-multipart `0.0.33`, httpx `0.28.1`, pytest `9.2.0`.
- **Frontend:** React `19.3.1`, TypeScript `5.9`, Vite `8.3.5`, Tailwind CSS `4.3.4`, `lucide-react`, `sonner`, `@google/model-viewer` `4.4.0`.
- **Kiểm thử hiện có:**
  - Backend: `cd backend && .\.venv\Scripts\python.exe -m pytest -q`
  - Frontend: `cd frontend && npm test` (`node --test tests/*.test.mjs`), `npx tsc --noEmit`, `npm run build`

---

## 2. Cấu trúc thư mục (`D:\tgmt`)

```text
D:\tgmt\
├── backend\
│   ├── app\
│   │   ├── main.py              # Entry point FastAPI, lifespan load model, mount frontend/dist tại "/"
│   │   ├── schemas.py           # Pydantic models cho mọi request/response
│   │   ├── core\config.py       # Settings (pydantic-settings), đọc .env tại PROJECT_ROOT
│   │   ├── core\errors.py       # APIError chuẩn hóa {"error":{"code","message"}}
│   │   ├── api\scan.py          # GET /api/health, GET /api/classes, POST /api/predict, POST /api/scan
│   │   ├── api\bulk.py          # POST /api/bulk, GET /{id}, /results, /thumb, /image, /download, DELETE
│   │   ├── api\insights.py      # GET /api/insights, /insights/files/{name}, POST /api/explain (/gradcam)
│   │   └── services\
│   │       ├── inference.py     # preprocess_image, predict_image, predict_frames
│   │       ├── gradcam.py       # build_gradcam_graph (out_relu / conv5_block3_out), explain_image
│   │       └── bulk_job.py      # BulkJobStore (threadpool, batch 32, ZIP export, TTL 30 phút)
│   ├── models\                  # best_model.keras (26.3 MB, MobileNetV2 20 lớp cũ), labels.json (tracked in Git)
│   ├── data\                    # experiments.json, summary.csv, insights\cm.png
│   ├── scripts\                 # build_experiments.py, compare_models.py, cam_compare.py
│   ├── tests\                   # golden tests + API/unit tests
│   └── requirements.txt
├── frontend\
│   ├── public\models\           # 24 mô hình 3D .glb + manifest.json
│   ├── src\
│   │   ├── App.tsx              # 3 tab hiện tại: Quét (scan), Phân loại hàng loạt (bulk), Phân tích (insights)
│   │   ├── lib\api.ts           # Toàn bộ HTTP client gọi /api/*
│   │   ├── lib\sport-names.ts   # Tên hiển thị tiếng Việt cho 24 nhãn (20 cũ + 4 mới)
│   │   ├── pages\               # scan.tsx, bulk.tsx, insights.tsx
│   │   └── components\          # camera-scanner, prediction-card, sport-ar-button, explain-button...
│   └── tests\                   # 8 file *.test.mjs
├── models\                      # Read-only checkpoints từ notebook (MobileNetV2, ResNet50, CNN_Scratch, labels.json 20 lớp mới)
├── datasets\                    # Read-only (sports-classification\train|valid|test & anh-ngoai\)
├── docs\                        # ASSETS.md, SPORT_CANVAS_BACKGROUND.md
├── .env.example / .env.resnet   # Cấu hình mẫu
├── Dockerfile / docker-compose.yml
└── README.md / SPEC.md / AGENTS.md
```

---

## 3. Cách khởi chạy hiện tại

- **Backend (từ `D:\tgmt\backend`):**
  ```powershell
  .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
  ```
- **Frontend dev (từ `D:\tgmt\frontend`):**
  ```powershell
  npm run dev   # Proxy /api -> http://localhost:8000
  ```
- **Production build:** `npm run build` xuất `frontend/dist`, được FastAPI phục vụ trực tiếp tại `/`.

---

## 4. Cách nạp mô hình & Tiền xử lý (Model Loading & Preprocessing)

1. **Nạp mô hình (`backend/app/main.py`):**
   - Trong `lifespan()`, gọi `load_keras_model(config.MODEL_PATH)` sử dụng `tensorflow.keras.models.load_model(path, compile=False)` (import lazy).
   - Kiểm tra `model.output_shape[-1] == len(labels)`.
   - Giữ `application.state.model`, `application.state.labels`, và `application.state.model_lock = Lock()` dùng chung cho cả `/predict`, `/scan`, `/explain`, `/bulk`.
2. **Tiền xử lý (`backend/app/services/inference.py` — `preprocess_image`):**
   - Kiểm tra định dạng (`JPEG`, `PNG`, `WEBP`) và chống decompression bomb.
   - `ImageOps.exif_transpose(source).convert("RGB")` → sửa hướng xoay EXIF từ điện thoại.
   - `image.resize((224, 224), Image.BILINEAR)` → kéo giãn vừa 224×224 không cắt cúp (khớp `image_dataset_from_directory` của notebook).
   - Chuyển sang `np.float32` miền `[0, 255]`.
   - Tùy `config.PREPROCESS`:
     - `"mobilenet_v2"`: `tf.keras.applications.mobilenet_v2.preprocess_input` (chuẩn hóa về `[-1, 1]`).
     - `"resnet50"`: `tf.keras.applications.resnet50.preprocess_input` (RGB → BGR và trừ trung bình ImageNet theo kênh, không chia 255).
3. **Grad-CAM (`backend/app/services/gradcam.py`):**
   - Tự động tìm lớp cuối của mạng nền (`"out_relu"` cho MobileNetV2, `"conv5_block3_out"` cho ResNet50, fallback `Conv2D` cuối).
4. **Phân loại hàng loạt (`backend/app/services/bulk_job.py`):**
   - Nhận tối đa `MAX_BULK_FILES=2000` ảnh hoặc 1 file `.zip`, xử lý bất đồng bộ theo batch 32 trong `ThreadPoolExecutor`, phân thư mục theo nhãn slugified + `chua_chac_chan/` (`confidence < CONFIDENCE_THRESHOLD`) + `loi/`, xuất `report.csv` và stream `sportsnap_result.zip`.

---

## 5. Phát hiện quan trọng khi kiểm toán (Audit Findings)

- **Hai bộ nhãn 20 lớp:**
  - `backend/models/best_model.keras` + `backend/models/labels.json` chứa **20 lớp cũ** (có `figure skating pairs`, `nascar racing`, `rings`, `rugby`) và được gắn với `backend/tests/golden/expected.json`.
  - `D:\tgmt\models\ResNet50_finetune_best.keras` (276.9 MB / 264.1 MiB), `D:\tgmt\models\MobileNetV2_finetune_best.keras` (26.3 MB) + `D:\tgmt\models\labels.json` chứa **20 lớp mới** (`archery`, `boxing`, `tennis`, `volleyball` thay cho 4 lớp cũ), khớp hoàn toàn với `D:\tgmt\datasets\sports-classification\` và `D:\tgmt\datasets\anh-ngoai\`.

---

## 6. Chẩn đoán chi tiết sự cố mô hình & Sự cố trang Phân tích

### 6.1 Sự cố mô hình mặc định (ResNet50 205.2 MB vs 276.9 MB)
- **Hiện tượng:** Web ban đầu chọn sẵn "ResNet50 · 20 môn mới". Khi tải ảnh bắn cung (`archery`) rõ nét, hệ thống trả về `golf` với xác suất chỉ 21%, gây ấn tượng hệ thống bị hỏng.
- **Chẩn đoán nguyên nhân:**
  1. Kiểm tra kích thước tệp mô hình trên ổ đĩa:
     - `D:\tgmt\data\models_registry\v1\ResNet50_finetune_best.keras`: **215,143,411 bytes (~205.2 MB)**.
     - `D:\tgmt\models\ResNet50_finetune_best.keras`: **276,884,226 bytes (~276.9 MB / 264.1 MiB)**.
     - File 205.2 MB là bản export dở dang / lệch phiên bản checkpoint, có thứ tự lớp hoặc tiền xử lý không khớp danh sách nhãn.
     - Thêm vào đó, nếu áp dụng tiền xử lý `mobilenet_v2` (chia [-1, 1]) thay vì tiền xử lý chuẩn `resnet50` (RGB -> BGR và trừ mean ImageNet theo kênh), độ chính xác của ResNet50 sụt giảm nghiêm trọng (< 20%).
  2. Đo đạc thực nghiệm trên tập Test (100 ảnh):
     - `legacy_mobilenet_v2`: **97.0%** (Valid: **98.0%**, External: **81.0%**, Latency: **452.7 ms** trên CPU laptop).
     - `resnet50_finetune` (276.9 MB, đúng tiền xử lý): Test **100.0%**, Valid **97.0%**, External **79.0%**, Latency **859.6 ms**.
  3. **Kết luận giải pháp:**
     - Thiết lập Model Manifest độc lập (`backend/app/models_config.py`), cô lập rõ ràng đường dẫn file, nhãn (`labels_rel_path`), phương thức tiền xử lý (`preprocess`), nhiệt độ `temperature` và ngưỡng tự tin (`tau_high`, `tau_low`).
     - Tự động chọn `legacy_mobilenet_v2` làm mô hình mặc định dựa trên quy tắc 4 bậc (Validation & External Accuracy cao nhất, độ trễ nhanh gấp đôi, nhẹ 9.7 MB, tối ưu cho CPU).

### 6.2 Chẩn đoán lỗi "Không thể tải dữ liệu thí nghiệm" trên trang Phân tích
- **Hiện tượng:** Người dùng truy cập tab "Phân tích" gặp thông báo lỗi: *"Không thể tải dữ liệu thí nghiệm. Kiểm tra kết nối và thử lại."*
- **Kiểm tra thực nghiệm (Investigation & Verification):**
  1. Kiểm tra việc nạp tệp `backend/data/experiments.json` bằng Pydantic model `InsightsResponse`:
     ```python
     settings = Settings()
     text = settings.EXPERIMENTS_PATH.read_text(encoding="utf-8") # 22,039 bytes
     res = InsightsResponse.model_validate_json(text)
     # KẾT QUẢ: Thành công 100%, load đủ 3 model (CNN_Scratch, MobileNetV2, ResNet50) và các split.
     ```
  2. Bắt nguồn chuỗi lỗi từ client:
     - Trong `frontend/src/lib/api.ts` (hàm `getInsights`):
       ```typescript
       const response = await fetch('/api/insights', { signal })
       if (!response.ok) throw new Error('Không thể tải dữ liệu thí nghiệm. Vui lòng thử lại.')
       ```
     - Khi giao diện dev của Vite (`localhost:5173`) proxy sang FastAPI (`localhost:8000`), nếu backend chưa khởi động xong hoặc bị gián đoạn kết nối, fetch kích hoạt `TypeError: Failed to fetch`. Lỗi này bị khối `catch` bắt lại và ném ra thông báo tiếng Việt: *"Không thể tải dữ liệu thí nghiệm. Kiểm tra kết nối và thử lại."*
     - Ngoài ra, việc hiển thị trang phân tích thí nghiệm (nghiên cứu) cho người dùng cuối là không phù hợp ngữ cảnh sản phẩm.
  3. **Biện pháp khắc phục:**
     - Thêm logging chi tiết kèm traceback (`logger.exception`) trong `backend/app/api/insights.py` để ghi nhận ngay lập tức bất kỳ lỗi I/O hay validation nào.
     - Ẩn hoàn toàn tab "Phân tích" trong User Mode (chỉ hiển thị khi bật Chế độ Nhà phát triển).
     - Đảm bảo endpoint `/api/insights` hoạt động ổn định và hỗ trợ header `X-Dev-Token`.

---

## 7. Kiến trúc Developer Mode & Kiểm soát Bảo mật (Dev Mode Gating)

1. **Bảo mật Dev Token:**
   - Cấu hình qua biến môi trường `DEV_TOKEN` trong `.env` (thông qua `pydantic-settings`).
   - Tuyệt đối không hardcode mật khẩu mặc định (nếu `DEV_TOKEN` không được đặt, dev mode trên máy chủ bị vô hiệu hóa hoàn toàn).
   - Truyền token qua HTTP Header chuẩn: `X-Dev-Token`.
   - Kiểm tra token bằng thuật toán so sánh thời gian không đổi: `hmac.compare_digest` để chống tấn công kênh thời gian (timing attacks).
2. **Chặn can thiệp trái phép vào mô hình:**
   - Chặn người dùng chưa xác thực thay đổi mô hình qua query param `model_id` tại `/api/predict`, `/api/scan`, `/api/bulk` (trả về lỗi HTTP 403 Forbidden).
   - Chặn gọi `/api/models/select`, `/api/models/compare` và `/api/models/verification` nếu không có `X-Dev-Token` hợp lệ.
   - Endpoint `GET /api/models`:
     - Ở User Mode: Chỉ trả về duy nhất mô hình mặc định đã kiểm chứng (`legacy_mobilenet_v2`).
     - Ở Dev Mode: Trả về đầy đủ danh sách 6 mô hình kèm trạng thái kiểm chứng.
3. **Trải nghiệm Người dùng (User-Oriented):**
   - Ẩn bộ chọn mô hình `ModelSelector` ở đầu trang Quét và Phân loại hàng loạt khi ở chế độ người dùng.
   - Ẩn bảng so sánh 6 mô hình `ModelCompareCard` sau mỗi lượt quét.
   - Giữ nguyên nền động thể thao `SportCanvasBackground` (60fps, GPU/Canvas nhẹ) và tính năng xem mô hình 3D AR WebXR (`SportViewer`).
   - Phím tắt mở Dev Mode tiện lợi cho giảng viên/nhà phát triển: `Ctrl + Shift + D` hoặc nhấp đúp vào logo SportSnap.
- **Mô hình mặc định mới (theo yêu cầu người dùng):** Sử dụng **ResNet50** (`models/ResNet50_finetune_best.keras`, `models/labels.json`, `PREPROCESS=resnet50`), trong khi vẫn giữ nguyên `backend/models/` ở trạng thái read-only để bảo vệ golden tests.
