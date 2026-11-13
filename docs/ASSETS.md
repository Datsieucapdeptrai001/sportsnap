# 3D assets — Slice 5 asset preparation

Bộ 20 vật đại diện low-poly do nhóm SportSnap tự dựng hoàn toàn bằng Python/bpy.
GLB không dùng asset, texture, font hay add-on bên thứ ba. Exporter glTF có sẵn
trong **Blender 5.2.1 LTS**; vật liệu PBR màu đơn, roughness/metallic theo loại bề mặt.
UI Slice 5 đã dùng bộ asset này trong dialog 3D/AR; đặt vật thực tế trên điện thoại
vẫn cần kiểm thử thủ công theo README.

Theo yêu cầu tác vụ này, đường dẫn GLB là `frontend/public/models/` (thay cho
`models3d/` được dự kiến trong SPEC). Ánh xạ trong `frontend/src/lib/sports3d.ts`
đọc manifest, kiểm tra tệp tồn tại qua Vite glob. Không có file USDZ được commit;
model-viewer tự tạo USDZ lúc mở iOS Quick Look khi không khai báo `ios-src`.
Nút AR chỉ bật cho kết quả chắc chắn có model; thư viện nạp lazy khi mở dialog.
Không thay đổi GLB/manifest trong tác vụ UI AR. README Run it không cần thêm bước
Blender vì GLB và manifest đã được commit sẵn.

Mỗi file dùng mét, trục Y hướng lên theo glTF, tâm đáy tại (0, 0, 0). Cảnh dựng nội bộ
của Blender dùng Z-up rồi exporter đổi sang Y-up. Chín môn được nâng cấp bên dưới dùng
**đơn vị mét, tỉ lệ trưng bày (display scale), không phải kích thước thực**.
Cạnh dài nhất của chúng nằm trong 0,25–0,40 m, bệ dày khoảng 0,015 m; dụng cụ mảnh
được làm dày, bóng/puck được phóng lớn tương đối để đọc được ở thumbnail 200 px.
Mười một môn còn lại giữ nguyên GLB và quy ước kích thước cũ của lần tạo đầu.
Giới hạn mỗi file: 2.000.000 byte và 30.000 tam giác, đo từ chính GLB sau export;
`manifest.json` lưu dung lượng, tam giác, kích thước `[X,Y,Z]` và SHA256.

| nhãn | file | nguồn và tác giả |
| --- | --- | --- |
| archery | `frontend/public/models/archery.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| baseball | `frontend/public/models/baseball.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| basketball | `frontend/public/models/basketball.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| boxing | `frontend/public/models/boxing.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| canoe slamon | `frontend/public/models/canoe_slamon.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| field hockey | `frontend/public/models/field_hockey.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| figure skating pairs | `frontend/public/models/figure_skating_pairs.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| figure skating women | `frontend/public/models/figure_skating_women.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| football | `frontend/public/models/football.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| formula 1 racing | `frontend/public/models/formula_1_racing.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| golf | `frontend/public/models/golf.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| high jump | `frontend/public/models/high_jump.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| hockey | `frontend/public/models/hockey.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| nascar racing | `frontend/public/models/nascar_racing.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| olympic wrestling | `frontend/public/models/olympic_wrestling.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| polo | `frontend/public/models/polo.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| rings | `frontend/public/models/rings.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| roller derby | `frontend/public/models/roller_derby.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| rollerblade racing | `frontend/public/models/rollerblade_racing.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| rugby | `frontend/public/models/rugby.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| swimming | `frontend/public/models/swimming.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| tennis | `frontend/public/models/tennis.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| uneven bars | `frontend/public/models/uneven_bars.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| volleyball | `frontend/public/models/volleyball.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |

Giữ nguyên chính tả nhãn **canoe slamon** của mô hình. `football` được dựng là bóng
bầu dục Mỹ: đã xem ảnh `backend/debug_frames/model_compare/test_data/football/1.jpg`
(cầu thủ mặc đồ bảo hộ và cầm bóng bầu dục Mỹ). Đây là xác nhận từ ảnh mẫu cục bộ,
không phải xác minh toàn bộ dataset. Không thay đổi nhãn hoặc dữ liệu mô hình.
Hai giày nghệ thuật có lưỡi dao và toe pick; derby dùng quad, rollerblade dùng inline;
golf dùng hình học lõm dimple, không phải đốm màu. Swimming có bệ hồ bơi, ba dây phao,
vạch đáy, bục xuất phát, mũ và kính.
Số 7 trên stock car được dựng từ nét hình học, không dùng font hoặc nhãn hiệu xe.

## Nâng cấp chín môn ở tỉ lệ trưng bày

Giữ nguyên tên file/đường dẫn và nguồn tự tạo của bảng trên. Chỉ chín mục này có
`scale: "display"` trong manifest; `dimensions_m` vẫn là kích thước hình học theo mét.
Không chuẩn hóa hay thêm bệ cho 11 môn ngoài phạm vi. Hai hình người capsule của
đấu vật là ngoại lệ được yêu cầu trong lần nâng cấp này, tự dựng từ primitive.

| môn | dấu hiệu nhận diện ở thumbnail |
| --- | --- |
| baseball | Bệ cỏ hình kim cương, đất nâu, ba base và home plate trắng; gậy, bóng lớn có chỉ đỏ, găng da có túi bắt bóng và ngón tay. |
| field hockey | Bệ cỏ có vạch sân và vòng cung D; gậy móc cong dày, bóng trắng lớn và khung thành nhỏ. |
| hockey | Bệ băng xanh nhạt, vạch đỏ/xanh và vòng faceoff; puck đen lớn, gậy có bản lưỡi rộng và khung thành đỏ có lưới. |
| polo | Bệ cỏ, hai cột goal không xà ngang có đầu đỏ, gậy dài đầu búa lớn, bóng trắng và mũ polo có vành/đai cằm. |
| rugby | Bệ cỏ, cột goal chữ H màu navy để tăng tương phản, đệm chân cột và bóng rugby lớn có các đường kẻ đặt phía trước. |
| figure skating women | Bệ băng tròn có vệt cong; một bốt trắng cổ thon, cuff mở, dây buộc, đế nâu, lưỡi dài và toe pick. |
| figure skating pairs | Bệ băng có hai vệt cong giao nhau; hai bốt trắng thon đặt đối xứng, cùng lưỡi dao và toe pick. |
| olympic wrestling | Bệ thảm tròn nhiều vòng màu; hai hình người capsule đỏ/xanh đang khóa vai và ôm eo, có tay/chân và đầu cầu. |
| swimming | Bệ nước xanh, đúng ba dây phao đỏ/trắng, vạch T dưới đáy, bục xuất phát; mũ và kính phóng lớn đặt cạnh. |
| archery | Bệ cỏ, bia bắn tròn 5 vòng màu trên giá ba chân gỗ, một mũi tên cắm gần tâm, cung recurve dựng cạnh và mũi tên đặt trước. |
| boxing | Bệ võ đài vuông có 4 trụ góc, ba tầng dây đài xanh/trắng/đỏ và cặp găng tay boxing đỏ/xanh cỡ lớn đối diện ở giữa. |
| tennis | Bệ sân đất nện có vạch trắng, lưới căng ngang ở giữa, vợt tennis đan lưới đặt chéo và hai quả bóng vàng có chỉ trắng. |
| volleyball | Bệ sân gỗ có vạch 3m, lưới cao kèm ăng-ten đỏ/trắng hai bên và quả bóng chuyền cỡ lớn phối ba màu xanh/vàng/trắng. |

Ảnh gốc từng model vẫn render 640×520. Contact sheet ghép ảnh rộng tối đa 200 px
để đánh giá trực tiếp độ đọc của silhouette, màu nền và chi tiết chính.

## Tự tạo lại

Chạy ở thư mục gốc dự án với backend virtualenv đã cài dependencies theo README
(Pillow chỉ dùng ghép contact sheet, không cần cài vào Python của Blender):

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --factory-startup --python-exit-code 1 -P tools/blender/make_sport_models.py -- --out frontend/public/models
```

Tạo riêng một môn (dùng nguyên nhãn, bao gồm dấu cách):

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --factory-startup --python-exit-code 1 -P tools/blender/make_sport_models.py -- --out frontend/public/models --only 'figure skating pairs'
```

Script xóa cảnh giữa từng môn, cố định hình học và seed render, không đọc asset ngoài.
Blender 5.2 có thể đổi thứ tự tessellation khi chạy song song; script sắp xếp các bộ
ba chỉ số tam giác trong từng primitive sau export để byte tái lập. GLB màu đơn
không xuất UV (không có texture). Bước sắp xếp giữ
nguyên vertex, normal, vật liệu và thứ tự đỉnh của từng tam giác (winding).
Mỗi môn được bọc try/except; lỗi được ghi vào `generation_report.json`, các môn khác
vẫn chạy. GLB được kiểm tra rồi mới thay file đích. Manifest chỉ công bố những file
đã tạo thành công; `--only` giữ các mục thành công cũ còn tồn tại. Một môn lỗi sẽ bị
loại khỏi manifest, file thành công cũ nếu có vẫn giữ trên đĩa. Dùng `--python-exit-code 1`
để lỗi tổng kết trả mã thoát khác 0. Tính tái lập byte được kiểm tra trên Blender 5.2.1;
không cam kết SHA256 giống nhau giữa các phiên bản exporter.

Ảnh xem trước: `backend/debug_frames/model_previews/<slug>.png`.
Contact sheet: `backend/debug_frames/model_previews/contact_sheet.png`.
Báo cáo: `backend/debug_frames/model_previews/generation_report.json`.
Các ảnh/báo cáo debug bị gitignore và không commit. Đèn, nền và camera studio không
được export vào GLB. Contact sheet ghép bằng `tools/blender/contact_sheet.py`.

Kiểm tra liên kết tài liệu, tồn tại GLB, header/buffer nhị phân, hash, tam giác,
trục Y, tâm đáy và kích thước hình học từ vertex bằng `npm test` trong `frontend/`.
Bộ kiểm thử có thể chạy trên clean checkout không có `labels.json`; nếu nhãn cục bộ
có sẵn, test còn đối chiếu thứ tự/độ phủ của manifest với chính file đó.

Kiểm tra tích hợp riêng của generator (sau khi đã tạo đủ bộ GLB):

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --factory-startup --python-exit-code 1 -P tools/blender/verify_generator.py
```

Kiểm tra này chủ động gây lỗi ở basketball, xác nhận 19 môn khác vẫn hoàn tất,
khôi phục bằng `--only`, rồi đối chiếu byte của 20 GLB và toàn bộ manifest.
Chỉ bỏ qua render trong phép thử này; quá trình dựng và export thực sự chạy lại.
Kết quả thử nằm trong `backend/debug_frames/model_asset_checks/` (gitignore).

## Kết quả kiểm tra (2026-11-07)

- 20/20 GLB thành công, không có môn lỗi; tất cả dưới 2 MB và 30.000 tam giác.
- Đã xem contact sheet của đủ 20 môn, sửa hình giày/căn đáy và góc chụp qua hai vòng.
- Generator integration check pass: lỗi một môn không chặn môn khác; `--only` sửa
  đúng một mục; 20/20 GLB và manifest giống byte khi tạo lại.
- Frontend: 111 tests pass, `npx tsc --noEmit` và `npm run build` pass.
- Backend: `pytest -q` pass 141 tests, gồm golden tests. Chạy ngoài sandbox vì
  sandbox chặn socketpair nội bộ của asyncio/TestClient; không đổi code backend.
- SHA256 classifier/labels trước và sau tác vụ không thay đổi. Chưa kiểm thử AR
  trên điện thoại vì UI AR không thuộc phạm vi tác vụ này.

### Kiểm tra bản nâng cấp chín môn

- Chỉ tạo lại từng môn bằng `--only`; đúng 9 GLB và 9 bản ghi manifest thay đổi.
  Đối chiếu SHA256 và toàn bộ bản ghi xác nhận 11 môn còn lại giữ nguyên.
- Đã xem contact sheet ở độ rộng ảnh 200 px, qua hai vòng sửa: tăng độ đầy khung
  và tương phản cột goal; đưa dây buộc giày bám theo bề mặt thân bốt.
- Cả 9 model có cạnh dài nhất 0,330–0,360 m, bệ dày 0,015 m, Y-up và tâm đáy ở gốc.
  Từng file đều đạt giới hạn dung lượng/tam giác; số đo chi tiết nằm trong manifest.
- Generator integration check pass với 20/20 GLB và manifest giống byte khi dựng
  lại; kiểm tra lỗi riêng từng môn và sửa bằng `--only` vẫn pass.
- Frontend 111 tests, TypeScript, production build và backend 141 tests đều pass.
  Không sửa frontend, backend, classifier, labels hoặc preprocessing.

Đánh giá trực quan: **polo vẫn là môn kém đặc trưng nhất ở 200 px**, có thể nhầm
với croquet vì gậy đầu búa và bệ cỏ tương tự nhau; mũ polo và hai cột goal là dấu
hiệu phân biệt chính. Không có hình ngựa trong bố cục dụng cụ được yêu cầu.
Các chi tiết nhỏ như toe pick, dây găng và ô lưới rõ hơn trong ảnh 640×520;
ở 200 px, nhận diện chủ yếu dựa vào silhouette, bệ và dụng cụ lớn.

## Mô hình dự phòng và ảnh mẫu (giao diện một màn hình)

| tệp | nguồn và tác giả |
| --- | --- |
| `frontend/public/fallback/podium.glb` | tự tạo bằng `frontend/scripts/make-fallback-glb.mjs` (bục 3 bậc, mét, Y-up), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| `frontend/public/samples/basketball.jpg` | chép nguyên từ `datasets/anh-ngoai/basketball/1.jpg` (Wikimedia Commons, xem `sources.csv`) |
| `frontend/public/samples/formula-1.jpg` | chép nguyên từ `datasets/anh-ngoai/formula 1 racing/2.jpg` (Wikimedia Commons) |
| `frontend/public/samples/swimming.jpg` | chép nguyên từ `datasets/anh-ngoai/swimming/3.jpg` (Wikimedia Commons) |
| `frontend/public/samples/golf.jpg` | chép nguyên từ `datasets/anh-ngoai/golf/1.jpg` (Wikimedia Commons) |

Bục vinh quang hiện khi chưa có kết quả, khi kết quả chưa chắc chắn, khi môn chưa có
GLB riêng, hoặc khi GLB của môn tải lỗi. Mô hình dự phòng không mở AR.
