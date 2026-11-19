# Kế hoạch giao Antigravity — Đợt 2: sửa sau review (SportSnap Interactive AR)

> Đọc `AGENTS.md`, `SPEC.md`, `docs/INTERACTIVE_AR.md` trước. Làm **từng slice một**, mỗi slice 1 commit `slice N: <summary>`.
> UI tiếng Việt; code, comment, commit message tiếng Anh. Không đụng `backend/models/*`, `labels.json`, `datasets/*`.
> Nền hiện tại: HEAD `9cc5100` (slice E), `tsc` sạch, `npm test` 213/213.

## Slice F — Sửa luật thắng/thua chế độ `mash` (7 môn) — ƯU TIÊN CAO

**Lỗi:** sau slice B, ở cả 7 môn đối thủ cần hơn 10 giây mới về đích (`goal / rival > seconds`), nên đối thủ không bao giờ thắng. Người chơi chỉ thua vì hết giờ, kể cả khi thanh của mình **đang dẫn trước** đối thủ (ví dụ bơi lội: chạm 4 lần/giây → bạn 95%, đối thủ 90%, vẫn bị báo "Thua").

| Môn | goal | seconds | rival hiện tại | Đối thủ về đích sau |
|---|---|---|---|---|
| formula 1 racing | 48 | 10 | 4.4 | 10.9 s |
| rollerblade racing | 42 | 10 | 3.9 | 10.8 s |
| swimming | 42 | 10 | 3.8 | 11.1 s |
| roller derby | 42 | 10 | 3.8 | 11.1 s |
| canoe slamon | 38 | 10 | 3.5 | 10.9 s |
| olympic wrestling | 38 | 10 | 3.4 | 11.2 s |
| boxing | 35 | 10 | 3.1 | 11.3 s |

**Việc cần làm (trong `src/lib/interactive-ar/games.ts`):**
1. Sửa `mashSnapshot`: khi hết giờ mà chưa ai về đích, **ai tiến xa hơn thì thắng** (`you > rival` → `won`, ngược lại `lost`; bằng nhau → người chơi thắng, giữ quy ước hiện có).
2. Chỉnh `rival` để đối thủ về đích **ngay khoảng 10 giây** (`rival * seconds` nằm trong `[0.95, 1.05] * goal`), như vậy đối thủ thật sự có thể thắng. Gợi ý: F1 4.8, patin tốc độ 4.2, bơi 4.2, patin đối kháng 4.2, chèo thuyền 3.8, đấu vật 3.8, quyền anh 3.5. Nếu thấy quá khó thì giảm `goal`, **không** giảm `rival` xuống dưới khoảng trên.
3. `mashScore` vẫn giữ: thắng = 100 + 10/giây còn lại; thua = theo tiến độ (tối đa 50).
4. Không đổi `sport-game.tsx` trừ khi cần hiện chữ kết quả đúng (ví dụ "Hết giờ — bạn dẫn trước!").

**Test bắt buộc thêm/sửa trong `tests/interactive-ar.test.mjs`:**
- Hết giờ, người chơi dẫn trước → `won`; đối thủ dẫn trước → `lost`; bằng nhau → `won`.
- Mọi môn `mash`: `0.95 * goal <= rival * seconds <= 1.05 * goal`.
- Giữ ràng buộc cũ `goal / seconds <= 6`.
- Cập nhật bảng số trong `docs/INTERACTIVE_AR.md` mục 4 nếu số thay đổi.

Commit: `slice F: fair win rule for mash games`.

## Slice G — Không thử lại camera khi người dùng từ chối quyền

**Lỗi:** `use-camera-background.ts` thử lại sau 400 ms với **mọi** lỗi, kể cả khi người dùng bấm "Từ chối" → có thể hiện hộp xin quyền lần hai.

**Việc cần làm:**
1. Trong `catch`, chỉ thử lại khi lỗi là `NotReadableError` hoặc `AbortError` (camera đang bận nhả từ màn Quét). Với `NotAllowedError`, `SecurityError`, `NotFoundError`, `OverconstrainedError` → không thử lại, báo lỗi ngay.
2. Thông báo tiếng Việt theo loại lỗi:
   - `NotAllowedError`: "Bạn đã từ chối quyền camera. Vẫn chơi được ở chế độ nền ảo."
   - `NotFoundError`: "Không tìm thấy camera trên thiết bị."
   - còn lại: giữ câu hiện có.
3. Tách hàm thuần `shouldRetryCamera(errorName: string): boolean` (đặt trong `games.ts` hoặc file `lib/interactive-ar/camera.ts`) và viết test cho từng tên lỗi.

Commit: `slice G: skip camera retry on permission denial`.

## Slice H — Chơi thử thật trên điện thoại (không sửa code nếu không cần)

1. Chạy `phone-test.cmd` (HTTPS) trên ít nhất 1 điện thoại Android hoặc iPhone.
2. Chơi cả 20 môn, mỗi môn 1 ván. Ghi lại trong `docs/INTERACTIVE_AR.md` một bảng ngắn: môn, thiết bị, trình duyệt, camera mở được không, thắng/trúng mấy lượt, lỗi gặp phải.
3. Kiểm tra riêng: Quét ảnh → mở game → đóng → camera quét chạy lại bình thường (không `NotReadableError`).
4. Từ chối quyền camera 1 lần → xác nhận chỉ hiện hộp xin quyền **một** lần (kiểm chứng slice G).
5. Nếu chỉnh độ khó, chỉ sửa trong `games.ts` và ghi giá trị cũ → mới vào báo cáo.
6. **Không bịa kết quả**: môn nào chưa thử được thì ghi "chưa thử" và lý do.

Commit: `slice H: record on-device interactive AR test results`.

## Việc lặt vặt (gộp vào slice F)
- Commit `docs/ANTIGRAVITY_PLAN.md` và file này (`docs/ANTIGRAVITY_PLAN_2.md`) vào repo.
- Không commit `Claude outputs/`, `_moi_tai/`, `dataset_review_contact_sheet.png`, `AGENTS.md`, `scripts/fetch_clean_external.py` (đang sửa dở, ngoài phạm vi).

## Điều kiện hoàn thành (mỗi slice)
1. `npx tsc --noEmit`, `npm test`, `npm run build` pass; `pytest -q` (backend) pass.
2. `npx eslint` sạch trên các file đã sửa.
3. Báo cáo cuối: file đã đổi, lệnh đã chạy + kết quả, số đã chỉnh (cũ → mới), điểm chưa chắc chắn.
4. Không xóa/sửa file ngoài phạm vi slice.
