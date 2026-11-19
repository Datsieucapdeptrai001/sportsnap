# SportSnap — Tài liệu AR tương tác (Interactive AR)

Tài liệu hướng dẫn kiến trúc, 3 chế độ chơi, cách điều chỉnh độ khó và cách mở rộng thêm môn thể thao tương tác trong SportSnap.

---

## 1. Tổng quan kiến trúc

Toàn bộ 20 môn thể thao trong SportSnap đều hỗ trợ trải nghiệm tương tác AR trực tiếp:
- **Bóng rổ (`basketball`)**: Sử dụng Three.js riêng biệt (`frontend/src/components/ar/basketball-game.tsx`) mô phỏng vật lý 3D, bóng rổ xoay ngược (backspin), bảng rổ, vành rổ, lưới và nảy sàn.
- **19 môn còn lại**: Sử dụng chung engine Canvas 2D (`frontend/src/components/ar/sport-game.tsx`) được điều khiển bằng cấu hình thuần túy (`frontend/src/lib/interactive-ar/games.ts`).
- **Code splitting**: Các module game và Three.js được tải động qua `lazy()` trong `SportArDialog` (`sport-ar-button.tsx`), đảm bảo bundle chính `index-*.js` không bị phình to.

---

## 2. Ba kiểu chơi chính

### 2.1. Chế độ Vuốt (`shoot` — 7 môn)
Áp dụng cho các môn có hành động ném, sút, đánh bóng hoặc bắn:
- **Các môn**: `football`, `golf`, `hockey`, `field hockey`, `archery`, `polo`, `volleyball`.
- **Cơ chế**:
  - Người chơi vuốt lên trên màn hình (`PointerEvent`).
  - Hướng vuốt (độ lệch ngang $\Delta x / |\Delta y|$) xác định cột và hướng đi.
  - Tốc độ vuốt ($\sqrt{\Delta x^2 + \Delta y^2} / \Delta t$) xác định lực và độ xa của quỹ đạo bay.
  - Mỗi ván có **8 lượt**.
  - Trúng đích nhận +2 điểm (riêng `archery` tính theo khoảng cách tâm: 10 / 7 / 4 điểm).
  - Từ chuỗi 3 lần trúng liên tiếp trở lên nhận thêm +1 điểm thưởng chuỗi.

### 2.2. Chế độ Canh nhịp (`timing` — 5 môn)
Áp dụng cho các môn đòi hỏi phản xạ canh thời điểm chuẩn xác:
- **Các môn**: `baseball`, `tennis`, `high jump`, `uneven bars`, `figure skating women`.
- **Cơ chế**:
  - Con trỏ chuyển động qua lại theo sóng tam giác (triangle wave).
  - Người chơi chạm màn hình (hoặc bấm phím Space / Enter) khi con trỏ ở trong vùng xanh:
    - Ngay tâm ($\le 20\%$ vùng xanh): **HOÀN HẢO (+3 điểm)**.
    - Trong vùng xanh ($\le 50\%$ vùng xanh): **TỐT (+1 điểm)**.
    - Ngoài vùng xanh: **TRƯỢT (0 điểm)**.
  - Vùng xanh tự động thu nhỏ 8% sau mỗi lần thành công liên tiếp (tối thiểu không nhỏ hơn 8%).
  - Môn **nhảy cao (`high jump`)** hiển thị xà nhảy thực tế và nâng xà dần (+0.05 m sau mỗi lần vượt xà thành công, bắt đầu từ 1.80 m).
  - Mỗi ván gồm **8 lượt**.

### 2.3. Chế độ Chạm liên tục (`mash` — 7 môn)
Áp dụng cho các môn đua tốc độ hoặc đọ sức đối kháng:
- **Các môn**: `swimming`, `canoe slamon`, `rollerblade racing`, `roller derby`, `formula 1 racing`, `olympic wrestling`, `boxing`.
- **Cơ chế**:
  - Cuộc đua kéo dài 10 giây (kèm 0.7 giây chuẩn bị "Sẵn sàng…").
  - Người chơi chạm màn hình (hoặc phím Space / Enter) liên tục để tích luỹ số lần chạm (`goal`) trước đối thủ máy (`rival`).
  - Thắng (chạm đủ mục tiêu trước đối thủ và trước hết giờ): Nhận 100 điểm + 10 điểm cho mỗi giây còn lại.
  - Thua: Nhận điểm dựa trên phần trăm tiến độ đã hoàn thành (tối đa 50 điểm).

### 2.4. Trò chơi 3D Three.js riêng biệt (`basketball`)
Dành riêng cho bóng rổ mô phỏng vật lý 3D:
- **Hằng số vật lý chuẩn hóa**:
  - Tọa độ xuất phát bóng: `BASKETBALL_START = { x: 0, y: 0.95, z: 2.1 }`
  - Vị trí tâm vành rổ: `BASKETBALL_RIM = { x: 0, y: 2.15, z: -2.28 }`
  - Bán kính vành rổ: `BASKETBALL_RIM_RADIUS = 0.225` m
  - Gia tốc trọng trường: `BASKETBALL_GRAVITY = -9.8` m/s²
- **Cơ chế hỗ trợ ngắm (Aim Assist)**:
  - Tính toán quỹ đạo lý tưởng qua tâm vành với thời gian bay cố định $T = 0.90$ s:
    - $v_z = (\text{rim.z} - \text{start.z}) / T$
    - $v_y = (\text{rim.y} - \text{start.y} - 0.5 \cdot g \cdot T \cdot (T + 1/60)) / T$
  - Lực vuốt: $p = \text{swipeSpeedY} / S_{REF}$ với $S_{REF} = 1.70$ px/ms.
  - Sai lệch $e = p - 1$. Trong cửa sổ $|e| \le 0.265$, sai số được nén mạnh bằng hệ số $0.01$ ($e' = e \cdot 0.01$) để kéo quỹ đạo về gần quỹ đạo chuẩn vào rổ.
  - Hỗ trợ góc ngang: độ lệch góc $\Delta x / |\Delta y|$ trong cửa sổ $\pm 0.22$ được nén theo hệ số $0.15$.
  - Khoảng tốc độ vuốt ghi bàn thực tế: **1.21 đến 2.18 px/ms (98 tốc độ)** (đo bởi unit test M3).
  - Vuốt quá yếu ($s \le 0.90$ px/ms) hoặc quá mạnh ($s \ge 2.80$ px/ms) hoặc lệch góc lớn ($|\Delta x| \ge 0.60 |\Delta y|$) đều trượt hoàn toàn.

---

## 3. Quản lý vòng đời và Handoff Camera

1. **Camera nền (`useCameraBackground`)**:
   - Mở camera sau (`facingMode: "environment"`) nằm dưới lớp canvas/Three.js.
   - Khi unmount, tự động dừng (`track.stop()`) và giải phóng stream.
2. **Handoff an toàn giữa màn hình Quét và Dialog (`CAMERA_AR_RELEASE_MS`)**:
   - Tránh lỗi xung đột phần cứng camera (`NotReadableError`) trên Android/iOS bằng cách trì hoãn `CAMERA_AR_RELEASE_MS = 400` ms trước khi game bắt đầu chiếm camera.
   - Nếu phần cứng camera của thiết bị phản hồi chậm, hook có cơ chế tự động thử lại 1 lần sau 400 ms trước khi chuyển sang nền ảo.
3. **Chống rò rỉ bộ nhớ Three.js**:
   - Scene trong `basketball-game.tsx` chỉ khởi tạo một lần duy nhất.
   - Độ mờ sân đấu (khi bật/tắt camera) được điều chỉnh thông qua reference của material thay vì tái tạo scene.
   - Toàn bộ mesh, geometry, material và texture đều được duyệt và dispose đầy đủ khi đóng dialog.

---

## 4. Cách điều chỉnh độ khó trong `frontend/src/lib/interactive-ar/games.ts`

Mọi hằng số độ khó đều tập trung trong `SPORT_GAMES`:

```ts
export const SPORT_GAMES: Readonly<Record<string, SportGameConfig>> = {
  // shoot
  golf: { targetRadius: 0.13, targetSpeed: 0, ... },
  hockey: { targetRadius: 0.20, targetSpeed: 0.28, ... },

  // timing
  baseball: { zone: 0.24, sweepSpeed: 0.70, ... },
  'uneven bars': { zone: 0.20, sweepSpeed: 0.85, ... },

  // mash
  'formula 1 racing': { goal: 48, seconds: 10, rival: 4.8, ... },
  swimming: { goal: 42, seconds: 10, rival: 4.2, ... },
}
```

### Hướng dẫn tinh chỉnh:
- **Để game ném (`shoot`) dễ hơn**: Tăng `targetRadius` (ví dụ `0.18` $\to$ `0.22`), giảm `targetSpeed`.
- **Để game canh nhịp (`timing`) dễ hơn**: Tăng `zone` (ví dụ `0.20` $\to$ `0.24`), giảm `sweepSpeed`.
- **Để game chạm liên tục (`mash`) dễ hơn**: Giảm `goal` hoặc giảm `rival`.
- **Để game bóng rổ 3D (`basketball`) nới rộng cửa sổ vào rổ**:
  - Hằng số ngắm: `BASKETBALL_S_REF = 1.70` px/ms, `BASKETBALL_AIM_T = 0.90` s.
  - Cửa sổ hỗ trợ lực vuốt: `BASKETBALL_ASSIST_WIN = 0.265`, `BASKETBALL_ASSIST_FACTOR = 0.01`.
  - Cửa sổ hỗ trợ góc ngang: `BASKETBALL_LATERAL_WIN = 0.22`, `BASKETBALL_LATERAL_FACTOR = 0.15`.
- **Ràng buộc kiểm thử bắt buộc (tests pass)**:
  - `goal / seconds <= 6` (tốc độ chạm người chơi tối đa có thể duy trì).
  - `targetSpeed <= 0.6`.
  - `zone >= 0.15`.
  - Mọi mục tiêu đều phải có vận tốc vuốt với tới được (`TARGET_Y = 0.3`).
  - Bóng rổ 3D: quét tốc độ $s \in [1.30, 2.10]$ px/ms phải đạt $\ge 80\%$ bàn thắng trong mô phỏng `simulateBasketballShot()`. Với $s \le 0.90$ hoặc $s \ge 2.80$ px/ms phải trượt 100%. Lệch ngang $\pm 0.15 |\Delta y|$ vào rổ, $\pm 0.60 |\Delta y|$ trượt.

---

## 5. Cách thêm trò chơi cho môn thể thao mới

Khi bổ sung nhãn thể thao mới vào hệ thống:

1. **Thêm cấu hình vào `SPORT_GAMES` trong `frontend/src/lib/interactive-ar/games.ts`**:
   ```ts
   'badminton': {
     mode: 'shoot',
     title: 'Đánh cầu lông',
     hint: 'Vuốt lên để đập cầu qua lưới',
     icon: '🏸',
     prop: '🏸',
     accent: '#065f46',
     targetKind: 'court',
     targetRadius: 0.20,
     targetSpeed: 0.25,
   }
   ```
2. **Cập nhật danh mục tên tiếng Việt** trong `frontend/src/lib/sport-names.ts`.
3. **Chạy kiểm thử đơn vị**:
   ```bash
   cd frontend
   npm test
   ```
   Kiểm tra `tests/interactive-ar.test.mjs` để xác nhận tất cả ràng buộc hợp lệ.
4. Nút bấm tại Quét / Thư viện / Bulk sẽ tự động hiển thị **"🎮 Chơi & xem AR"** và mở tab trò chơi tương ứng.

---

## 6. Kết quả kiểm thử thực tế và chơi thử trên thiết bị

### 6.1. Môi trường và phương pháp kiểm thử tự động (E2E)
- **Framework kiểm thử**: Playwright (`@playwright/test` v1.65.1)
- **Trình duyệt**: Chromium version `159.0.8154.6`
- **Thiết bị giả lập**: `Pixel 7` (viewport: 393×851, DPR: 2.75, hỗ trợ cảm ứng màn hình `hasTouch: true`, di động `isMobile: true`)
- **Nguồn cấp camera**: Luồng video giả lập (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`)
- **Ngày chạy kiểm thử**: 20/11/2026
- **Kết quả tổng thể**: **26/26 tests PASS** qua 3 lượt chạy toàn diện liên tiếp không phát sinh lỗi bất thường (flake) (Run 1: 9.3m, Run 2: 9.2m, Run 3: 9.2m). Dữ liệu được trích xuất trực tiếp từ tệp báo cáo `frontend/e2e-report/results.json` với `runId: "2026-11-19T18:18:16.038Z"`.

### 6.2. Bảng số đo thực tế 20 môn thể thao (Playwright E2E)

| STT | Môn thể thao (label) | Chế độ | Kịch bản kiểm thử | Số đo thực tế | Kỷ lục `localStorage` | Đánh giá |
|:---:|:---|:---:|:---|:---|:---:|:---:|
| 1 | `basketball` | 3D Three.js | 4 nhóm tốc độ vuốt: 1.70 px/ms, 1.35 px/ms, 2.05 px/ms (mỗi nhóm 5 quả), 0.80 px/ms (5 quả) | 1.70: 5/5 vào rổ; 1.35: 5/5 vào rổ; 2.05: 5/5 vào rổ; 0.80: 0/5 vào rổ. Reset điểm về 0 thành công khi bấm "Chơi lại". | `10` | **ĐẠT** (đáp ứng điều kiện ≥4/5, ≥2/5, ≥2/5 và 0/5) |
| 2 | `football` | `shoot` | 8 lượt vuốt khung thành đứng yên | Điểm cuối: 22, trúng mục tiêu | `22` | **ĐẠT** (≥ 12 điểm) |
| 3 | `golf` | `shoot` | 8 lượt vuốt đưa bóng vào lỗ | Điểm cuối: 22, trúng mục tiêu | `22` | **ĐẠT** (≥ 12 điểm) |
| 4 | `hockey` | `shoot` | 3 ván vuốt khung thành di động | Điểm 3 ván: [4, 2, 6], min: 2, avg: 4.0, max: 6 | `6` | **ĐẠT** (hoàn tất 3 ván, có số liệu) |
| 5 | `field hockey` | `shoot` | 3 ván vuốt khung thành di động | Điểm 3 ván: [2, 4, 4], min: 2, avg: 3.3, max: 4 | `4` | **ĐẠT** (hoàn tất 3 ván, có số liệu) |
| 6 | `archery` | `shoot` | 3 ván vuốt bia ngắm vòng điểm | Điểm 3 ván: [21, 15, 18], min: 15, avg: 18.0, max: 21 | `21` | **ĐẠT** (hoàn tất 3 ván, có số liệu) |
| 7 | `polo` | `shoot` | 3 ván vuốt cổng dịch chuyển | Điểm 3 ván: [4, 4, 4], min: 4, avg: 4.0, max: 4 | `4` | **ĐẠT** (hoàn tất 3 ván, có số liệu) |
| 8 | `volleyball` | `shoot` | 3 ván vuốt vào ô trống qua lưới | Điểm 3 ván: [6, 2, 6], min: 2, avg: 4.7, max: 6 | `6` | **ĐẠT** (hoàn tất 3 ván, có số liệu) |
| 9 | `baseball` | `timing` | 8 lượt canh nhịp vung gậy | Điểm cuối: 14 | `14` | **ĐẠT** (≥ 6 điểm) |
| 10 | `tennis` | `timing` | 8 lượt canh nhịp đánh trả bóng | Điểm cuối: 14 | `14` | **ĐẠT** (≥ 6 điểm) |
| 11 | `high jump` | `timing` | 8 lượt bật nhảy qua xà | Điểm cuối: 16 (xà nâng +0.05m mỗi lần qua) | `16` | **ĐẠT** (≥ 6 điểm) |
| 12 | `uneven bars` | `timing` | 8 lượt buông tay trên xà lệch | Điểm cuối: 14 | `14` | **ĐẠT** (≥ 6 điểm) |
| 13 | `figure skating women` | `timing` | 8 lượt canh nhịp hạ cánh cú xoay | Điểm cuối: 14 | `14` | **ĐẠT** (≥ 6 điểm) |
| 14 | `swimming` | `mash` | Chạm nhanh (6 tap/s) vs Chạm chậm (2 tap/s) | Nhanh: Thắng (117 điểm, 8.4s) / Chậm: Thua (23 điểm, 10.2s) | `117` | **ĐẠT** (nhanh thắng, chậm thua) |
| 15 | `canoe slamon` | `mash` | Chạm nhanh (6 tap/s) vs Chạm chậm (2 tap/s) | Nhanh: Thắng (128 điểm, 7.3s) / Chậm: Thua (25 điểm, 10.3s) | `128` | **ĐẠT** (nhanh thắng, chậm thua) |
| 16 | `rollerblade racing` | `mash` | Chạm nhanh (6 tap/s) vs Chạm chậm (2 tap/s) | Nhanh: Thắng (115 điểm, 8.6s) / Chậm: Thua (21 điểm, 10.2s) | `115` | **ĐẠT** (nhanh thắng, chậm thua) |
| 17 | `roller derby` | `mash` | Chạm nhanh (6 tap/s) vs Chạm chậm (2 tap/s) | Nhanh: Thắng (119 điểm, 8.2s) / Chậm: Thua (23 điểm, 10.4s) | `119` | **ĐẠT** (nhanh thắng, chậm thua) |
| 18 | `formula 1 racing` | `mash` | Chạm nhanh (6 tap/s) vs Chạm chậm (2 tap/s) | Nhanh: Thắng (108 điểm, 9.3s) / Chậm: Thua (20 điểm, 10.3s) | `108` | **ĐẠT** (nhanh thắng, chậm thua) |
| 19 | `olympic wrestling` | `mash` | Chạm nhanh (6 tap/s) vs Chạm chậm (2 tap/s) | Nhanh: Thắng (130 điểm, 7.1s) / Chậm: Thua (25 điểm, 10.1s) | `130` | **ĐẠT** (nhanh thắng, chậm thua) |
| 20 | `boxing` | `mash` | Chạm nhanh (6 tap/s) vs Chạm chậm (2 tap/s) | Nhanh: Thắng (134 điểm, 6.7s) / Chậm: Thua (27 điểm, 10.1s) | `134` | **ĐẠT** (nhanh thắng, chậm thua) |

### 6.2.1. Thống kê 3 ván kiểm thử cho 5 môn mục tiêu di chuyển (Moving Targets)

| Môn thể thao | Điểm 3 ván (`scores`) | Điểm thấp nhất (`min`) | Điểm trung bình (`avg`) | Điểm cao nhất (`max`) | Kỷ lục lưu |
|:---|:---:|:---:|:---:|:---:|:---:|
| `hockey` | `[4, 2, 6]` | 2 | 4.0 | 6 | `6` |
| `field hockey` | `[2, 4, 4]` | 2 | 3.3 | 4 | `4` |
| `archery` | `[21, 15, 18]` | 15 | 18.0 | 21 | `21` |
| `polo` | `[4, 4, 4]` | 4 | 4.0 | 4 | `4` |
| `volleyball` | `[6, 2, 6]` | 2 | 4.7 | 6 | `6` |

### 6.3. Kết quả kiểm thử vòng đời camera (K2.1 - K2.6)
- **K2.1 (Camera giả mở thành công)**: Mở game golf, video nền kích hoạt trơn tru, `readyState = 4`, độ phân giải `1280×720` $\to$ **ĐẠT**.
- **K2.2 (Đóng dialog giải phóng camera)**: Đóng dialog trò chơi bắn cung, sau 500 ms tất cả track trong `__tracks` đều chuyển trạng thái `readyState === 'ended'` (`allEnded: true`) $\to$ **ĐẠT**.
- **K2.3 (Bật/tắt camera không mất ván)**: Bấm nút camera 2 lần trong trận bóng rổ, game giữ nguyên trạng thái (`phaseBefore: "playing"` $\to$ `phaseAfter: "playing"`), scene Three.js không bị dựng lại $\to$ **ĐẠT**.
- **K2.4 (Từ chối quyền Camera - Slice G)**: Khi quyền camera bị từ chối (`NotAllowedError`), `getUserMedia` chỉ gọi đúng 1 lần duy nhất (`gumCalls === 1`), giao diện hiển thị câu thông báo tiếng Việt "Bạn đã từ chối quyền camera...", không lặp lại hỏi quyền vô tận, người chơi vẫn chơi game bình thường $\to$ **ĐẠT**.
- **K2.5 (Xử lý camera bận / thiết bị tạm khóa)**: Khi camera gặp lỗi bận tạm thời (`NotReadableError`), hệ thống tự động thử lại đúng 1 lần (`retryAttempts === 2`) rồi mở video thành công $\to$ **ĐẠT**.
- **K2.6 (Chuyển đổi camera Quét $\leftrightarrow$ Game AR)**: Ở màn hình Quét, mở game AR thì camera Quét được nhả hoàn tất trước khi game kích hoạt track mới; khi đóng game, camera Quét tự động bật lại (`handoffClean: true`), không xảy ra tình trạng xung đột giữ 2 track cùng live $\to$ **ĐẠT**.

### 6.4. Các hạng mục chưa kiểm thử (Bảo lưu)
Các nội dung sau đây **chưa được kiểm thử trên thiết bị phần cứng thật** và được ghi nhận rõ ràng:
- Trình duyệt Safari trên iOS (iPhone/iPad thật).
- Trình duyệt Chrome / WebView trên điện thoại Android thật.
- Cảm biến camera phần cứng thật (tính năng phơi sáng tự động, lấy nét và độ trễ phần cứng thực tế).
- Chế độ WebXR / Scene Viewer / Quick Look (tính năng AR neo mô hình 3D thực tế trên mặt phẳng sàn nhà/bàn).
- Cảm giác vuốt và độ khó chơi thực tế từ người dùng thật.


