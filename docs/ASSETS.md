# 3D assets — Slice 5 asset preparation

Bộ 20 vật đại diện low-poly do nhóm SportSnap tự dựng hoàn toàn bằng Python/bpy.
GLB không dùng asset, texture, font hay add-on bên thứ ba. Exporter glTF có sẵn
trong **Blender 5.2.1 LTS**; vật liệu PBR màu đơn, roughness/metallic theo loại bề mặt.
Đây là bước chuẩn bị asset, chưa triển khai UI AR hoặc kiểm thử đặt vật trên điện thoại.

Theo yêu cầu tác vụ này, đường dẫn GLB là `frontend/public/models/` (thay cho
`models3d/` được dự kiến trong SPEC). Ánh xạ trong `frontend/src/lib/sports3d.ts`
đọc manifest, kiểm tra tệp tồn tại qua Vite glob; USDZ chưa được tạo.
Nút AR hiện tại vẫn là nút chờ bị vô hiệu hóa. README Run it không cần thêm bước
Blender vì GLB và manifest được commit sẵn.

Mỗi file dùng mét, trục Y hướng lên theo glTF, tâm đáy tại (0, 0, 0). Cảnh dựng nội bộ
của Blender dùng Z-up rồi exporter đổi sang Y-up. Giữ kích thước vật thể thật; khi làm
UI đặt trên bàn cần cho phép người dùng thu nhỏ các dụng cụ lớn (thuyền, xe, thảm, khung).
Giới hạn mỗi file: 2.000.000 byte và 30.000 tam giác, đo từ chính GLB sau export;
`manifest.json` lưu dung lượng, tam giác, kích thước `[X,Y,Z]` và SHA256.

| nhãn | file | nguồn và tác giả |
| --- | --- | --- |
| baseball | `frontend/public/models/baseball.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
| basketball | `frontend/public/models/basketball.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |
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
| uneven bars | `frontend/public/models/uneven_bars.glb` | tự tạo bằng Blender script (tools/blender/make_sport_models.py), tác giả nhóm SportSnap, không dùng asset bên thứ ba |

Giữ nguyên chính tả nhãn **canoe slamon** của mô hình. `football` được dựng là bóng
bầu dục Mỹ: đã xem ảnh `backend/debug_frames/model_compare/test_data/football/1.jpg`
(cầu thủ mặc đồ bảo hộ và cầm bóng bầu dục Mỹ). Đây là xác nhận từ ảnh mẫu cục bộ,
không phải xác minh toàn bộ dataset. Không thay đổi nhãn hoặc dữ liệu mô hình.
Hai giày nghệ thuật có lưỡi dao và toe pick; derby dùng quad, rollerblade dùng inline;
golf dùng hình học lõm dimple, không phải đốm màu; swimming chỉ gồm mũ rỗng và kính.
Số 7 trên stock car được dựng từ nét hình học, không dùng font hoặc nhãn hiệu xe.

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
trục Y, tâm đáy và kích thước thực từ vertex bằng `npm test` trong `frontend/`.
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
