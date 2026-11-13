# SportSnap — Model Verification & Registry Report (`docs/MODEL_VERIFICATION.md`)

Ngày thực hiện: 2026-11-13  
Môi trường thử nghiệm: Windows 11 (x64), CPU Intel Core, Python 3.12.3, TensorFlow 2.20.0  
Công cụ xác minh tự động: `python -m app.verify_models`

---

## 1. Tổng quan kiểm chứng danh mục mô hình (Model Registry)

Hệ thống SportSnap quản lý 6 mô hình thông qua tệp cấu hình biểu thị độc lập `backend/app/models_config.py`. Mỗi mô hình được định nghĩa bằng một `ModelManifest` bất biến, chỉ định rõ ràng đường dẫn checkpoint, tệp nhãn riêng, phương thức tiền xử lý, kích thước ảnh đầu vào, và hệ số hiệu chuẩn (`temperature`, `tau_high`, `tau_low`).

```python
@dataclass(frozen=True)
class ModelManifest:
    id: str
    display_name: str
    description: str
    model_rel_path: str
    labels_rel_path: str
    preprocess: Literal["mobilenet_v2", "resnet50", "none"]
    input_size: tuple[int, int] = (224, 224)
    temperature: float = 1.0
    tau_high: float = 0.75
    tau_low: float = 0.40
```

---

## 2. Bảng kết quả thực nghiệm (Empirical Benchmark)

Dữ liệu đo đạc thực tế thông qua công cụ CLI `verify_models` trên tập dữ liệu chuẩn:
- **Tập Test:** 100 ảnh (`datasets/sports-classification/test`)
- **Tập Valid:** 100 ảnh (`datasets/sports-classification/valid`)
- **Tập Ảnh Ngoài (External):** 100 ảnh thực tế đa dạng nguồn (`datasets/anh-ngoai`)
- **Độ trễ suy luận:** Thời gian trung bình mỗi ảnh (ms) trên CPU

| Mã mô hình (`id`) | Tên hiển thị | Trạng thái | Test Acc | Valid Acc | Ext Acc | Độ trễ (ms) | Dung lượng | Tiền xử lý |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `legacy_mobilenet_v2` | **MobileNetV2 (SportSnap · 20 môn chuẩn)** | **Verified** | **97.0%** | **98.0%** | **81.0%** | **452.7 ms** | **9.7 MB** | `mobilenet_v2` |
| `mobilenet_v2_finetune` | MobileNetV2 Fine-tune (20 môn mới) | Verified | 97.0% | 96.0% | 78.0% | 470.6 ms | 26.3 MB | `mobilenet_v2` |
| `mobilenet_v2_head` | MobileNetV2 Head (20 môn mới) | Verified | 94.0% | 92.0% | 70.0% | 478.8 ms | 9.9 MB | `mobilenet_v2` |
| `resnet50_finetune` | ResNet50 Fine-tune (20 môn mới) | Verified | 100.0% | 97.0% | 79.0% | 859.6 ms | 276.9 MB | `resnet50` |
| `resnet50_head` | ResNet50 Head (20 môn mới) | Verified | 94.0% | 91.0% | 68.0% | 869.0 ms | 95.5 MB | `resnet50` |
| `cnn_scratch` | CNN Scratch (Tự xây dựng · 20 môn mới) | Experimental | 5.0% | 5.0% | 5.0% | 166.8 ms | 7.9 MB | `none` |

---

## 3. Quy tắc 4 bậc chọn mô hình mặc định (4-Tier Default Selection Rule)

Nhằm đảm bảo mô hình được chọn làm mặc định luôn đem lại trải nghiệm tốt nhất cho người dùng cuối trên máy tính thông thường (CPU), hệ thống áp dụng quy tắc xếp hạng 4 bậc:

1. **Bậc 1: Điều kiện tiên quyết (`status == "verified"`)**  
   Mô hình phải vượt qua ngưỡng kiểm chứng chất lượng: $\text{Test Accuracy} \ge 90\%$. Mô hình dưới 90% (như `cnn_scratch` 5%) bị xếp loại `experimental` và loại khỏi danh sách ứng cử viên mặc định.
2. **Bậc 2: Độ chính xác trên tập Validation (`valid_accuracy`)**  
   So sánh khả năng tổng quát hóa trên tập dữ liệu kiểm tra chéo độc lập (không chọn dựa trên Test để tránh thiên vị).
3. **Bậc 3: Độ chính xác trên tập Ảnh Ngoài (`external_accuracy`)**  
   Đo lường độ ổn định khi xử lý ảnh thực tế từ người dùng (ảnh chụp từ điện thoại, góc chụp ngẫu nhiên, ánh sáng phức tạp).
4. **Bậc 4: Độ trễ suy luận (`latency_ms`)**  
   Ưu tiên mô hình phản hồi nhanh nhất nhằm tối ưu trải nghiệm tương tác trực tiếp (real-time).

### Rationale: Vì sao `legacy_mobilenet_v2` được chọn?
- `legacy_mobilenet_v2` dẫn đầu về **Validation Accuracy (98.0%)** và **External Accuracy (81.0%)**, vượt qua `resnet50_finetune` (Valid: 97.0%, Ext: 79.0%).
- Mặc dù `resnet50_finetune` đạt 100% trên Test set, mô hình này có kích thước cồng kềnh (276.9 MB) và độ trễ rất cao (**859.6 ms**), chậm gấp gần 2 lần so với `legacy_mobilenet_v2` (**452.7 ms**).
- Kích thước `legacy_mobilenet_v2` chỉ vỏn vẹn **9.7 MB**, nạp tức thì khi khởi động, tối ưu tuyệt đối cho môi trường CPU.
- Do đó, thuật toán chọn `legacy_mobilenet_v2` làm mô hình mặc định hoàn toàn khách quan, có căn cứ số liệu đo đạc thực nghiệm rõ ràng.

---

## 4. Hướng dẫn sử dụng CLI kiểm chứng

Lệnh kiểm tra và cập nhật bộ nhớ đệm xác minh mô hình:
```powershell
$env:PYTHONPATH="backend"
backend\.venv\Scripts\python.exe -m app.verify_models
```

Tệp lưu cache kết quả: `backend/data/model_verification.json`.  
Khi ứng dụng khởi động, FastAPI sẽ đọc bộ nhớ đệm này để khởi tạo mô hình mặc định trong vòng chưa đầy 1 giây mà không cần tính toán lại toàn bộ tập ảnh.
