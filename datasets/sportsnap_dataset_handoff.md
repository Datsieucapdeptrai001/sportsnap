# SportSnap — ghi chú bàn giao dataset (cập nhật 2026-11-20, DATASET FINAL, soccer thay rollerblade)

## QUYẾT ĐỊNH CHỐT (cập nhật 2026-11-20 tối)
- **Soccer THAY rollerblade racing.** Vẫn đúng 20 lớp: `soccer` lấy class id 15 (id cũ của rollerblade). Rollerblade đã gỡ, file nằm ở `_loai_bo/rollerblade racing/`. `labels.json` của dự án phải thay "rollerblade racing" bằng "soccer" ở vị trí 15 (file này không nằm trong `datasets/`, chat train/app tự sửa).
- Soccer: 300 train / 15 valid / 25 test / 5 ngoài, ảnh Flickr/Commons CC (xem `nguon_anh_them.csv`), cắt 224x224, ORB cross 20 và all 30 đều 0 cặp trùng. Nguồn tạm: `_review/soc/stage/`.
- Polo: đã sửa 48 dòng class id sai 69 thành 13 trong `sports.csv`.
- Trước đó (đã lỗi thời): "dừng soccer" không còn hiệu lực.

## Vai trò
- Chat "dữ liệu" (Claude): duyệt ảnh bằng mắt, chạy ORB, ra lệnh cho Codex, là nơi DUY NHẤT quyết định gộp ảnh vào `sports-classification/`.
- Codex: chỉ tải ảnh ứng viên vào `_moi_tai/<lớp>_vN/`; chỉ gộp khi Claude đã duyệt và đưa danh sách.
- Chat "train": chỉ ĐỌC dataset, không sửa `sports.csv` hay thư mục ảnh; ghi kết quả ra thư mục riêng (vd `D:\tgmt\runs\`).
- Trả lời tiếng Việt.

## Cấu trúc và file
- `sports-classification/{train,valid,test}/<lớp>/`, `anh-ngoai/<lớp>/` (5 ảnh ngoài mỗi lớp).
- `sports-classification/sports.csv`: cột `class id,filepaths,labels,data set`, class id là số nguyên, kết thúc dòng `\n`. Dùng module `csv`, KHÔNG dùng pandas để ghi.
- `nguon_anh_them.csv` (utf-8-sig): `file,tieu_de,link,giay_phep,tac_gia`. `anh-ngoai/sources.csv`: `sport,filename,title,source_url`.
- `class_weights.json` (đã bỏ rollerblade, thêm soccer 1.0; bản cũ `.bak_soccer`) = 300 / số ảnh train thực tế mỗi lớp (cập nhật 2026-11-19, bản cũ `.bak_final`).
- Ảnh bị loại chuyển vào `_loai_bo/<lớp>/<split>/`, không xóa. Không đổi tên file cũ.
- Công cụ kiểm tra: `_review/tools/` (`orb_dup.py <lớp> cross|all <ngưỡng>`, `orb_cand.py`, `review_cand.py`, `rc2.py`).

## Quy tắc dữ liệu
- Mục tiêu mỗi lớp: 300 train / 15 valid / 25 test / 5 ảnh ngoài.
- Không ảnh trắng đen/cũ, không trùng (kể cả cùng ảnh khác khung cắt), không watermark hay thanh ghi tác giả, không ảnh game/dựng, không đồ họa truyền hình.
- Cách ly sự kiện: mỗi sự kiện chỉ nằm trong một split. Train tối đa 8 ảnh/sự kiện; valid, test, ngoài tối đa 2 ảnh/sự kiện.
- Trùng ORB (cv2 ORB nfeatures=400, ratio 0.75, resize 224, RANSAC): inlier >= 15–20 là trùng; >= 100 là gần như cùng ảnh.
- Nguồn cho phép: Wikimedia Commons (API, User-Agent mô tả, 1 yêu cầu/giây, backoff), Flickr CC, Pexels/Unsplash/Pixabay qua trình duyệt kèm link. Cấm Hugging Face "Olympic Vision", Kaggle và mọi dataset bên thứ ba.

## Trạng thái (2026-11-20)
- Đủ 300/15/25/5: boxing, canoe slamon, figure skating women, hockey, roller derby, swimming, tennis, volleyball.
- Gần đủ (train thiếu 1–8, đã dọn ảnh trùng): american football 298, archery 292, baseball 298, basketball 298, field hockey 298 (valid 14), formula 1 racing 294, golf 295 (ngoài 4), high jump 296, olympic wrestling 298, polo 299.
- Uneven bars: train 300, valid 12, test 22, ngoài 5.
- Rollerblade racing: ĐÃ GỠ (thay bằng soccer).
- Tồn đọng: khoảng 118 cặp ảnh train ORB 30–99 chưa xử lý; thiếu dòng nguồn trong `nguon_anh_them.csv` cho uneven bars gộp từ `uneven_bars_v2`, basketball `w176` và test `w301`.

## Việc cần làm tiếp
1. Train MobileNetV2 transfer learning (input 224, class weights từ `class_weights.json`), đánh giá trên valid rồi test; xem riêng recall lớp soccer.
2. Nếu accuracy chung >= 0.88 và soccer không tụt rõ rệt thì không cần thêm ảnh.
3. Sau khi dataset chốt: chạy lại ORB `cross 20` và `all 30` cho cả 20 lớp, đối chiếu `sports.csv` với file, kiểm tra CSV nguồn, cập nhật `class_weights.json`.
