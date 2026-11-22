# Kế hoạch giao Antigravity — Đợt 5: cải thiện Grad-CAM cho câu hỏi nghiên cứu

> Đọc `AGENTS.md`, `SPEC.md`, `backend/app/services/gradcam.py`, `backend/tests/test_insights.py` trước. Làm **từng slice một**, mỗi slice 1 commit `slice N: <summary>`.
> UI tiếng Việt; code, comment, commit message tiếng Anh.
> **Không** sửa, huấn luyện lại hay chuyển đổi bất kỳ file mô hình nào; **không** sửa `labels.json`; **không** ghi vào `datasets/sports-classification/` hay `datasets/anh-ngoai/`.
> **Không bịa số.** Mọi số trong UI, tài liệu, báo cáo phải do script trong repo sinh ra và lưu thành file JSON.

## Mục tiêu

Phiếu đề tài (đề tài 16) hỏi: *"Đặc trưng thị giác nào (màu sân, trang phục, dụng cụ) đóng góp nhiều nhất vào quyết định phân loại môn thể thao của mô hình?"*, và hướng NCKH là *phân tích explainability bằng Grad-CAM*.

Hiện tại Grad-CAM chỉ vẽ một heatmap cho một ảnh. Để trả lời câu hỏi nghiên cứu cần:
1. Grad-CAM **đúng chuẩn** và **đã qua kiểm tra độ tin cậy** (sanity check).
2. Số liệu **định lượng**: heatmap có thật sự phản ánh mô hình không (faithfulness), và **bao nhiêu % "sự chú ý" rơi vào người/trang phục, dụng cụ, sân/nền** theo từng môn, từng mô hình.
3. Bằng chứng **nhân quả**: che vùng đó đi thì độ tin cậy giảm bao nhiêu.

## Vấn đề đã tìm thấy khi review (2026-11-20)

| # | Vấn đề | Mức độ |
|---|---|---|
| 1 | `models/ResNet50_finetune_best.keras` chỉ 29 KB, bên trong là mô hình giả (`Rescaling → Conv2D → GAP → Dense`), bị ghi đè ngày 18/11. Chọn "ResNet50 Fine-tune" trong app sẽ dự đoán và vẽ Grad-CAM bằng mô hình giả. Bản thật còn ở `data/models_registry/v1/ResNet50_finetune_best.keras` (215 MB). | Cao |
| 2 | Grad-CAM lấy gradient của **xác suất sau softmax**. Bài báo gốc (Selvaraju et al., 2017) dùng **điểm trước softmax (logit)**; softmax làm gradient bị nén khi mô hình rất chắc chắn và trộn ảnh hưởng của lớp khác. | Trung bình |
| 3 | Test chỉ kiểm kích thước/giá trị hữu hạn, **không kiểm heatmap có phản ánh mô hình** (không có sanity check, không có số đo faithfulness). | Trung bình |
| 4 | Phiếu đề tài ghi so sánh **ResNet18**, project dùng **ResNet50**. Ghi rõ lý do trong báo cáo (không đổi mô hình). | Thấp (tài liệu) |

---

## Slice Q0 — Khôi phục file ResNet50 (làm trước, cần chủ dự án xác nhận)

1. In ra cấu trúc (danh sách layer từ `config.json` trong file zip) và SHA256 của:
   - `models/ResNet50_finetune_best.keras` (file giả hiện tại)
   - `data/models_registry/v1/ResNet50_finetune_best.keras`
2. **Dừng và hỏi chủ dự án** trước khi chép. Nếu được đồng ý: đổi tên file giả thành `models/_broken_ResNet50_finetune_best.keras.bak` (không xóa), rồi chép bản trong registry vào `models/ResNet50_finetune_best.keras`.
3. Tìm nguyên nhân file bị ghi đè: xem `sportsnap_lib/retrain.py` (dòng ghi `settings.source_model_path`) và mọi test/script có thể chạy với `project_root` thật thay vì `tmp_path`. Nếu tìm ra test ghi đè file thật, sửa test cho dùng `tmp_path`.
4. Thêm test backend: mọi mô hình trong `app/models_config.py` mà file tồn tại phải có cấu trúc đúng tên (ResNet50 có layer `resnet50`, MobileNetV2 có `mobilenetv2_1.00_224`…). Đọc `config.json` trong zip, không cần nạp TensorFlow.

Commit: `slice Q0: restore ResNet50 checkpoint and guard model structure`.

---

## Slice Q1 — Grad-CAM đúng chuẩn (logit) + Grad-CAM++

Trong `backend/app/services/gradcam.py`:
1. **Dùng logit:** khi lớp cuối là `Dense(activation="softmax")`, tạo bản sao **chỉ trong bộ nhớ** của lớp đó với `activation=None` và cùng trọng số (`get_weights`/`set_weights`), dùng cho `classifier_model`. **Không ghi lại file mô hình.** Dự đoán (`label`, `confidence`, `top3`) vẫn lấy từ `predict_image` như cũ.
2. Thêm tham số `method: Literal["gradcam", "gradcam_pp"] = "gradcam"`. Grad-CAM++ (Chattopadhay et al., 2018) tính trọng số bằng đạo hàm bậc 2/3 xấp xỉ qua `exp(logit)`, công thức chuẩn của bài báo; ghi nguồn trong comment.
3. Thêm tham số `target_label: str | None`. Mặc định là nhãn top-1; cho phép vẽ cho nhãn top-2 để so sánh "vì sao mô hình phân vân".
4. API `/api/explain` nhận thêm `method` và `target` (form field, tùy chọn). Mặc định giữ hành vi cũ để không vỡ frontend.
5. Trả thêm trong `Explanation`: `method`, `target_label`, `target_layer` (tên lớp đã dùng).
6. Test: so sánh heatmap dùng logit với một cài đặt tham chiếu viết tay trên mô hình nhỏ (2 lớp, trọng số cố định) và khớp sai số `1e-5`; Grad-CAM++ trả về heatmap hợp lệ; `target_label` không có trong `labels` thì lỗi 422.

Commit: `slice Q1: logit-based Grad-CAM, Grad-CAM++ and target label`.

---

## Slice Q2 — Kiểm tra độ tin cậy (sanity check) và đo faithfulness

Tạo `backend/app/services/explain_metrics.py` (hàm thuần, NumPy):
1. **Sanity check xáo trọng số** (Adebayo et al., 2018): với mô hình nạp **trong bộ nhớ**, lần lượt gán ngẫu nhiên trọng số từ lớp Dense cuối ngược vào backbone (cascading randomization), đo **Spearman rank correlation** giữa heatmap gốc và heatmap sau xáo. Kỳ vọng tương quan giảm mạnh. Chỉ làm trên bản sao trong bộ nhớ, **không lưu**.
2. **Deletion / Insertion AUC** (Petsiuk et al., 2018, RISE): xóa dần (hoặc chèn dần) điểm ảnh theo thứ tự độ nóng của heatmap, đo xác suất lớp đích, tính diện tích dưới đường cong. Deletion AUC thấp + insertion AUC cao = heatmap trung thực. So với baseline **heatmap ngẫu nhiên** và **heatmap tâm ảnh** (Gaussian giữa ảnh).
3. Unit test với mô hình nhỏ dựng sẵn (không cần mô hình thật): hàm AUC cho đường cong biết trước ra đúng số; heatmap ngẫu nhiên cho deletion AUC cao hơn heatmap "đúng" trên mô hình đồ chơi được thiết kế để chỉ nhìn một góc ảnh.

Commit: `slice Q2: explainability sanity check and deletion/insertion metrics`.

---

## Slice Q3 — Script phân tích hàng loạt trên tập test

Tạo `backend/scripts/gradcam_analysis.py` (chạy bằng `python -m scripts.gradcam_analysis` trong `backend/`):
1. Đầu vào: tập `datasets/sports-classification/test` (100 ảnh, 20 lớp) và ảnh ngoài `datasets/anh-ngoai` (chỉ đọc).
2. Mô hình: MobileNetV2 (`best_model.keras`), ResNet50 fine-tune (sau Q0), CNN Scratch. Bỏ qua mô hình nào thiếu file, ghi rõ trong output.
3. Với mỗi ảnh × mô hình × phương pháp (`gradcam`, `gradcam_pp`): lưu heatmap gốc 7×7 (hoặc kích thước lớp) vào `backend/data/explain/heatmaps_<model>_<method>.npz`, tính deletion/insertion AUC, độ tập trung (entropy của heatmap chuẩn hóa), đúng/sai dự đoán.
4. Chạy sanity check Q2 trên 20 ảnh (1 ảnh/lớp) cho mỗi mô hình.
5. Xuất `backend/data/explain/summary.json`: trung bình ± độ lệch chuẩn theo mô hình, phương pháp, lớp; so với 2 baseline; tách riêng ảnh dự đoán đúng và sai.
6. Xuất hình cho báo cáo vào `backend/data/explain/figures/`: lưới 20 lớp × 3 mô hình (1 ảnh đại diện/lớp), **heatmap trung bình theo lớp**, biểu đồ deletion/insertion.
7. Ghi `random_seed`, phiên bản TensorFlow, SHA256 mô hình, ngày chạy vào JSON để tái lập được.

Commit: `slice Q3: batch Grad-CAM analysis over the test split`.

---

## Slice Q4 — Trả lời câu hỏi nghiên cứu: người/trang phục vs dụng cụ vs sân/nền

### Q4a. Nhãn vùng (do **người trong nhóm** gán, Antigravity chỉ làm công cụ và định dạng)
- Tập con: 100 ảnh test (5 ảnh × 20 lớp).
- 3 loại vùng, vẽ **bounding box** (đa giác nếu có thời gian):
  - `athlete` — người chơi kèm trang phục
  - `equipment` — bóng, gậy, vợt, cung, thuyền, xe, ngựa, xà…
  - `field` — phần còn lại là sân/nền (không cần vẽ: = toàn ảnh trừ 2 loại trên)
- Công cụ gợi ý: makesense.ai (chạy trên trình duyệt, không cần cài), xuất **COCO JSON**.
- Lưu vào thư mục **mới** `datasets/explain_regions/annotations.json` kèm `README.md` mô tả quy tắc gán. Không chép ảnh, chỉ tham chiếu đường dẫn ảnh test.
- Antigravity viết `backend/scripts/validate_regions.py`: kiểm tên file tồn tại, box nằm trong ảnh, đủ 5 ảnh/lớp, in thống kê.

### Q4b. Phân tích (thêm vào `gradcam_analysis.py` hoặc script riêng `region_attribution.py`)
1. **Tỉ lệ năng lượng heatmap theo vùng:** heatmap đã phóng về kích thước ảnh, chuẩn hóa tổng = 1; cộng phần rơi vào `athlete`, `equipment`, `field`. Chỗ người và dụng cụ chồng nhau thì tính cho `equipment` (ghi rõ quy ước). So với **tỉ lệ diện tích** của từng vùng để biết mô hình "chú ý nhiều hơn mức ngẫu nhiên" hay không.
2. **Pointing game:** điểm nóng nhất của heatmap nằm trong vùng nào.
3. **Che vùng (occlusion) — bằng chứng nhân quả:** thay từng vùng bằng màu trung bình ảnh (hoặc làm mờ), đo độ giảm xác suất lớp đúng và tỉ lệ đổi nhãn. Ví dụ: che sân mà mô hình vẫn đúng → sân không quan trọng với môn đó.
4. Kết quả theo **từng môn** và **từng mô hình**, xuất `backend/data/explain/regions.json` và biểu đồ cột chồng (stacked bar) 20 môn × 3 vùng cho mỗi mô hình.
5. Viết đoạn kết luận **chỉ dựa trên số trong JSON**, ví dụ dạng "Ở môn X, Y% năng lượng Grad-CAM rơi vào dụng cụ (diện tích chỉ Z%); che dụng cụ làm độ tin cậy giảm W điểm". Không suy diễn quá dữ liệu.

Commit: `slice Q4: region attribution of Grad-CAM (athlete/equipment/field)`.

---

## Slice Q5 — Giao diện

Trong frontend (mọi gọi HTTP qua `src/lib/api.ts`):
1. Nút "Giải thích" (`explain-button.tsx`): thêm lựa chọn **Grad-CAM / Grad-CAM++**, và **"Vì sao không phải <top-2>?"** (vẽ heatmap cho nhãn thứ 2). Hiển thị tên lớp đã dùng.
2. Thêm thanh trượt độ mờ lớp phủ (0–100%) và chế độ xem cạnh nhau (ảnh gốc | heatmap).
3. Trang Insights: thêm thẻ "Phân tích vùng chú ý" đọc `regions.json` / `summary.json` qua API mới `GET /api/explain/summary`. Nếu file chưa có thì hiện "Chưa có dữ liệu phân tích — chạy `scripts/gradcam_analysis.py`", **không hiện số giả**.
4. Test frontend (`node --test`) cho phần đọc/hiển thị dữ liệu và trạng thái chưa có dữ liệu.

Commit: `slice Q5: explainability UI controls and region analysis card`.

---

## Slice Q6 — Tài liệu cho báo cáo NCKH

Tạo `docs/EXPLAINABILITY.md`:
- Phương pháp: Grad-CAM (logit), Grad-CAM++, lớp đích từng mô hình, sanity check, deletion/insertion, region attribution, occlusion.
- Quy trình tái lập (lệnh chạy, seed, phiên bản).
- Bảng kết quả **chép từ JSON** (ghi đường dẫn file nguồn bên dưới mỗi bảng).
- Hạn chế: chỉ 100 ảnh có nhãn vùng; bounding box thô; Grad-CAM độ phân giải 7×7; ResNet50 thay cho ResNet18 trong phiếu đề tài (nêu lý do).
- Tài liệu tham khảo:
  - R. R. Selvaraju et al., "Grad-CAM: Visual Explanations from Deep Networks via Gradient-based Localization," ICCV 2017.
  - A. Chattopadhay et al., "Grad-CAM++: Generalized Gradient-based Visual Explanations for Deep Convolutional Networks," WACV 2018.
  - J. Adebayo et al., "Sanity Checks for Saliency Maps," NeurIPS 2018.
  - V. Petsiuk, A. Das, K. Saenko, "RISE: Randomized Input Sampling for Explanation of Black-box Models," BMVC 2018.

Commit: `slice Q6: document explainability methodology and results`.

---

## Điều kiện hoàn thành (mỗi slice)
1. `pytest -q` (backend), `npm test`, `npx tsc --noEmit`, `npm run build` pass.
2. Ruff/ESLint sạch trên file đã sửa (theo cấu hình có sẵn của repo).
3. SHA256 của `backend/models/best_model.keras` và `labels.json` **không đổi** (in trước và sau mỗi slice).
4. Báo cáo cuối: commit, lệnh đã chạy + output thật, đường dẫn file JSON kết quả, những gì chưa làm được và lý do.
5. Slice nào cần người (Q0 bước 2, Q4a gán nhãn) thì **dừng và báo**, không tự làm thay.
