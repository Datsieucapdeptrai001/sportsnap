# SportSnap Smart Photo Library — Engineering Decisions (`docs/DECISIONS.md`)

Tài liệu này ghi nhận mọi quyết định kiến trúc và giả định kỹ thuật được đưa ra trong quá trình mở rộng SportSnap thành Smart Photo Library trên CPU (Windows 11, Python 3.12.3).

---

## 1. Mô hình mặc định & Bảo toàn bộ test cũ (Phase 0)

- **Quyết định:** Sử dụng **ResNet50** (`D:\tgmt\models\ResNet50_finetune_best.keras`, 276.9 MB, `PREPROCESS=resnet50`) và bộ **20 lớp mới** (`D:\tgmt\models\labels.json`) làm mô hình phục vụ mặc định (`.env` và `data/models_registry/v1/`).
- **Lý do & Bối cảnh:**
  - Người dùng xác nhận chuyển sang dùng ResNet50.
  - `backend/models/best_model.keras` (26.3 MB) và `backend/models/labels.json` chứa bộ 20 lớp cũ (khớp với `backend/tests/golden/expected.json`), và phải giữ `< 50 MB` không sửa đổi theo `SPEC.md` / `AGENTS.md`.
  - `D:\tgmt\datasets\sports-classification\` (`train`/`valid`/`test`) và `D:\tgmt\datasets\anh-ngoai\` sử dụng bộ 20 lớp mới (`archery`, `boxing`, `tennis`, `volleyball` thay cho `figure skating pairs`, `nascar racing`, `rings`, `rugby`).
- **Cách tách biệt an toàn:**
  - `D:\tgmt\models/` và `D:\tgmt\datasets/` và `backend/models/` được giữ **read-only tuyệt đối**.
  - Bản sao `v1` được đăng ký vào `data/models_registry/v1/` để khởi đầu vòng đời MLOps/retrain.
  - `backend/tests/golden/test_golden.py` khởi tạo `Settings(_env_file=None)` để luôn kiểm thử đúng bộ `backend/models/` đã commit, độc lập với `.env` phục vụ ResNet50.

---

## 2. Phiên bản TensorFlow & Môi trường Python

- **Quyết định:** Giữ nguyên **`tensorflow==2.20.0`** (và `tensorflow-cpu==2.20.0` cho Linux/Docker) trong `backend/.venv` (Python 3.12.3).
- **Lý do:** `backend/requirements.txt` và `SPEC.md` đã ghim `2.20.0`, toàn bộ 156 unit/golden test hiện có hoạt động ổn định, và checkpoint `ResNet50_finetune_best.keras` đạt Parity **1.000 (100/100)** trên TF `2.20.0`.

---

## 3. Tối ưu suy luận ResNet50 trên CPU

- **Số liệu đo thực tế (`scripts/parity_check.py`, CPU Intel64 Model 165, 8 threads):**
  - `load_seconds`: **2.481 s**
  - `eager model.predict` (batch 1): **130.95 ms/ảnh**
  - `@tf.function` (batch 1): **70.16 ms/ảnh** (nhanh hơn **1.87×**)
  - `@tf.function` (batch 32): **38.93 ms/ảnh** (nhanh hơn **3.36×**, 1.000 ảnh ~39 giây)
  - Sai khác xác suất tối đa giữa eager và `@tf.function`: **0.0**
- **Quyết định:** Dùng `@tf.function` + batching (`batch_size=32`) cho pipeline nạp ảnh nền (`ingest.py`) ở Phase 1 để giữ thời gian nạp 1.000 ảnh trên CPU trong mức vài phút.

---

## 4. Lựa chọn CLIP Embedder (`scripts/spike_clip.py`)

Đo cùng trên 20 ảnh đại diện của 20 lớp từ `datasets/sports-classification/test` và 10 truy vấn văn bản, cache ấm trên CPU:

| Tiêu chí | (a) `fastembed` `0.9.1` (ONNX Runtime) | (b) `open_clip` `4.2.2` (PyTorch CPU `2.15.0`) |
| :--- | :---: | :---: |
| Model | `Qdrant/clip-ViT-B-32-vision` + `-text` | `ViT-B-32` (`laion2b_s34b_b79k`) |
| Số chiều (dim) | 512 (L2-normalized) | 512 (L2-normalized) |
| Load + warmup (cache ấm) | **1.57 s** | 2.79 s |
| Tốc độ ảnh (`ms/ảnh`) | **33.55 ms** | 49.48 ms |
| Tốc độ text (`ms/truy vấn`) | **3.46 ms** | 42.80 ms |
| RAM tăng thêm (RSS delta) | **644.8 MB** | 679.2 MB |
| Dung lượng gói site-packages | **~46.4 MB** (`fastembed` 0.9 + `onnxruntime` 45.5 MB) | **~757.9 MB** (`torch` 513.5 MB + `timm` + `torchvision`...) |

- **Quyết định:** Chọn **`fastembed` (ONNX Runtime)** qua interface `Embedder` (`sportsnap_lib/embedder.py`).
- **Lý do:** Nhanh hơn ở cả xử lý ảnh (~1.47×) lẫn truy vấn văn bản (~12.4×), thời gian load lạnh nhanh hơn, không cần kéo theo PyTorch > 500 MB vào môi trường TensorFlow, tránh xung đột dependency. Có thể hoán đổi sang `open_clip` bất kỳ lúc nào nhờ lớp trừu tượng `Embedder`.

---

## 5. Lựa chọn Vector Index (`sportsnap_lib/vector_index.py`)

Đo thực tế trên `N = 10.000` vector ngẫu nhiên `float32` 512 chiều chuẩn hóa L2:
- `NumpyVectorIndex` (brute-force dot product): add **17.95 ms**, search top-24 **1.82 ms**.
- `FaissVectorIndex` (`faiss-cpu==1.16.0`, `IndexFlatIP`): add **36.71 ms**, search top-24 **2.68 ms**.
- **Quyết định:** Dùng **`NumpyVectorIndex`** làm mặc định (đã cài thêm `faiss-cpu==1.16.0` thành công trên Windows/Python 3.12 và giữ sẵn `FaissVectorIndex` sau interface `VectorIndex` để nâng cấp nếu thư viện vượt quá 50.000 ảnh). NumPy nhanh hơn ở quy mô `< 50k` ảnh, hỗ trợ lọc theo tập `allowed_ids` trực tiếp và tránh rủi ro đường dẫn Unicode trên Windows khi lưu/đọc file index C++.

---

## 6. Ghi chú cho Phase 3 (Fine-tune ResNet50 trên CPU)

- Do hệ thống dùng `ResNet50_finetune_best.keras` thay cho MobileNetV2, bước retrain ở Phase 3 sẽ mở khóa **~50 lớp cuối của backbone `resnet50`** (nhóm `conv5_block*`, khớp với cấu hình huấn luyện trong `SportSnap_02_ThiNghiem_BoSung_Muc12.ipynb`), đóng băng toàn bộ lớp `BatchNormalization` và dùng `resnet50.preprocess_input`.
