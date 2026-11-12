# AUDIT — Inference pipeline (read-only)

Ngày audit: 2026-11-12 · Branch: `dat` @ `478c151` · Không sửa file nào ngoài file này.

Đối chiếu với notebook (theo brief): **MobileNetV2, `preprocess_input` → [-1, 1], RGB 224×224,
nhãn đọc từ file JSON, thứ tự nhãn = alphabetical.**

Ký hiệu: ✅ khớp notebook · ⚠️ nghi lệch / cần lưu ý · 🟦 chỉ là vấn đề hiển thị (UI), không ảnh hưởng inference.

## Tóm tắt

Không tìm thấy lỗi nào làm sai kết quả so với notebook. Model, nhãn, preprocess và ngưỡng đều nằm ở backend
và khớp hợp đồng. Các điểm ⚠️ là **lệch so với SPEC** hoặc **lệch có chủ đích đã ghi trong SPEC**, không phải
lệch so với notebook. Frontend không tự tính ngưỡng, không đọc nhãn cứng, không preprocess pixel cho model.

## 1. Nạp model và nhãn

| # | Vị trí | Hành vi | Đánh giá |
|---|---|---|---|
| 1.1 | [backend/app/core/config.py:17-19](backend/app/core/config.py:17) | `MODEL_PATH=backend/models/best_model.keras`, `LABELS_PATH=backend/models/labels.json`, `PREPROCESS="mobilenet_v2"` (Literal, không có lựa chọn khác) | ✅ |
| 1.2 | [backend/app/main.py:48-60](backend/app/main.py:48) | Đọc `labels.json` (list[str], strict), `load_model(compile=False)`, kiểm `output_shape[-1] == len(labels)` | ✅ |
| 1.3 | `backend/models/labels.json` | 20 nhãn; đã kiểm `labels == sorted(labels)` → **True** (alphabetical). `"canoe slamon"` là lỗi chính tả gốc của dataset, giữ nguyên là đúng. | ✅ |
| 1.4 | Tên file nhãn | Brief nói `class_names.json`; repo dùng **`labels.json`** (SPEC §4 quy định). Không có `class_names.json` trong repo. Chỉ khác tên, nội dung/thứ tự đúng. | ⚠️ (tên) |
| 1.5 | Cấu trúc model (đã load thử bằng `.venv`) | `InputLayer(224,224,3) → mobilenetv2_1.00_224 → GAP → Dropout → Dense(20, softmax)`. **Không có lớp Rescaling/augmentation nhúng** → preprocess phải làm ngoài model, và backend đang làm đúng một lần. | ✅ |

## 2. Preprocess (backend, dùng chung cho predict / scan / bulk / explain)

[backend/app/services/inference.py:24-51](backend/app/services/inference.py:24) — `preprocess_image()`

| Bước | Dòng | Code | Notebook | Đánh giá |
|---|---|---|---|---|
| Xoay EXIF + RGB | 37 | `ImageOps.exif_transpose(...).convert("RGB")` | RGB | ✅ (EXIF là bổ sung cần thiết cho ảnh điện thoại) |
| Resize | 38 | `resize((224,224), Image.BILINEAR)` — kéo giãn, không crop | 224×224 bilinear, no crop | ⚠️ nhẹ — xem 2.1 |
| Kiểu dữ liệu | 39 | `np.asarray(..., float32)` giá trị 0–255 | float 0–255 | ✅ |
| Chuẩn hoá | 49-51 | `mobilenet_v2.preprocess_input` → [-1, 1], thêm batch dim | giống | ✅ |

**2.1 ⚠️ Resize khác thư viện.** Notebook dùng `image_dataset_from_directory(image_size=(224,224))` (TF bilinear,
không antialias); backend dùng Pillow bilinear (antialias khi thu nhỏ). Với ảnh đã 224×224 (toàn bộ test set và golden
test) đây là no-op. Với ảnh điện thoại lớn, kết quả có thể chênh nhẹ. Đây là **quyết định có chủ đích** trong SPEC §12.8
và đã được so sánh trong SPEC §13 — không đề xuất sửa.

**2.2 ✅ Gallery (`/api/predict`)** gửi nguyên file gốc ([frontend/src/lib/api.ts:57-61](frontend/src/lib/api.ts:57)),
không resize phía client → preprocess hoàn toàn ở backend.

## 3. Camera: chụp 4 khung hình (frontend)

[frontend/src/lib/camera.ts](frontend/src/lib/camera.ts)

| # | Dòng | Hành vi | Đánh giá |
|---|---|---|---|
| 3.1 | 130-139 | Chờ 500 ms cho camera ổn định, rồi chụp **4 khung**, cách nhau **300 ms** | ✅ khớp SPEC §6 |
| 3.2 | 51-54, 69-85 | **Crop vuông ở giữa** rồi vẽ ra canvas **448×448** | ⚠️ xem 3.4 |
| 3.3 | 90-103 | Nén JPEG q **0.95 → 0.90 → 0.85**, nếu vẫn > 1,5 MB thì **bớt khung xuống tối thiểu 2** | ⚠️ lệch SPEC §12.14 |
| 3.4 | — | Crop vuông + backend stretch về 224 ⇒ không méo tỉ lệ. Notebook không crop, nhưng ảnh train vốn đã vuông 224×224 nên crop giữa là hợp lý và đã được ghi trong SPEC §13 (khung hướng dẫn trên camera). SPEC §6 lại ghi "downscale max 640 px" — code dùng 448. | ⚠️ lệch SPEC, không lệch notebook |
| 3.5 | — | SPEC §12.14 yêu cầu thang q 0.85 → 0.75 → 0.65 → 0.55, rồi max side 512, rồi bớt còn 3 khung (tối thiểu 2). Code bắt đầu ở 0.95, dừng ở 0.85, bỏ bước 512, bớt khung ngay. Khung có thể ít hơn 4 khi cảnh nhiều chi tiết. | ⚠️ lệch SPEC |

> Các điểm 3.x là **logic chụp/nén**, nằm ngoài phạm vi redesign UI. Ghi nhận để nhóm quyết định; **không sửa** trong branch `ui-redesign`.

## 4. Gộp nhiều khung hình (backend `/api/scan`)

[backend/app/services/inference.py:84-118](backend/app/services/inference.py:84) — `predict_frames()`

| # | Dòng | Hành vi | Đánh giá |
|---|---|---|---|
| 4.1 | 87 | Preprocess từng khung bằng cùng `preprocess_image`, gộp batch; 1 khung hỏng → từ chối cả lượt | ✅ |
| 4.2 | 99 | **Trung bình vector xác suất** (`outputs.mean(axis=0)`), không phải bỏ phiếu top-1 | ✅ khớp SPEC §5 |
| 4.3 | 100 | Top-3 bằng `argsort(..., kind="stable")` (hòa → giữ thứ tự nhãn alphabetical) | ✅ |
| 4.4 | 117 | `agreement` = tỉ lệ khung có top-1 = nhãn cuối | ✅ |
| 4.5 | [backend/app/api/scan.py:96-99](backend/app/api/scan.py:96) | Chỉ nhận 2–6 khung | ✅ |

## 5. Ngưỡng "Không chắc chắn" 60%

| # | Vị trí | Hành vi | Đánh giá |
|---|---|---|---|
| 5.1 | [backend/app/core/config.py:20](backend/app/core/config.py:20) | `CONFIDENCE_THRESHOLD=0.60` (đọc từ `.env`) | ✅ |
| 5.2 | [inference.py:78](backend/app/services/inference.py:78), [:110](backend/app/services/inference.py:110), [bulk_job.py:213](backend/app/services/bulk_job.py:213) | `is_uncertain = top1 < threshold` — **so sánh chặt**: đúng 60,0% được coi là *chắc chắn* | ✅ (ghi chú biên) |
| 5.3 | Frontend | **Không có hằng 0.6 nào.** UI chỉ đọc `result.is_uncertain` và `result.threshold` từ API ([prediction-card.tsx:13,44](frontend/src/components/prediction-card.tsx:13)). Bulk dùng `item.is_uncertain`. | ✅ |

## 6. Grad-CAM (`/api/explain`)

[backend/app/services/gradcam.py](backend/app/services/gradcam.py)

| # | Dòng | Hành vi | Đánh giá |
|---|---|---|---|
| 6.1 | 66-67 | Gọi `predict_image` rồi `preprocess_image` lần nữa trên cùng bytes — tốn gấp đôi preprocess nhưng kết quả giống hệt | ✅ (hiệu năng, không sai) |
| 6.2 | 42 | `conv_model = Model(base.input, out_relu)` bỏ qua lớp ngoài trước base. Vì model **không** có lớp preprocess/augment nhúng (1.5) nên an toàn. | ✅ |
| 6.3 | [frontend/src/lib/explain.ts:8-15](frontend/src/lib/explain.ts:8) | Camera: giải thích **một khung** tốt nhất (đúng bytes đã upload) → nhãn/độ tin cậy Grad-CAM có thể khác kết quả trung bình 4 khung. UI đã có câu cảnh báo. | ⚠️ (hành vi đúng, dễ gây hiểu nhầm — cần giữ câu cảnh báo khi redesign) |
| 6.4 | 87 | `thumbnail((448,448))` chỉ dùng để hiển thị overlay, không vào model | ✅ |

## 7. Điểm thuần UI (sẽ xử lý trong redesign, không đụng logic)

- 🟦 **Thẻ kết quả, top-3, dialog Grad-CAM và lưới Bulk hiển thị nhãn tiếng Anh thô** (`result.label`), trong khi
  `sportNameVi()` ([frontend/src/lib/sport-names.ts:25](frontend/src/lib/sport-names.ts:25)) đã có và chỉ được dùng ở AR.
  Redesign sẽ hiện tên tiếng Việt làm tên chính, nhãn gốc làm phụ — **chỉ hiển thị, không đổi nhãn gửi/nhận**.
- 🟦 Màu thanh uncertain trong Bulk dùng `bg-amber-500` cứng thay vì token `--warning`.

## 8. Đề xuất (ngoài phạm vi redesign — chỉ ghi nhận)

1. Quyết định giữ hay sửa thang nén ở `camera.ts` cho khớp SPEC §12.14 (hoặc cập nhật SPEC theo code hiện tại).
2. Cập nhật SPEC §6 "max 640 px" ↔ code 448 px center-crop.
3. Brief dùng tên `class_names.json`; repo chuẩn là `labels.json` — thống nhất tên trong tài liệu báo cáo.
