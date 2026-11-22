# Dataset phân loại môn thể thao (đã làm sạch)
## Cấu trúc
- `sports-classification/{train,valid,test}/<môn>/` + `sports.csv` (class id, filepaths, labels, data set)
- `anh-ngoai/<môn>/` + `sources.csv`: tập test độc lập (90 ảnh, nguồn Wikimedia Commons)
- `_loai_bo/`: ảnh đã chuyển đi (có `manifest_chuyen_di.csv` để hoàn tác); KHÔNG dùng khi huấn luyện
- `_review/`: bảng ảnh thu nhỏ để xem, danh sách đề xuất, `manifest_chia_lai_valid_test.csv`
- `class_weights.json`: trọng số lớp cho train (lớp ít ảnh có trọng số lớn hơn)

## Số ảnh
| Lớp | id | train | valid | test |
|---|---|---|---|---|
| archery | 0 | 300 | 15 | 25 | 340 |  |
| baseball | 1 | 300 | 15 | 25 | 340 |  |
| basketball | 2 | 300 | 15 | 25 | 340 |  |
| boxing | 3 | 298 | 11 | 21 | 330 |  |
| canoe slamon | 4 | 300 | 15 | 25 | 340 |  |
| field hockey | 5 | 300 | 15 | 25 | 340 |  |
| figure skating women | 6 | 300 | 15 | 25 | 340 |  |
| american football | 7 | 300 | 15 | 25 |
| formula 1 racing | 8 | 300 | 15 | 25 | 340 |  |
| golf | 9 | 300 | 15 | 25 | 340 |  |
| high jump | 10 | 300 | 15 | 25 | 340 |  |
| hockey | 11 | 300 | 15 | 25 | 340 |  |
| olympic wrestling | 12 | 300 | 15 | 25 | 340 |  |
| polo | 13 | 282 | 15 | 25 | 322 |  |
| roller derby | 14 | 300 | 15 | 25 | 340 |  |
| soccer | 15 | 300 | 15 | 25 | 340 | thay rollerblade racing |
| swimming | 16 | 300 | 15 | 25 | 340 |  |
| tennis | 17 | 184 | 15 | 25 | 224 |  |
| uneven bars | 18 | 254 | 15 | 25 | 294 |  |
| volleyball | 19 | 300 | 15 | 25 | 340 |  |

Tổng: train 5529, valid 289, test 476

## Những thay đổi so với bản gốc Kaggle
- Chuyển 406 ảnh không thấy môn thể thao rõ (chỉ có dụng cụ, sân trống, chân dung) ra `_loai_bo`.
- Giảm 490 ảnh gần trùng (cùng sự kiện, chụp liên tiếp) và 7 cặp gần trùng khác.
- Đổi nhãn `football` thành `american football` (toàn bộ là bóng bầu dục Mỹ).
- Chia lại valid/test: mỗi lớp 15 valid, 25 test, lấy theo từng khối 5 ảnh liên tiếp (khác sự kiện nhau), có 1 ảnh đệm mỗi bên để hạn chế rò rỉ.
- Bỏ 10 ảnh `anh-ngoai` trùng ảnh `train`.

## Lưu ý khi huấn luyện
- Số ảnh mỗi lớp trong train còn lệch (151–300): dùng `class_weights.json` hoặc lấy mẫu cân bằng.
- Test độc lập `anh-ngoai` chỉ nên dùng để báo cáo cuối, không dùng chọn mô hình.
- Một số lớp vẫn ít đa dạng (nhiều ảnh cùng một giải): nên thêm ảnh từ nguồn khác khi có thể.

## Ảnh bổ sung từ Wikimedia Commons
- Thêm 59 ảnh vào train (tên file bắt đầu bằng `w`): high jump 16, basketball 15, boxing 14, tennis 14. Đã xem từng ảnh bằng mắt; archery bị loại hết (ảnh không đạt).
- Nguồn, giấy phép, tác giả từng ảnh: `nguon_anh_them.csv` (CC BY/CC BY-SA cần ghi tác giả).
- Ảnh gốc đã tải nằm trong `_moi_tai/` (không dùng khi huấn luyện).
- Số ảnh train từng lớp đã đổi; xem lại `class_weights.json` (đã cập nhật).
- Bổ sung và làm sạch olympic wrestling: thay 27 ảnh train yếu/cụm Buenos Aires 2018 bằng ảnh w001-w084 (đủ 300 ảnh), thay 8 ảnh test rò rỉ sự kiện/chụp xa, thay E2 và bổ sung E3 cho anh-ngoai (đủ 5 ảnh).
- Rà soát boxing (v6 & v7): Giữ lại 44 ảnh hành động đạt trong đợt v6 (cùng w280, w281). Chuyển 76 ảnh không thi đấu cùng V4 và V12 vào `_loai_bo/boxing_bad_content/`. Đợt v7 đã được người dùng (Claude) duyệt: bổ sung 2 ảnh valid (4.jpg, 12.jpg - đủ 15/15) và 50 ảnh train (w402-w451), nâng train boxing lên 274 ảnh. Hiện thiếu 26 ảnh train. Đợt ứng viên mới cho 26 ảnh cuối được lưu độc lập tại `_moi_tai/boxing_v8/` để duyệt bằng mắt trước khi gộp.
- Bổ sung và chuẩn hoá swimming: chuyển 18 ảnh train không đạt, 1 ảnh test watermark gettyimages, 1 ảnh anh-ngoai lễ trao huy chương vào _loai_bo/swimming/. Bổ sung 103 ảnh train w001-w103 từ danh sách duyệt Wikimedia Commons, thay test 15.jpg bằng cand_202, thay anh-ngoai 5.jpg bằng cand_181. Đạt chuẩn 300 ảnh train, 15 valid, 25 test, 5 anh-ngoai.
- Hoàn thiện làm sạch và bổ sung hockey: Chuyển 75 ảnh train yếu (044 trùng, 15 ảnh qua kính/xa, 59 chân dung DEL, 026/027 tránh rò rỉ T19/T20) vào _loai_bo/hockey/train/; bổ sung 125 ảnh hành động w001–w125 (đủ 300 ảnh). Thay thế 4 ảnh toàn cảnh xa E2–E5 trong anh-ngoai (đủ 5 ảnh hành động). Khử rò rỉ và cụm trùng người trong valid (thay V8, V10) và test (thay T7, T8, T13, T14, T20, T25) bằng các ảnh Olympic độc lập.

- Chuẩn hoá và bổ sung roller derby (hoàn thành 2 đợt): chuyển 120 ảnh train yếu và cụm rò rỉ USA-Belgium (biển S★ONE) vào _loai_bo/roller_derby/, thay 3 ảnh valid và 7 ảnh test bị rò rỉ sự kiện, thay 2 ảnh anh-ngoai. Bổ sung 167 ảnh train w001-w167 từ các giải đấu độc lập hoàn toàn (109 ảnh đợt 1, 58 ảnh đợt 2) đạt chuẩn 300 ảnh train, 15 valid, 25 test, 5 anh-ngoai. Đồng bộ sports.csv và nguon_anh_them.csv.
- Bổ sung volleyball: số ảnh train thực tế trước khi gộp là 176 (README cũ ghi 208). Thêm 124 ảnh train `w001`–`w124` (62 Nam/62 Nữ, 79 trong nhà/45 bãi biển, 27 sự kiện hoặc ít hơn, tối đa 8 ảnh/sự kiện) từ `_moi_tai/volleyball_v1/` (ảnh đã crop 224×224). Thêm 5 ảnh `anh-ngoai/volleyball/1–5.jpg` (AN01–AN05). Loại 5 ảnh không phải hành động (cand_071, 088, 091, 096, 130) và để dự phòng 5 ảnh yếu (cand_072–074, 097, 099). Nguồn/giấy phép: `nguon_anh_them.csv`, `anh-ngoai/sources.csv`. Danh sách ánh xạ: `_moi_tai/volleyball_v1/merge_manifest.json`. Đã loại sự kiện World League 2015 vì trùng valid/test gốc. `class_weights.json`: volleyball = 1.0 (các lớp khác chưa tính lại).
