# SportSnap

Ứng dụng nhận diện môn thể thao qua ảnh, sử dụng FastAPI và React + TypeScript.
Slice 5 bổ sung xem 3D và Web AR từ kết quả Quét và lightbox phân loại hàng loạt.
Slice 7 bổ sung Docker và CI để bàn giao; Slice 6 chưa được triển khai.

## Run it

Yêu cầu: Python 3.12 và Node.js 24 (kèm npm). Các lệnh dưới đây dùng PowerShell,
bắt đầu từ thư mục gốc của dự án.

### Backend

```powershell
Copy-Item .env.example .env
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Nếu PowerShell không cho phép kích hoạt môi trường, dùng trực tiếp
`.\.venv\Scripts\python.exe -m pip install -r requirements.txt` và
`.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000`.

Hai tệp do nhóm cung cấp tại `backend/models/best_model.keras` và
`backend/models/labels.json` được theo dõi bằng Git, có sẵn khi clone repo.
Mỗi tệp phải nhỏ hơn 50 MB (50.000.000 byte); không sửa đổi, chuyển đổi hoặc huấn luyện lại.
Backend vẫn khởi động khi chưa có một trong hai tệp.

Kiểm tra tại [trạng thái API](http://localhost:8000/api/health).
Khi có mô hình hợp lệ, API trả `model_loaded: true` và số lớp đọc từ tệp nhãn.
Khi thiếu tệp, API trả HTTP 200:

```json
{"status":"ok","model_loaded":false,"num_classes":0,"preprocess":"mobilenet_v2","reason":"model_missing"}
```

Nếu tệp không đọc được, mô hình lỗi hoặc nhãn không hợp lệ, backend vẫn chạy và
trả `model_loaded: false, reason: "model_load_failed"`. Chi tiết lỗi chỉ có trong log backend.
`status: "ok"` cho biết API đang hoạt động; `model_loaded` cho biết mô hình đã sẵn sàng hay chưa.

`GET /api/classes` trả danh sách nhãn theo đúng thứ tự huấn luyện (danh sách rỗng
khi mô hình chưa sẵn sàng). Gửi một ảnh bằng trường multipart `file`:

```powershell
curl.exe -X POST http://localhost:8000/api/predict -F "file=@path/to/photo.jpg"
```

API nhận JPEG, PNG và WebP, mặc định tối đa 12 MB mỗi ảnh. Kết quả gồm `label`,
`confidence`, `top3`, `is_uncertain`, `threshold` và `latency_ms`.
`confidence < CONFIDENCE_THRESHOLD` (mặc định 0.60) trả `is_uncertain: true`.
`POST /api/scan` nhận từ 2 đến 6 khung hình trong các trường multipart `files`
lặp lại. Kết quả lấy trung bình toàn bộ vector xác suất, kèm `per_frame` và
`agreement` (tỷ lệ khung hình có nhãn đứng đầu trùng nhãn kết quả):

```powershell
curl.exe -X POST http://localhost:8000/api/scan -F "files=@path/to/frame-1.jpg" -F "files=@path/to/frame-2.jpg"
```

Thiếu hoặc thừa khung hình trả 400 `bad_request`. Một khung hình hỏng hoặc
không hợp lệ làm toàn bộ lượt quét thất bại; không bỏ qua khung hình lỗi.
Lỗi trả `{"error":{"code":"...","message":"..."}}` với thông báo tiếng Việt:
415 `unsupported_format`, 422 `invalid_image`, 413 `file_too_large`,
503 `model_not_loaded`; thiếu trường ảnh hoặc multipart không hợp lệ trả
400 `bad_request`. Lỗi suy luận trả 500 `internal_error`, không lộ chi tiết nội bộ.

Chỉ khi debug ở môi trường phát triển: đặt `DEBUG_SAVE_FRAMES=1` trong `.env`
và khởi động lại backend để lưu nguyên byte các frame `/api/scan` nhận được vào
`backend/debug_frames/` (đã được Git bỏ qua). Có thể đổi đường dẫn bằng
`DEBUG_FRAMES_DIR`, tính từ `BASE_DIR`. Mặc định tắt (`DEBUG_SAVE_FRAMES=0`);
ảnh debug được giữ lại để đối chiếu, xóa thủ công sau khi kiểm tra.

`.env` được đọc từ thư mục gốc dù chạy lệnh trong `backend/`. `BASE_DIR` mặc định
là thư mục gốc; các đường dẫn tương đối trong `.env` được tính từ `BASE_DIR`.
Giữ `PREPROCESS=mobilenet_v2` theo notebook huấn luyện. Các giới hạn mặc định nằm trong `.env.example`.
TensorFlow được cố định ở phiên bản `2.20.0` (`tensorflow-cpu` trên Linux/Docker,
`tensorflow` trên hệ điều hành khác); nếu cài đặt thất bại, dừng và báo lỗi.
Gói CPU được mô tả trong [hướng dẫn TensorFlow](https://www.tensorflow.org/install/pip).

### Frontend khi phát triển

Mở terminal thứ hai tại thư mục gốc, giữ backend đang chạy:

```powershell
cd frontend
npm ci
npm run dev
```

Mở [SportSnap](http://localhost:5173). Vite chuyển tiếp `/api` tới
`http://localhost:8000`. Trang Quét mở camera sau khi được cấp quyền, ưu tiên camera
sau với độ phân giải ưu tiên 1280×720, không thu âm. Bấm **Quét đa khung hình**
để đợi video có dữ liệu và warmup khoảng 500 ms, rồi chụp 4 khung hình cách nhau
khoảng 300 ms và gửi tới `/api/scan`. Mỗi frame được cắt vuông ở giữa theo kích
thước video gốc, scale một lần thành 448×448 và nén JPEG chất lượng 0.95.
Để giữ toàn bộ payload dưới 1,5 MB (có chừa dung lượng cho multipart), ứng dụng lần
lượt giảm chất lượng xuống 0.90, 0.85, rồi giảm còn 3 hoặc tối thiểu 2 khung hình;
luôn giữ 448×448, nếu vẫn quá lớn sẽ báo lỗi trước khi gửi.
Kết quả hiển thị nhãn gốc từ API, độ tin cậy, ba dự đoán hàng đầu, độ đồng thuận
và cảnh báo màu hổ phách khi không chắc chắn.

Chọn **Thư viện** hoặc **Chọn ảnh từ thư viện** để gửi một ảnh tới `/api/predict`.
Có thể quay lại camera, chọn ảnh khác hoặc thử lại khi có lỗi. Camera dừng khi
hiện kết quả, chuyển sang thư viện, rời trang hoặc đưa ứng dụng xuống nền;
bấm mở lại camera để tiếp tục. Lỗi quyền truy cập, thiếu camera, kết nối không
an toàn, ảnh không hợp lệ, mô hình chưa sẵn sàng và lỗi mạng đều có thông báo tiếng Việt.
Giao diện sáng/tối theo hệ thống. Trang Phân tích hiện là trang chờ.

Trên Android Chrome và iOS Safari, mở ứng dụng qua HTTPS để dùng camera;
HTTP chỉ hỗ trợ camera khi chạy ở localhost. Địa chỉ HTTP LAN sẽ hiển thị hướng
dẫn dùng HTTPS hoặc chọn ảnh từ thư viện. Kiểm tra trên điện thoại: cấp/từ chối
quyền camera, quét bằng camera sau, xem tiến độ 4 khung hình, độ đồng thuận,
quay lại camera và chuyển sang chọn ảnh. Nút xem vùng AI chú ý vẫn là nút chờ của
Slice 6. AR dùng các GLB đã commit tại `frontend/public/models/`, không tải asset ngoài.

### Xem 3D và AR trên điện thoại (Slice 5)

Nút **Xem AR** hoạt động khi nhãn nằm trong manifest và kết quả chắc chắn
(`is_uncertain=false`), áp dụng cho ảnh đơn, kết quả camera và lightbox Bulk.
Kết quả chưa chắc chắn hoặc thiếu model sẽ vô hiệu hóa nút và giải thích bằng tiếng Việt.
Thư viện `@google/model-viewer` chỉ tải khi mở dialog, không tải cùng trang Quét/Bulk.
Dialog có tiến độ tải thật, lỗi có nút **Thử lại**, xoay/zoom 3D và nút **Xem trong AR**.
Đóng bằng ESC hoặc nút X để trả focus về nút mở. Thiết bị không hỗ trợ AR vẫn xem 3D được.

Chạy backend và Vite theo phần Run it phía trên. Máy tính cần `cloudflared` đã cài;
mở terminal thứ ba và giữ lệnh này chạy:

```powershell
cloudflared tunnel --url http://localhost:5173
```

Lệnh in ra một URL HTTPS dạng `https://<hostname>.trycloudflare.com`.
Trong terminal Vite, dừng `npm run dev` bằng Ctrl+C rồi cho phép **đúng hostname đó**
và chạy lại (thay giá trị ví dụ dưới đây bằng hostname thực, không kèm `https://`):

```powershell
$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = 'my-sportsnap-test.trycloudflare.com'
npm run dev
```

Biến này tránh lỗi Vite "Blocked request" khi truy cập tunnel. Mở URL HTTPS trên
điện thoại; `/api` đi qua cùng tunnel tới proxy Vite rồi tới `http://localhost:8000`.
Không cần mở một tunnel riêng cho backend. GLB tại `/models/<file>.glb` cũng phải
truy cập được qua URL HTTPS này để trình xem AR gốc tải được.
Tham khảo [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
và [Vite allowed hosts](https://vite.dev/config/server-options#server-allowedhosts).

Các bước kiểm thử thủ công:

1. Dùng Chrome trên Samsung S24 Ultra/Android hoặc Safari trên iPhone/iPad,
   mở URL HTTPS; cho phép camera khi quét hoặc khi trình xem AR yêu cầu.
2. Chọn một ảnh thể thao rõ từ thư viện, đợi kết quả chắc chắn rồi bấm **Xem AR**.
   Lặp lại với **Quét đa khung hình**; thử thêm **Xem AR** trong lightbox Bulk.
3. Đợi tải xong, kéo để xoay mô hình rồi bấm **Xem trong AR**. Android ưu tiên
   WebXR, sau đó Scene Viewer; iOS dùng Quick Look. Không khai báo `ios-src` nên
   model-viewer tự tạo USDZ từ GLB khi mở Quick Look, có thể cần chờ thêm lần đầu.
4. Hướng camera chậm về mặt bàn/sàn có đủ sáng, đặt vật, xoay và véo phóng/thu.
   Chín diorama mới có cạnh khoảng 0,35 m; 11 model cũ có kích thước khác nhau,
   có thể cần thu nhỏ. `ar-scale="auto"` cho phép đổi kích thước.
5. Trở lại trang, đóng dialog bằng X/ESC (nếu có bàn phím), kiểm tra focus về
   **Xem AR**. Trong Bulk, đóng AR phải giữ lightbox ảnh bên dưới còn mở.
6. Kiểm tra nút bị khóa và chú thích với kết quả chưa chắc chắn. Trên desktop
   không hỗ trợ AR, kiểm tra thông báo và khả năng xem 3D. Để thử lỗi tải, dùng
   DevTools chặn request GLB trước khi mở, bỏ chặn rồi bấm **Thử lại**.

Chưa thể xác nhận đặt vật thực tế bằng test node hay trình duyệt desktop; cần
thực hiện các bước trên trên điện thoại. Dừng tunnel bằng Ctrl+C sau khi thử.
Chi tiết iOS/Android theo [tài liệu AR chính thức của model-viewer](https://modelviewer.dev/examples/augmentedreality/).

### Phân loại hàng loạt (Slice 4)

Mở tab **Phân loại hàng loạt**, kéo thả/chọn nhiều ảnh hoặc một ZIP rồi bấm **Bắt đầu**.
Trang hiển thị tiến độ tải lên, cập nhật job mỗi giây và thống kê nhãn, số ảnh không chắc chắn,
số tệp lỗi. Lưới hiển thị 24 thẻ/trang, 4–5 cột trên desktop, 2 cột trên điện thoại.
Thumbnail từ backend hoạt động cho cả ảnh chọn trực tiếp và ZIP. Bấm thẻ để xem ảnh lớn,
tên tệp, độ tin cậy và top-3; dùng mũi tên trái/phải để chuyển ảnh trong trang hiện tại,
Escape/nút đóng/bấm nền để đóng. Không tạo object URL cho thumbnail phía client.
Bấm chip đếm theo môn để lọc, bấm lại để bỏ lọc; chọn sắp xếp theo độ tin cậy hoặc tên tệp,
kết hợp **Chỉ không chắc chắn**. Bộ lọc chạy trên toàn bộ job trước khi phân trang.
Thanh lọc, **Tải ZIP**, **Xóa tệp tạm**/**Hủy** dính khi cuộn. Thay bộ lọc sẽ về trang đầu.
Chuyển tab dừng polling, quay lại tiếp tục theo dõi cùng job. Lỗi mạng có nút **Thử lại**.
**Hủy** dừng job và xóa ảnh tạm; batch model đang chạy sẽ được bỏ kết quả khi kết thúc.
Sau khi xong có thể bấm **Xóa tệp tạm** để dọn ngay: trang giữ trạng thái **Đã hoàn tất**
và báo **Đã xóa tệp tạm**, đồng thời bỏ nút tải ZIP. Backend cũng giữ trạng thái `done`/`error`
khi dọn job đã xong và trả `files_removed:true`; chỉ job đang chờ/chạy mới chuyển `cancelled`.

`POST /api/bulk` nhận multipart `files` (hoặc `files[]`), trả HTTP 202 `{job_id}`.
Gửi nhiều ảnh hoặc đúng một `.zip`; đường dẫn trong ZIP được lấy basename, không giải nén
theo đường dẫn gốc. Tệp không hỗ trợ/hỏng/quá lớn được giữ trong `loi/`, không làm hỏng job.
`GET /api/bulk/{job_id}` trả `queued|running|done|error|cancelled`, `processed`, `total`,
`counts`, `uncertain`, `errors`, `files_removed`. Trang kết quả đọc endpoint phân trang riêng:

```text
GET /api/bulk/{job_id}/results?label=polo&uncertain=false&sort=confidence_desc&offset=0&limit=24
GET /api/bulk/{job_id}/thumb/{index}
GET /api/bulk/{job_id}/image/{index}
```

`results` trả `items`, `total` sau lọc, `offset`, `limit`, và `summary` toàn job.
Mỗi item có `index` ổn định theo thứ tự tệp đầu vào, không phụ thuộc lọc/sắp xếp/tên trùng.
`label` trống lấy tất cả; `uncertain=true` chỉ lấy ảnh không chắc chắn;
`sort=confidence_desc|confidence_asc|filename`. Mặc định 24 kết quả/trang, tối đa 100;
`offset` không âm. Tham số không hợp lệ trả 400 tiếng Việt. Dòng lỗi không có confidence
nằm cuối cả hai kiểu sắp xếp độ tin cậy.
Thumbnail là JPEG cạnh dài tối đa 256 px; ảnh xem lớn lấy từ ảnh gốc, xuất JPEG tối đa
2.048 px, giữ tỉ lệ và hướng EXIF. Các bản xem được tạo lười/cache trong thư mục job,
không sửa ảnh gốc tải về ZIP hoặc tiền xử lý model. Header ảnh là `Cache-Control: private, no-store`.
Index không tồn tại/ảnh lỗi trả 404 `image_not_found`; job hết hạn trả 410 `job_expired`.
Trạng thái lỗi là `error` theo SPEC §5. `GET /api/bulk/{job_id}/download` chỉ cho tải khi
`done`; trước đó trả 409 `job_not_ready`. `DELETE /api/bulk/{job_id}` hủy và dọn tệp.

ZIP kết quả có thư mục theo nhãn đã slugify, `chua_chac_chan/` cho ảnh có confidence < 0.60,
`loi/` cho tệp lỗi, cùng `report.csv` UTF-8 BOM với các cột theo SPEC §7:
`filename,predicted,confidence,top2,top2_confidence,folder,error`.
Lỗi từng tệp là `unsupported_format`, `corrupt` hoặc `too_large`.
Tên tệp được làm sạch và chống trùng bằng `_2`, `_3`; ô CSV bắt đầu bằng `= + - @`
(kể cả sau khoảng trắng) được thêm dấu `'` để tránh công thức ngoài ý muốn.

Cấu hình trong `.env.example` (khởi động lại backend sau khi đổi):

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `MAX_BULK_FILES` | 2000 | Tối đa số tệp/job, kể cả tệp lỗi trong ZIP |
| `MAX_UPLOAD_MB` | 12 | Dung lượng mỗi ảnh; quá giới hạn đi vào `loi/` |
| `BULK_BATCH_SIZE` | 32 | Số ảnh/batch, tối đa 32 |
| `BULK_MAX_ACTIVE_JOBS` | 2 | Tổng số job đang chờ/chạy, kể cả đang upload |
| `BULK_TTL_SECONDS` | 1800 | Giữ job 30 phút sau done/error/cancelled |
| `BULK_CLEANUP_INTERVAL_SECONDS` | 60 | Chu kỳ dọn job hết hạn |
| `BULK_TEMP_DIR` | `backend/tmp/bulk` | Thư mục tạm, tính từ `BASE_DIR`, được Git bỏ qua |
| `BULK_RESULTS_PAGE_SIZE` | 24 | Limit mặc định của API results |
| `BULK_RESULTS_MAX_LIMIT` | 100 | Limit tối đa của API results |
| `BULK_THUMB_MAX_SIDE` | 256 | Cạnh dài thumbnail JPEG, không vượt 256 px |
| `BULK_IMAGE_MAX_SIDE` | 2048 | Cạnh dài ảnh xem lớn JPEG |
| `BULK_PREVIEW_JPEG_QUALITY` | 85 | Chất lượng JPEG cho bản xem |

Một worker xử lý lần lượt các job; khóa model dùng chung với `/predict` và `/scan`.
Không giữ cả bộ ảnh trong RAM; ảnh upload và ZIP kết quả nằm trên đĩa.
Vượt số tệp trả 413 `too_many_files` và hủy toàn bộ lượt gửi. Job đang chạy/chờ không hết hạn;
job hết TTL trả 410 `job_expired`, mã không tồn tại trả 404 `job_not_found`.
Job lưu trong bộ nhớ của một process, mất khi backend khởi động lại; shutdown bình thường
dọn ảnh tạm. Dùng một process Uvicorn, không thêm `--workers`.

Tự thử một thư mục ảnh bằng PowerShell từ thư mục gốc (backend đang chạy ở cổng 8000):

```powershell
$imageFolder = 'D:\photos'  # Change to your photo folder.
$inputZip = Join-Path $env:TEMP ("sportsnap-" + [guid]::NewGuid() + ".zip")
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $imageFolder -File).FullName -DestinationPath $inputZip
try {
    $job = curl.exe --fail-with-body -sS http://localhost:8000/api/bulk -F "files=@$inputZip" | ConvertFrom-Json
    if (-not $job.job_id) { throw 'Không tạo được lượt phân loại.' }
    do {
        Start-Sleep -Seconds 1
        $state = Invoke-RestMethod "http://localhost:8000/api/bulk/$($job.job_id)"
        Write-Host "$($state.status): $($state.processed)/$($state.total)"
    } while ($state.status -in @('queued', 'running'))
    if ($state.status -ne 'done') { throw 'Phân loại chưa hoàn tất. Kiểm tra trạng thái job.' }
    curl.exe --fail-with-body -o "sportsnap_result_$($job.job_id).zip" "http://localhost:8000/api/bulk/$($job.job_id)/download"
} finally {
    Remove-Item -LiteralPath $inputZip -ErrorAction SilentlyContinue
}
```

### Chạy bản build trên một cổng

```powershell
cd frontend
npm run build
cd ../backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Build frontend trước khi khởi động backend (hoặc khởi động lại backend sau khi build).
FastAPI phục vụ `frontend/dist` tại [trang chủ](http://localhost:8000/),
đồng thời giữ API tại `/api`. Khi chưa build frontend, API vẫn chạy bình thường.

### Kiểm tra

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
cd ../frontend
npx tsc --noEmit
npm run build
npm test
```

Bộ kiểm tra xác nhận trạng thái, suy luận, tiền xử lý, EXIF, ngưỡng không chắc chắn,
định dạng ảnh, ảnh hỏng, giới hạn dung lượng, CORS và phục vụ frontend.
Các kiểm tra đa khung hình xác nhận trung bình xác suất (khác bỏ phiếu đa số),
độ đồng thuận, ngưỡng không chắc chắn, giới hạn 2–6 khung hình và các lỗi API.
`npm test` kiểm tra chụp/cancel, khoảng cách khung hình, từng bước giảm dung lượng,
thông báo lỗi camera, gọi API và bộ kiểm tra nền canvas hiện có.
Các test AR kiểm tra bật/tắt nút theo đủ 20 nhãn manifest và `is_uncertain`, đường
dẫn GLB thật, nhãn không có model, nạp thư viện lazy/dùng chung/thử lại và tiến độ tải.
Các kiểm tra bulk xác nhận batch 32/32/6, 300 tệp hỗn hợp, ZIP/CSV, tệp lỗi,
giới hạn số tệp, hủy job, TTL, tên tệp an toàn, CSV injection và dọn tệp.
Frontend kiểm tra polling 1 giây, dừng/hủy polling, bộ lọc, tiến độ upload và lỗi API bulk,
query lọc/phân trang, chuyển ảnh lightbox theo index và phân biệt xóa tệp tạm với hủy phân loại.
Backend còn kiểm tra lọc polo ngoài nhóm kết quả đầu, sort/phân trang trên toàn job,
thumbnail ZIP, tỉ lệ/kích thước JPEG, chống traversal và dọn cache cùng job.
Polling gọi timer qua hàm bọc để tránh lỗi trình duyệt `Illegal invocation` do sai receiver.
Golden test là điều kiện bắt buộc: cần hai tệp mô hình gốc và bộ ảnh trong
`backend/tests/golden/`; thiếu dữ liệu sẽ báo lỗi thay vì bỏ qua.
Bộ golden ban đầu gồm tám ảnh mẫu tổng hợp với kết quả thực từ mô hình,
được cho phép dùng làm mốc hồi quy khi chưa có ảnh xuất từ notebook.
Bộ này chưa xác nhận độ chính xác trên ảnh thể thao hoặc tính tương đương với
notebook. Xem `backend/tests/golden/README.md` để tạo bộ ứng viên từ dữ liệu kiểm thử.
Nếu mô hình bị thiếu khỏi checkout, vẫn chạy backend như trên; có thể kiểm tra riêng
phần không cần mô hình bằng `python -m pytest -q --ignore=tests/golden`.

## Chạy bằng Docker

Yêu cầu Docker Engine/Docker Desktop đang chạy với Linux containers và Docker Compose.
Chạy từ thư mục gốc (chỉ sao chép `.env` nếu chưa có để giữ cấu hình hiện tại):

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --build
```

Mở [SportSnap](http://localhost:8000) và [trạng thái API](http://localhost:8000/api/health).
Dockerfile build frontend bằng Node.js 24 rồi copy `dist` cùng backend/model vào
image Python 3.12 slim. FastAPI phục vụ cả giao diện và API trên cổng 8000,
chạy bằng user `sportsnap` (UID/GID 10001), một process Uvicorn.
HEALTHCHECK gọi `/api/health` và chỉ healthy khi API chạy và model đã nạp.

Compose đọc `.env`; các đường dẫn model, labels, frontend và Bulk được cố định
theo cây `/app` trong container, không dùng đường dẫn tuyệt đối của máy host.
Bulk dùng tmpfs riêng, mặc định tối đa `BULK_TMPFS_SIZE=2g`; dung lượng sử dụng
tiêu thụ bộ nhớ host. Tăng giới hạn trong `.env` nếu host đủ bộ nhớ và job lớn
cần nhiều chỗ cho ảnh gốc, cache và ZIP. Khởi động lại container làm mất toàn bộ
job trong bộ nhớ và tệp Bulk; tải kết quả trước khi dừng. Không bật lưu frame debug
trong bản deploy. Compose tự khởi động lại với `restart: unless-stopped`.
Camera và AR trên điện thoại vẫn cần HTTPS ở host deploy.

```powershell
docker compose ps
docker compose logs --tail 100 sportsnap
curl.exe --fail-with-body http://localhost:8000/api/health
curl.exe --fail-with-body http://localhost:8000/api/predict -F "file=@backend/tests/golden/red_gradient.png"
docker compose down
```

Ảnh golden nằm ở checkout để kiểm thử, không được copy vào image runtime.
Golden `red_gradient.png` phải khớp nhãn/confidence trong `expected.json` (sai số tối đa 0,01).
Muốn chạy không qua Compose:

```powershell
docker build -t sportsnap:local .
docker run --rm -p 8000:8000 --env-file .env --tmpfs /app/backend/tmp/bulk:uid=10001,gid=10001,mode=0700,size=2g sportsnap:local
```

Khi dùng `docker run`, giữ đường dẫn tương đối theo `.env.example`; nếu cần đặt
`BASE_DIR` thì dùng `/app`, không dùng đường dẫn máy host.

## Đóng góp

1. Tạo nhánh từ nhánh chính, ví dụ `git switch -c codex/slice-7-delivery`.
2. Đọc `AGENTS.md` và `SPEC.md`, chỉ làm một slice; giữ nguyên model, labels và tiền xử lý.
3. Chạy `pytest -q` trong backend, rồi `npm ci`, `npm test`, `npx tsc --noEmit`
   và `npm run build` trong frontend. Commit theo mẫu `slice N: <summary>`.
4. Đẩy nhánh lên repo GitHub của nhóm và mở Pull Request. CI phải xanh trước khi merge;
   workflow chạy trên cả `push` và `pull_request`, cache pip/npm, gồm golden gate.

`.env`, môi trường ảo, dependencies, build, cache và ảnh tạm được bỏ qua bằng Git/Docker.
Chỉ hai artifact classifier đã nêu được đưa vào Git; không đưa dataset hoặc export khác lên repo.

## Deploy tóm tắt

1. Tạo repo GitHub, thêm remote và push mã nguồn; bật GitHub Actions nếu repo yêu cầu.
   Các thao tác này do chủ repo thực hiện, không nằm trong phần chuẩn bị cục bộ.
2. Trên host hỗ trợ Docker/Linux, checkout commit đã qua CI và build từ `Dockerfile`
   với build context ở thư mục gốc. Image đã chứa frontend, model và labels.
3. Cấu hình biến môi trường theo `.env.example`, giữ đường dẫn trong container và cổng 8000;
   với Compose dùng `docker compose up --build -d`. Dùng một instance/process vì job
   Bulk lưu trong bộ nhớ; cấp đủ RAM cho TensorFlow và tmpfs.
4. Cho host/reverse proxy chuyển HTTPS tới cổng 8000, kiểm tra `/`, `/api/health`
   (`model_loaded: true`) và gửi thử một ảnh tới `/api/predict` trước khi demo.

Xem [SPEC.md](SPEC.md) và [AGENTS.md](AGENTS.md) để biết phạm vi từng slice.
