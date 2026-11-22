# Kế hoạch giao Antigravity — Đợt 4: sửa độ khó bóng rổ + làm chặt test

> **Ghi chú (2026-11-20):** thiết kế gợi ý ở mục M2 bên dưới (`WIN 0.25`, `FAC 0.3`) **không đạt** tiêu chí M3 (chỉ 27/81 mẫu). Thông số thực tế đang dùng nằm trong `frontend/src/lib/interactive-ar/games.ts`: `T = 0.90`, `WIN = 0.265`, `FACTOR = 0.05`. Xem `docs/INTERACTIVE_AR.md`.


> Đọc `AGENTS.md`, `SPEC.md`, `docs/INTERACTIVE_AR.md` trước. Làm **từng slice một**, mỗi slice 1 commit `slice N: <summary>`.
> UI tiếng Việt; code, comment, commit message tiếng Anh. Không đụng `backend/models/*`, `labels.json`, `datasets/*`, `AGENTS.md`, `scripts/fetch_clean_external.py`.
> Nền hiện tại: HEAD `de50cb1` (slice L). `npm test` 216/216, `npm run test:e2e` 26/26.
> Mọi số ghi vào tài liệu phải lấy từ output test thật. Không tự viết kết quả.

## Bối cảnh: lỗi đã tìm thấy

Trong `e2e-report/results.json`, bóng rổ có `goals: 0` ở **cả 3 lượt chạy**. Mô phỏng lại đúng vật lý của game (`calculateBasketballVelocity`, trọng lực −9.8, bóng xuất phát `(0, 0.95, 2.1)`, vành rổ `(0, 2.15, −2.28)`, bán kính 0.225, điều kiện `isBasketballGoal`, bước 1/60 s, bỏ qua va bảng/vành) cho kết quả:

- Chỉ vuốt thẳng với tốc độ **1,64–1,72 px/ms** mới vào rổ, tức cửa sổ rộng khoảng 5%.
- Test e2e vuốt 1,50 px/ms, nên bóng rơi trước rổ khoảng 1,6 m.
- Người thật vuốt dao động hơn nhiều, nên gần như không ghi được bàn.

Nguyên nhân: tốc độ ngang (`forward`) và tốc độ lên (`upward`) cùng tăng theo một hệ số tuyến tính và bị kẹp `min/max` độc lập. Vì vậy hầu hết các tốc độ vuốt tạo ra quỹ đạo không đi qua vành.

---

## Slice M — Nới cửa sổ ghi bàn của bóng rổ

### M1. Đưa hằng số vật lý ra hàm thuần (trong `src/lib/interactive-ar/games.ts`)
- Export các hằng số đang hard-code trong `basketball-game.tsx`: `BASKETBALL_START = { x: 0, y: 0.95, z: 2.1 }`, `BASKETBALL_RIM = { x: 0, y: 2.15, z: -2.28 }`, `BASKETBALL_RIM_RADIUS = 0.225`, `BASKETBALL_GRAVITY = -9.8`.
- `basketball-game.tsx` **phải import** các hằng số này, không định nghĩa lại.
- Viết hàm thuần `simulateBasketballShot(velocity, options?)`. Hàm chạy cùng bước thời gian 1/60 s và cùng điều kiện `isBasketballGoal` như game, trả về `{ goal: boolean, closestAtRimHeight: number }`. Chưa cần mô phỏng va bảng/vành.

### M2. Đổi cách ánh xạ cú vuốt → vận tốc (sửa `calculateBasketballVelocity`)
Thiết kế đề nghị, Antigravity được phép chọn cách khác nếu đạt tiêu chí M3:
1. Tính **quỹ đạo lý tưởng** đi qua tâm vành khi bóng đang rơi, với thời gian bay cố định `T` (khoảng 0,85–1,0 s):
   - `vz = (rim.z − start.z) / T`
   - `vy = (rim.y − start.y − 0.5·g·T²) / T`
2. Lực vuốt `p = clamp(swipeSpeedY / S_REF, 0.5, 1.6)` với `S_REF ≈ 1.7` px/ms.
3. **Hỗ trợ ngắm** (aim assist) cho cú vuốt gần đúng: sai lệch `e = p − 1`.
   - Nếu `|e| ≤ 0.25` thì `e' = e · 0.3` (kéo về quỹ đạo lý tưởng).
   - Ngoài khoảng đó giữ nguyên `e`.
   - Vận tốc thực `= quỹ đạo lý tưởng · (1 + e')`.
4. Tốc độ ngang: `lateral = clamp(swipeSpeedX · k, −2.5, 2.5)`. Áp hỗ trợ ngắm tương tự để vuốt lệch nhẹ (|dx| nhỏ) vẫn vào.
5. Vẫn trả `null` khi `dy >= -20` (không vuốt lên).

### M3. Tiêu chí bắt buộc (unit test trong `tests/interactive-ar.test.mjs`)
Dùng `simulateBasketballShot(calculateBasketballVelocity(0, -s·100, 100))`, quét `s` theo bước 0,01:
- Với `s` trong **[1,30; 2,10]**: tối thiểu **80%** số mẫu là `goal: true`.
- Với `s ≤ 0,90` hoặc `s ≥ 2,80`: **không** mẫu nào ghi bàn (vẫn phải có trượt).
- Vuốt lệch: `dx = ±0,15·|dy|` ở `s = 1,7` vẫn ghi bàn; `dx = ±0,6·|dy|` thì trượt.
- In ra (`console.log` trong test hoặc comment) khoảng tốc độ ghi bàn thực tế để đưa vào tài liệu.
- Giữ nguyên test `isBasketballGoal` hiện có.

### M4. Giữ nguyên trải nghiệm
- Không đổi âm thanh, confetti, điểm +2, chữ tiếng Việt, va bảng/vành.
- Va bảng và vành vẫn hoạt động như cũ trong game. Kiểm thủ công 1 lần trên trình duyệt desktop: vuốt mạnh thì bóng đập bảng.

Commit: `slice M: widen basketball scoring window with aim assist`.

---

## Slice N — Làm chặt test e2e bóng rổ và báo cáo

### N1. `e2e/games.spec.ts` — bóng rổ
Thay test 5 cú vuốt 1,50 px/ms bằng 3 nhóm, mỗi nhóm 5 cú (giữ cách tính `dy` theo thời gian thực để chống jitter):

| Tốc độ vuốt | Điều kiện đạt |
|---|---|
| 1,70 px/ms | ít nhất **4/5** vào rổ |
| 1,35 px/ms và 2,05 px/ms | mỗi tốc độ ít nhất **2/5** vào rổ |
| 0,80 px/ms | **0/5** vào rổ (vẫn có trượt) |

- Sau nhóm 1,70, **bắt buộc** kiểm `localStorage['sportsnap.ar-best.basketball']` khác `null`. Bỏ câu `if (goals > 0)` ở dòng 92.
- Nút "Chơi lại" **bắt buộc** đưa điểm về 0 (lúc này điểm chắc chắn > 0).
- Đếm bàn thắng bằng chênh lệch `score` (mỗi bàn +2), không dùng `goals = currentSnap.score`.

### N2. Reset báo cáo mỗi lần chạy
- Thêm `globalSetup` trong `playwright.config.ts` để xóa `e2e-report/results.json` (và ảnh cũ) trước mỗi lần `npm run test:e2e`.
- Mỗi dòng kết quả thêm `runId` (thời gian bắt đầu chạy, ISO) để biết dòng thuộc lượt nào.

### N3. Môn mục tiêu di chuyển (chỉ đo, không bắt buộc đạt)
Với `hockey`, `field hockey`, `archery`, `polo`, `volleyball`: chạy **3 ván** mỗi môn trong một lượt, ghi `min / trung bình / max` điểm vào `results.json`. Không thêm điều kiện fail, đây là số liệu để chỉnh độ khó sau.

Commit: `slice N: strict basketball e2e and per-run report`.

---

## Slice O — Cập nhật tài liệu từ kết quả mới

1. Chạy `npm test`, rồi `npm run test:e2e` **3 lần liên tiếp**, phải pass cả 3.
2. Cập nhật `docs/INTERACTIVE_AR.md`:
   - **Mục 3/4:** mô tả cơ chế hỗ trợ ngắm của bóng rổ và khoảng tốc độ ghi bàn (số in ra từ test M3).
   - **Mục 6:** thay dòng bóng rổ bằng số đo mới (bàn thắng theo từng tốc độ). Thêm bảng min/trung bình/max cho 5 môn mục tiêu di chuyển. Ghi `runId` của lượt dùng làm số liệu.
   - **Giữ nguyên** mục "Chưa kiểm thử" (iPhone, Android thật, camera thật, AR đặt mô hình 3D, cảm giác người chơi thật).

Commit: `slice O: document basketball aim assist and measured results`.

---

## Điều kiện hoàn thành (mỗi slice)
1. `npx tsc --noEmit`, `npm test`, `npm run build`, `pytest -q` pass. Từ slice N: `npm run test:e2e` pass 3 lần liên tiếp.
2. `npx eslint` sạch trên các file đã sửa.
3. Báo cáo cuối:
   - Danh sách commit.
   - Khoảng tốc độ ghi bàn thực tế (số in từ test M3).
   - Bàn thắng bóng rổ theo từng tốc độ (từ `results.json`).
   - Dòng tổng kết thật của Playwright cho 3 lượt.
   - Hằng số đã đổi (cũ → mới).
4. Nếu không đạt được tiêu chí M3 mà vẫn giữ được cảm giác chơi, **dừng và báo cáo** khoảng đạt được. Không được hạ tiêu chí trong test cho xanh.
