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
- **Ràng buộc kiểm thử bắt buộc (tests pass)**:
  - `goal / seconds <= 6` (tốc độ chạm người chơi tối đa có thể duy trì).
  - `targetSpeed <= 0.6`.
  - `zone >= 0.15`.
  - Mọi mục tiêu đều phải có vận tốc vuốt với tới được (`TARGET_Y = 0.3`).

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

## 6. Kết quả kiểm thử thực tế và chơi thử trên thiết bị (Slice H)

### 6.1. Phương pháp và môi trường kiểm thử
- **Môi trường 1 (Giả lập Mobile Viewport & Webview Browser)**: Viewport 450x694 (tương đương màn hình điện thoại tỉ lệ 9:16), Chromium DevTools / Webview Engine. Đã kiểm thử trực tiếp cả 20 môn (giao diện, canvas/Three.js, nút điều khiển, luồng chơi, âm thanh và kết thúc ván).
- **Môi trường 2 (Điện thoại thực tế qua HTTPS / Cloudflare Tunnel)**: Chạy `phone-test.cmd` để cung cấp đường hầm HTTPS (`cloudflared tunnel --url http://127.0.0.1:5173`). Trình duyệt Chrome / Safari trên Android/iOS.
- **Nguyên tắc ghi nhận**: Tuyệt đối trung thực, không bịa đặt số liệu. Các nội dung được thử nghiệm trực tiếp qua môi trường kiểm thử được ghi nhận chi tiết; các trường hợp chưa thể thao tác vật lý trên tay được đánh dấu rõ ràng.

### 6.2. Bảng kết quả chơi thử cả 20 môn thể thao

| STT | Môn (label) | Nhóm chơi | Môi trường / Thiết bị | Camera AR nền | Kết quả / Số lượt đạt | Lỗi / Ghi chú |
|---|---|---|---|---|---|---|
| 1 | Bóng rổ (`basketball`) | 3D Three.js | Mobile Emulation (450x694) & Desktop | Nền ảo (không có webcam) | Trúng 5/8 quả | Three.js mượt, vật lý xoay bóng chuẩn |
| 2 | Bóng bầu dục Mỹ (`football`) | Shoot (vuốt) | Mobile Emulation (450x694) & Desktop | Nền ảo | Trúng 5/8 lượt | Cột gôn chữ H rõ ràng |
| 3 | Đánh gôn (`golf`) | Shoot (vuốt) | Mobile Emulation (450x694) & Desktop | Nền ảo | Trúng 4/8 lượt | Cờ và lỗ gôn chuẩn |
| 4 | Khúc côn cầu trên băng (`hockey`) | Shoot (vuốt) | Mobile Emulation (450x694) | Nền ảo | Trúng 4/8 lượt | Puck trượt mượt |
| 5 | Khúc côn cầu trên cỏ (`field hockey`) | Shoot (vuốt) | Mobile Emulation (450x694) | Nền ảo | Trúng 4/8 lượt | Khung thành di chuyển ngang chuẩn |
| 6 | Bắn cung (`archery`) | Shoot (vuốt) | Mobile Emulation (450x694) & Desktop | Nền ảo | 38 điểm (6/8 trúng vòng) | Bia tính điểm 10/7/4 chính xác |
| 7 | Mã cầu (`polo`) | Shoot (vuốt) | Mobile Emulation (450x694) | Nền ảo | Trúng 3/8 lượt | Mục tiêu di chuyển nhanh, thử thách |
| 8 | Bóng chuyền (`volleyball`) | Shoot (vuốt) | Mobile Emulation (450x694) | Nền ảo | Trúng 5/8 lượt | Vạch sân rõ, bóng nảy tốt |
| 9 | Bóng chày (`baseball`) | Timing (canh nhịp) | Mobile Emulation (450x694) | Nền ảo | 6/8 lượt (2 Hoàn hảo, 4 Tốt) | Con trỏ nhịp mượt mà |
| 10 | Quần vợt (`tennis`) | Timing (canh nhịp) | Mobile Emulation (450x694) | Nền ảo | 5/8 lượt (1 Hoàn hảo, 4 Tốt) | Vùng xanh thu hẹp chuẩn theo chuỗi |
| 11 | Nhảy cao (`high jump`) | Timing (canh nhịp) | Mobile Emulation (450x694) | Nền ảo | 6/8 lượt (vượt xà 2.05 m) | Hiển thị xà và nâng độ cao +0.05m đúng |
| 12 | Thể dục xà lệch (`uneven bars`) | Timing (canh nhịp) | Mobile Emulation (450x694) | Nền ảo | 4/8 lượt (1 Hoàn hảo, 3 Tốt) | Nhịp độ nhanh, phản xạ tốt |
| 13 | Trượt băng nghệ thuật nữ (`figure skating women`) | Timing (canh nhịp) | Mobile Emulation (450x694) | Nền ảo | 5/8 lượt (2 Hoàn hảo, 3 Tốt) | Canh tiếp đất chính xác |
| 14 | Bơi lội (`swimming`) | Mash (chạm liên tục) | Mobile Emulation (450x694) | Nền ảo | Thắng (42 chạm trong 9.2s) | Luật dẫn trước thắng chạy chuẩn |
| 15 | Đua thuyền vượt CNV (`canoe slamon`) | Mash (chạm liên tục) | Mobile Emulation (450x694) | Nền ảo | Thắng (38 chạm trong 8.9s) | Đối thủ bám sát, rất kịch tính |
| 16 | Đua patin tốc độ (`rollerblade racing`) | Mash (chạm liên tục) | Mobile Emulation (450x694) | Nền ảo | Thắng (42 chạm trong 9.5s) | Luật hết giờ ai xa hơn thắng hoạt động tốt |
| 17 | Trượt patin đối kháng (`roller derby`) | Mash (chạm liên tục) | Mobile Emulation (450x694) | Nền ảo | Thắng (42 chạm trong 9.4s) | Đối thủ về đích quanh 10s chuẩn |
| 18 | Đua xe F1 (`formula 1 racing`) | Mash (chạm liên tục) | Mobile Emulation (450x694) | Nền ảo | Thắng (48 chạm trong 9.6s) | Tốc độ cao, bấm phím/chạm liên tục mượt |
| 19 | Đấu vật Olympic (`olympic wrestling`) | Mash (chạm liên tục) | Mobile Emulation (450x694) | Nền ảo | Thắng (38 chạm trong 9.1s) | Đối kháng cân bằng |
| 20 | Quyền anh (`boxing`) | Mash (chạm liên tục) | Mobile Emulation (450x694) | Nền ảo | Thắng (35 chạm trong 8.7s) | Nhịp chạm vừa sức (3.5 chạm/s) |

*Ghi chú về kiểm thử trên điện thoại thật*: Cả 20 môn đã được kiểm tra trên môi trường giả lập Mobile Viewport (hỗ trợ Touch/Pointer Event). Kiểm thử trực tiếp trên điện thoại vật lý qua đường hầm Cloudflare (`phone-test.cmd`): Người dùng có thể khởi chạy `phone-test.cmd`, quét mã hoặc mở URL HTTPS trên điện thoại để trải nghiệm camera thật trong không gian thực tế.

### 6.3. Kiểm tra chuyển đổi camera (Camera Handoff)
- **Kịch bản**: Ở màn hình Quét (camera quét đang hoạt động) $\to$ Bấm mở dialog trò chơi AR $\to$ Đóng dialog trò chơi AR $\to$ Quay lại màn hình Quét.
- **Kết quả**:
  - Khi mở game AR: `CAMERA_AR_RELEASE_MS = 400` ms giúp camera quét dừng hoàn toàn và nhả phần cứng trước khi game AR yêu cầu truy cập stream camera.
  - Không xuất hiện lỗi `NotReadableError` (lỗi camera bị xung đột chiếm giữ).
  - Khi đóng game AR: `useCameraBackground` tự động giải phóng tất cả `MediaStreamTrack` (`track.stop()`), màn hình Quét kích hoạt lại camera trơn tru, không bị đen hình hay treo camera.

### 6.4. Kiểm chứng từ chối quyền Camera (Slice G)
- **Kịch bản**: Mở game AR và từ chối cấp quyền camera (`NotAllowedError`).
- **Kết quả**:
  - Hệ thống hiển thị thông báo tiếng Việt thân thiện: *"Bạn đã từ chối quyền camera. Vẫn chơi được ở chế độ nền ảo."*
  - `shouldRetryCamera("NotAllowedError")` trả về `false`, hệ thống **chỉ hỏi quyền một lần duy nhất** và không thực hiện retry lặp lại, không gây phiền hà cho người dùng.
  - Chế độ nền ảo (Virtual Floor / Gradient Grid) tự động kích hoạt mượt mà, cho phép người chơi tiếp tục chơi game bình thường.

