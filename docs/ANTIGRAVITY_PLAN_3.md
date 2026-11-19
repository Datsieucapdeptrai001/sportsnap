# Kế hoạch giao Antigravity — Đợt 3: tự động test AR không cần điện thoại

> Đọc `AGENTS.md`, `SPEC.md`, `docs/INTERACTIVE_AR.md` trước. Làm **từng slice một**, mỗi slice 1 commit `slice N: <summary>`.
> UI tiếng Việt; code, comment, commit message tiếng Anh. Không đụng `backend/models/*`, `labels.json`, `datasets/*`, `AGENTS.md`, `scripts/fetch_clean_external.py`.
> Nền hiện tại: HEAD `066e323` (slice H), `npm test` 215/215.

**Nguyên tắc quan trọng nhất:** mọi kết quả ghi vào tài liệu phải là **số do script đo và in ra**, lấy từ file báo cáo JSON mà test sinh ra. Không tự viết kết quả. Cái gì không đo được thì ghi "chưa kiểm thử" và lý do.

---

## Slice I — Sửa lại mục 6 của `docs/INTERACTIVE_AR.md` (làm trước)

Mục 6 hiện có nội dung không đúng sự thật:
- Bóng rổ ghi "Trúng 5/8 quả" nhưng game bóng rổ **không giới hạn 8 lượt**.
- 6.3 (chuyển camera) và 6.4 (từ chối quyền) được ghi như đã kiểm, nhưng môi trường không có webcam nên **không thể đã kiểm**.
- "Môi trường 2 – điện thoại thật" chưa từng chạy.

Việc cần làm: xóa bảng kết quả 6.2 và nội dung "kết quả" ở 6.3, 6.4. Thay bằng một dòng: "Chưa có kết quả đo; sẽ cập nhật từ báo cáo e2e (slice L). Chưa kiểm thử trên điện thoại thật." Giữ phần mô tả kịch bản.

Commit: `slice I: remove unverified device test results`.

---

## Slice J — Cài Playwright và hạ tầng e2e

`AGENTS.md` yêu cầu không thêm framework ngoài SPEC. Playwright được chủ dự án duyệt **chỉ ở dạng devDependency để test**, không vào bundle app. Ghi rõ điều này vào `docs/DECISIONS.md`.

1. Trong `frontend/`: `npm i -D @playwright/test` và `npx playwright install chromium`.
2. Tạo `frontend/playwright.config.ts`:
   - `testDir: 'e2e'`, `webServer` chạy `npm run dev` ở cổng 5173 (`reuseExistingServer: true`).
   - Project `mobile-chromium` dùng `devices['Pixel 7']` (viewport mobile, `hasTouch`, `isMobile`).
   - Cờ launch: `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream` (camera giả, tự cấp quyền).
   - `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`.
3. Thêm script `"test:e2e": "playwright test"` vào `package.json`. **Không** đưa e2e vào `npm test` (giữ `npm test` nhanh, chạy bằng `node --test` như cũ). Cập nhật `tsconfig`/ESLint để thư mục `e2e/` không làm hỏng `tsc --noEmit` và `npm run build`.
4. **Mock backend** trong test bằng `page.route('**/api/**', ...)`, để không cần TensorFlow hay model. Đọc `src/lib/api.ts` để trả JSON đúng kiểu, ví dụ `/api/classes` và `/api/predict` trả `{ label, confidence, is_uncertain, ... }` cho môn đang test.
5. **Theo dõi camera** bằng `page.addInitScript` bọc `navigator.mediaDevices.getUserMedia`:
   - Đếm số lần gọi vào `window.__gumCalls`.
   - Lưu mọi track trả về vào `window.__tracks`, để test kiểm `track.readyState`.
   - Cho phép test cấu hình lỗi giả: `window.__gumFailures = ['NotReadableError']` thì lần gọi đầu ném `DOMException` với tên đó.
6. **Hook đọc trạng thái game, chỉ dùng cho test:** trong `sport-game.tsx` và `basketball-game.tsx`, khi `import.meta.env.DEV` **và** URL có `?e2e=1`, gán `window.__SPORTSNAP_AR__` một hàm trả snapshot **chỉ đọc**:
   - `{ label, mode, phase, score, streak, left, result, best }`
   - Mode `timing` thêm `markerPos`, `zoneCenter`, `zoneWidth`; mode `shoot` thêm `targetX`, `targetY`; bóng rổ thêm `ballState`.
   - Không có điều kiện thì không gán gì. Build production phải không chứa chuỗi `__SPORTSNAP_AR__` (thêm 1 test `node --test` kiểm `dist/` sau build, hoặc kiểm bằng grep trong slice L).
7. Tạo `frontend/e2e/helpers.ts`: mở dialog AR cho một label (qua Thư viện hoặc kết quả quét mock, chọn đường nào ổn định nhất), đọc snapshot, vuốt (`page.mouse`/touch với tốc độ cụ thể), chạm.

Commit: `slice J: add playwright e2e harness with fake camera`.

---

## Slice K — Viết test e2e

Tất cả trong `frontend/e2e/`. Mỗi test ghi một dòng kết quả vào `frontend/e2e-report/results.json` (git-ignored), gồm môn, kịch bản, số đo, đạt hay không.

### K1. `games.spec.ts` — chơi tự động cả 20 môn
Với mỗi label trong `backend/models/labels.json`:
- Mở dialog → tab game hiện → bấm "Bắt đầu" (bóng rổ không có nút bắt đầu thì bỏ bước này).
- **Môn vuốt (7):** đọc `targetX`, tính cú vuốt theo đúng công thức của `landingFromSwipe`:
  - Muốn `y = TARGET_Y` thì `power = 0.75`, tức tốc độ khoảng 1,9 px/ms.
  - `lean = (targetX - 0.5) * 2`, `dx = lean * |dy|`.
  - Vuốt đủ 8 lượt. Ghi số lượt trúng. **Điều kiện đạt:** ván kết thúc, có màn kết quả, môn có mục tiêu đứng yên (`football`, `golf`) trúng ít nhất 6/8. Môn mục tiêu di chuyển chỉ ghi số đo, không bắt buộc.
- **Môn canh nhịp (5):** lặp `requestAnimationFrame`/poll snapshot, chạm khi `|markerPos - zoneCenter| < zoneWidth * 0.15`. Ghi số HOÀN HẢO, TỐT, TRƯỢT. **Đạt:** ván kết thúc, ít nhất 6/8 không trượt. Riêng `high jump`: độ cao xà tăng đúng 0,05 m mỗi lần thành công.
- **Môn chạm liên tục (7):** hai kịch bản.
  - Chạm 6 lần/giây → phải **thắng**.
  - Chạm 2 lần/giây → phải **thua**.
  - Ghi thời gian về đích đo được.
- **Bóng rổ:** vuốt 5 lần, mỗi lần đợi `ballState` về `idle`. Ghi số lần vào rổ. **Đạt:** bóng bay (`ballState` chuyển `flying`) ở cả 5 lần, không lỗi console.
- **Mọi môn:**
  - Không có `console.error` hay `pageerror`.
  - Kỷ lục `localStorage['sportsnap.ar-best.<label>']` được ghi sau ván.
  - Bấm "Chơi lại" thì điểm về 0.
  - Chụp 1 ảnh màn hình vào `e2e-report/<label>.png`.

### K2. `camera.spec.ts` — camera
1. **Camera giả mở được:** mở game bất kỳ, sau khoảng 1 giây `video.readyState >= 2` và có `videoWidth > 0`.
2. **Đóng dialog nhả camera:** đóng dialog, sau 500 ms mọi track trong `__tracks` có `readyState === 'ended'`.
3. **Bật/tắt camera không mất ván:** đang chơi bấm nút camera 2 lần, `score` và `phase` giữ nguyên. Bóng rổ thì quả bóng đang bay không bị reset.
4. **Từ chối quyền (slice G):** chạy project riêng **không** có cờ `--use-fake-ui-for-media-stream` và không cấp quyền `camera` cho context, để `getUserMedia` ném `NotAllowedError`.
   - `__gumCalls === 1` sau 2 giây (không thử lại).
   - Hiện câu "Bạn đã từ chối quyền camera…".
   - Game vẫn chơi được.
5. **Camera bận (thử lại một lần):** `__gumFailures = ['NotReadableError']` → `__gumCalls === 2` và cuối cùng video chạy. `__gumFailures = ['NotReadableError','NotReadableError']` → đúng 2 lần gọi, rồi hiện câu báo lỗi.
6. **Chuyển camera Quét → game → Quét:** mở trang Quét với `/api/predict` mock.
   - Camera quét chạy → kết quả hiện → mở game AR. Tại thời điểm game mở camera, track của màn Quét đã `ended`, nghĩa là không có hai track `live` cùng lúc. Kiểm bằng cách ghi thời điểm mở/đóng từng track.
   - Đóng game → màn Quét có video chạy lại.

### K3. Chạy và lặp
- Chạy `npm run test:e2e` **3 lần liên tiếp**. Test nào lúc pass lúc fail thì sửa cho ổn định (chờ theo snapshot, không dùng `waitForTimeout` cố định nếu tránh được) trước khi commit.
- Test nào fail do **lỗi thật của app**: sửa app trong cùng slice nếu nhỏ, còn lớn thì dừng và báo cáo, không sửa test cho xanh.

Commit: `slice K: e2e tests for 20 AR games and camera lifecycle`.

---

## Slice L — Ghi kết quả đo thật vào tài liệu

1. Chạy `npm run build`, xác nhận `dist/` **không** chứa `__SPORTSNAP_AR__`.
2. Chạy `npm run test:e2e`. Từ `e2e-report/results.json`, viết lại mục 6 của `docs/INTERACTIVE_AR.md`:
   - **Môi trường:** Playwright, phiên bản Chromium, thiết bị giả lập Pixel 7, camera giả, ngày chạy.
   - **Bảng 20 môn:** chỉ số đo thật (lượt trúng, kết quả thắng/thua theo từng tốc độ chạm, thời gian về đích).
   - **Kết quả kiểm thử camera:** K2.1 → K2.6, đạt hay không.
   - **Mục "Chưa kiểm thử"** (bắt buộc giữ): Safari iOS, Chrome Android trên máy thật, camera phần cứng thật, Scene Viewer / Quick Look (AR đặt mô hình 3D), cảm giác chơi và độ khó với người thật.
3. Thêm vào `README.md` cách chạy: `cd frontend && npx playwright install chromium && npm run test:e2e`.

Commit: `slice L: document measured e2e results`.

---

## Điều kiện hoàn thành (mỗi slice)
1. `npx tsc --noEmit`, `npm test`, `npm run build` pass; `pytest -q` pass. Từ slice K trở đi: `npm run test:e2e` pass 3 lần liên tiếp.
2. `npx eslint` sạch trên các file đã sửa.
3. Báo cáo cuối:
   - File đã đổi.
   - Lệnh đã chạy và **output thật** (dán dòng tổng kết của Playwright).
   - Test nào fail và đã sửa gì.
   - Những gì vẫn chưa kiểm thử được.
4. Không commit `e2e-report/`, `test-results/`, `playwright-report/` (thêm vào `.gitignore`).
