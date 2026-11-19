# Kế hoạch giao Antigravity — AR tương tác cho 20 môn (SportSnap)

> Đọc `AGENTS.md` và `SPEC.md` trước. Làm **từng bước một**, mỗi bước 1 commit nhỏ: `slice N: <summary>`.
> UI tiếng Việt; code, comment, commit message tiếng Anh. Không đụng `backend/models/*`, `labels.json`, `datasets/*`.

## 1. Hiện trạng (đã làm xong, chưa commit)

Mục tiêu: người chơi tương tác được với cả 20 môn (basketball có game riêng bằng Three.js, 19 môn còn lại dùng engine canvas chung).

| File (trong `frontend/`) | Vai trò |
|---|---|
| `src/lib/interactive-ar/games.ts` | Cấu hình 19 môn + luật chơi (hàm thuần, có test) |
| `src/components/ar/sport-game.tsx` | Engine canvas 2D dùng chung, 3 chế độ: `shoot` (vuốt), `timing` (canh nhịp), `mash` (chạm liên tục) |
| `src/components/ar/use-camera-background.ts` | Hook camera nền, dọn stream đúng cách |
| `src/components/sport-ar-button.tsx` | Sửa: hiện tab/nút chơi cho mọi môn, `lazy()` tách bundle |
| `tests/interactive-ar.test.mjs` | 13 test mới |

Đã xác nhận: `npx tsc --noEmit` sạch, `npm test` 211/211, các file trên sạch ESLint.
**Chưa xác nhận:** `npm run build` (máy ảo thiếu native binding) và chưa chơi thử trên điện thoại.

## 2. Các bước cần làm (theo thứ tự)

### Bước 1 — Xác minh nền tảng (bắt buộc làm trước)
- Trong `frontend/`: `npm ci` (nếu cần) → `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
- Ghi lại lỗi lint có sẵn từ trước (`library.tsx`, `scan.tsx`…) — **không sửa**, chỉ báo cáo.
- Xác nhận sau build: `sport-game` và `basketball-game` nằm trong chunk riêng (three.js không còn trong chunk `index-*.js`).
- Commit: `slice A: verify interactive AR build`.

### Bước 2 — Chơi thử và chỉnh độ khó (trên trình duyệt + điện thoại thật)
- Chạy `run-local.cmd` / `phone-test.cmd` (cần HTTPS để mở camera trên điện thoại).
- Mở từng môn qua Thư viện hoặc Quét ảnh → "🎮 Chơi & xem AR". Chơi thử **cả 19 môn**, mỗi kiểu ít nhất 1 môn trên điện thoại.
- Checklist mỗi môn: game mở được; camera nền hiện (hoặc báo lỗi rõ khi bị từ chối); điểm/chuỗi/kỷ lục đúng; nút "Chơi lại" hoạt động; đóng dialog thì camera tắt; không lỗi console.
- Chỉnh độ khó **chỉ ở `games.ts`** (`targetRadius`, `targetSpeed`, `zone`, `sweepSpeed`, `goal`, `seconds`, `rival`). Mục tiêu: người chơi bình thường thắng/trúng khoảng 40–60%.
- Giữ test `goal / seconds <= 6` và test "mọi mục tiêu đều với tới được" luôn pass.
- Commit: `slice B: tune interactive AR difficulty`.

### Bước 3 — Sửa các lỗi trong `basketball-game.tsx`
Đã kiểm tra, còn tồn tại:
1. Effect game phụ thuộc `[cameraActive]` → bật/tắt camera làm dựng lại cả scene Three.js (mất bóng/confetti đang bay, độ mờ sàn bị đóng băng). Sửa: dựng scene một lần, đổi độ mờ sàn qua ref.
2. Không dispose geometry/material/texture (chỉ `renderer.dispose()`) → rò bộ nhớ khi mở/đóng nhiều lần.
3. Camera tự viết lại: `video.play()` bị từ chối thì stream vẫn chạy. Dùng `useCameraBackground`.
4. Dùng cặp mouse + touch → nên chuyển sang Pointer Events như `sport-game.tsx`.
5. Prop `onClose` không dùng (bỏ hoặc dùng).
- Giữ nguyên gameplay, âm thanh, chữ tiếng Việt. Thêm test nhẹ nếu tách được logic.
- Commit: `slice C: fix basketball AR lifecycle`.

### Bước 4 — Va chạm camera giữa các màn hình
- `camera-scanner.tsx` mở `SportArDialog` sau khi đã nhả camera (`createCameraArHandoff`). Kiểm tra trên điện thoại thật: mở game từ màn Quét → đóng → camera quét hoạt động lại bình thường.
- Nếu game mở camera trước khi quét nhả xong thì thêm độ trễ/handoff tương tự `CAMERA_AR_RELEASE_MS`.
- Commit: `slice D: camera handoff for interactive AR`.

### Bước 5 — Tài liệu
- Cập nhật `README.md` / `docs/` (mục AR): mô tả 3 kiểu chơi, cách chỉnh độ khó trong `games.ts`, cách thêm game cho môn mới.
- Không bịa số liệu; không thêm metric nào ngoài `backend/data/experiments.json`.
- Commit: `slice E: document interactive AR games`.

## 3. Việc tùy chọn (chỉ làm nếu được yêu cầu thêm)
- Đưa file GLB của từng môn (`public/models/*.glb`) vào làm hình đại diện thay cho emoji.
- AR thật bằng WebXR để khung/rổ bám theo mặt phẳng (hiện chỉ là overlay lên video).
- Bàn phím cho chế độ `shoot` (hiện chỉ vuốt/kéo chuột; `timing`/`mash` đã có Space/Enter).

## 4. Điều kiện hoàn thành (mỗi bước)
1. `pytest -q`, `npm test`, `npx tsc --noEmit`, `npm run build` đều pass.
2. File mình đã sửa sạch `npx eslint <file>`.
3. Báo cáo cuối: file đã đổi, cách đã kiểm chứng, điểm không chắc chắn.
4. Không xóa/sửa file ngoài phạm vi từng bước.
