# SportSnap — Specification

## 1. Goal
A mobile-first web app (works on Android Chrome and iOS Safari) that:
1. **Scan**: opens the phone camera, captures several frames, returns the sport + confidence.
2. **AR**: shows a 3D model of the recognised sport that the user can place in the real world.
3. **Bulk**: accepts up to 2000 photos (or a ZIP) by default, classifies them, and returns a ZIP with one folder per sport. ~1000 photos is a typical demo size.
4. **Insights**: shows experiment results (model comparison, confusion matrix, Grad-CAM) for the thesis.

The classifier is a Keras model trained separately (20 sport classes, 224x224 input). It is a **fixed input** to this project.

## 2. Non-goals (do NOT build)
Accounts/auth, database, payments, training code, video upload (later), native apps, real-time streaming.

## 3. Architecture
```
Phone browser (React)  --HTTPS-->  FastAPI  -->  Keras model (loaded once at startup when available)
      |                                |
      +-- <model-viewer> AR (client)   +-- bulk jobs in background thread, in-memory job store
```
FastAPI serves the built frontend (`frontend/dist`) at `/` and the API under `/api`. One process, one port. The app starts even when the git-ignored model files are missing; see §12.

```
sportsnap/
├── AGENTS.md  SPEC.md  README.md  .gitignore  .env.example
├── backend/
│   ├── app/
│   │   ├── main.py            # app factory, lifespan loads model, mounts static
│   │   ├── schemas.py         # Pydantic models
│   │   ├── api/               # scan.py, bulk.py, insights.py
│   │   ├── services/          # inference.py, gradcam.py, bulk_job.py
│   │   └── core/config.py
│   ├── models/                # best_model.keras, labels.json  (git-ignored)
│   ├── data/experiments.json  # results for Insights page (provided by the team)
│   ├── tests/                 # golden tests + API tests
│   └── requirements.txt       # pin tensorflow==2.20.0
└── frontend/                  # Vite + React + TS + Tailwind + shadcn/ui
    ├── public/models3d/       # <sport>.glb and <sport>.usdz
    └── src/ (pages/ components/ lib/api.ts lib/sports3d.ts)
```

## 4. Model contract (critical)
- Model file: `backend/models/best_model.keras` (Keras 3, trained with TensorFlow 2.20.0 — pin the same version).
- Classes: `backend/models/labels.json`, a JSON list in the exact training order. Never hard-code class names.
- **Preprocessing:**
  1. Open image, apply `ImageOps.exif_transpose` (phone photos carry EXIF rotation), convert to RGB.
  2. Resize to 224x224 with `Image.resize((224,224), Image.BILINEAR)`, stretching without cropping; Pillow antialiases downscaling. Do not use `tf.image.resize` without antialias. The notebook used `image_size=(224,224)`, bilinear, no crop.
  3. Convert to a float32 array in 0–255, then apply `tf.keras.applications.mobilenet_v2.preprocess_input` (scales to [-1,1]); `PREPROCESS=mobilenet_v2`.
  4. Add batch dim, `model.predict`. Output is softmax over classes.
- **Golden test:** `backend/tests/golden/` contains ~10 images at 224x224 and `expected.json` entries `{file,label,confidence}` from the notebook. Resize is a no-op for these images. Require 100% label match and absolute confidence difference <= 0.01. This test is a hard gate.
- Uncertainty: if top-1 probability < `CONFIDENCE_THRESHOLD` (default 0.60, tunable), the result is `is_uncertain=true`.
  The model only knows 20 sports and will always name one — uncertainty handling is mandatory, not optional.

## 5. API (all under `/api`, JSON, errors as `{ "error": { "code": str, "message": str } }`)
| Method & path | Request | Response |
|---|---|---|
| `GET /health` | – | `{status, model_loaded, num_classes, preprocess}`; when model files are missing, HTTP 200 with `model_loaded:false, reason:"model_missing"` |
| `GET /classes` | – | `{classes: string[]}` |
| `POST /predict` | multipart `file` | `Prediction` |
| `POST /scan` | multipart `files[]` (2–6 frames) | `ScanResult` |
| `POST /gradcam` | multipart `file` | `{label, confidence, overlay_png_base64}` |
| `POST /bulk` | multipart `files[]` or one `.zip` | `{job_id}` |
| `GET /bulk/{job_id}` | – | `{status: queued\|running\|done\|error\|cancelled, processed, total, uncertain, counts, errors, files_removed, error?}`; use `/results` to browse results |
| `GET /bulk/{job_id}/results` | `label`, `uncertain`, `sort`, `offset`, `limit` query parameters | `{items: [{index,filename,label,confidence,is_uncertain,top3,folder,error}], total, offset, limit, summary: {total,processed,counts,uncertain,errors}}` |
| `GET /bulk/{job_id}/thumb/{index}` | integer input index | private JPEG thumbnail, longest side <=256 px, generated lazily and cached in the job directory |
| `GET /bulk/{job_id}/image/{index}` | integer input index | private JPEG display image from the original upload, longest side <=2048 px by default |
| `GET /bulk/{job_id}/download` | – | ZIP (see §7) |
| `DELETE /bulk/{job_id}` | – | cancel queued/running jobs and delete temporary files; preserve done/error outcomes when cleaning up completed jobs, return `files_removed:true` |
| `GET /insights` | – | contents of `data/experiments.json` |
| `GET /insights/files/{name}` | – | image from `backend/data/insights/`; reject path traversal |

```
Prediction = { label: str, confidence: float, top3: [{label, confidence}], is_uncertain: bool,
               threshold: float, latency_ms: int }
ScanResult = Prediction + { per_frame: [{label, confidence}], agreement: float }
```
`/scan` averages the **probability vectors** of all frames (not majority vote of top-1), then applies the threshold.
`agreement` = fraction of frames whose top-1 equals the final label.

Limits (configurable): max 12 MB per file and max 2000 files per bulk job. Supported images are jpg/jpeg/png/webp. Single-file endpoints reject bad files; bulk places bad files in `loi/` and continues, including non-images in a ZIP. Exceeding the bulk file limit rejects the whole job. Error statuses and codes are specified in §12.

## 6. Frontend pages (Vietnamese UI)
Navigation: bottom tab bar on mobile, left sidebar on desktop.
1. **Quét** (default): live camera (rear camera `facingMode: "environment"`, `<video playsinline muted autoplay>`),
   a capture button that grabs 4 frames ~300 ms apart, downscales each to max 640 px (JPEG q=0.85), POSTs to `/api/scan`.
   If the scan payload exceeds 1.5 MB, follow the reduction sequence in §12. A single "Chọn ảnh từ thư viện" image uses `/api/predict`; `/api/scan` is only for 2–6 camera frames. Result card: sport name, confidence meter, top-3, agreement, a clear
   **"Không chắc chắn"** state, a **"Xem AR"** button (only if a 3D model exists for that sport), a "Xem vùng AI chú ý" button (Grad-CAM).
2. **Phân loại hàng loạt**: drag-and-drop zone / file picker, upload progress, job progress bar (poll every 1 s).
   Show whole-job totals, processed, uncertain and errors. Browse ALL processed results through `/results`, 24 cards/page,
   with numbered pagination, a 4–5-column desktop grid and a 2-column mobile grid. Each card has a lazy/async loaded square
   object-cover thumbnail, filename, predicted label, confidence bar/percentage and uncertainty badge.
   A sticky toolbar contains clickable per-sport count chips (toggle to filter, highlight the active chip), sort selection,
   an uncertain-only checkbox, Download ZIP and cleanup/cancel buttons. Filter/sort changes reset pagination.
   Use backend thumbnails for both direct uploads and ZIPs; image identity is the stable input index, never a filename.
   The lightbox shows the bounded original display image, filename, confidence and top-3 predictions; Escape/backdrop/close
   button closes it, left/right arrows navigate only within the current page. Abort stale requests on filter/page/job changes
   and unmount. No client-side thumbnail object URLs or fixed-size result preview.
3. **Phân tích**: reads `/api/insights`: model comparison table, confusion-matrix image, Grad-CAM gallery, and optional ablation data. See §12 for the schema and image endpoint.

### AR (client side only)
Use the `<model-viewer>` web component:
`<model-viewer src="/models3d/football.glb" ios-src="/models3d/football.usdz" ar ar-modes="webxr scene-viewer quick-look" ar-placement="floor" camera-controls>`.
Mapping `sport label -> {glb, usdz}` lives in `lib/sports3d.ts` and uses exact labels from `labels.json`. No asset for a sport -> hide the AR button, show a 2D icon.
First three sports: **football, basketball, golf**. The team places assets in `frontend/public/models3d/`; do not download them. Warn in the dev console if a mapping key is absent from `/api/classes`. Asset sources and licences are recorded in `docs/ASSETS.md`.
(Android uses GLB via Scene Viewer/WebXR; iOS uses USDZ via Quick Look.)

## 7. Bulk ZIP layout
```
sportsnap_result.zip
├── football/ img1.jpg ...
├── golf/ ...
├── chua_chac_chan/        # is_uncertain images
├── loi/                   # unsupported, corrupt, or oversized files
└── report.csv             # filename, predicted, confidence, top2, top2_confidence, folder, error
```
Copy, never move. Slugify labels for folder names; sanitise filenames and make duplicates unique with `_2`, `_3` suffixes (zip-slip safe). Flatten input ZIP paths by basename. Error rows use `folder=loi`, empty predicted/confidence and a reason in `error` (see §12). Process in batches of 32.
Job store is in-memory (dict + lock); delete job files 30 minutes after a job reaches done/error. Running jobs never expire; expired jobs return HTTP 410 `job_expired`.

## 8. Slices (do in order, one per session)
**Slice 0 — Scaffold & health.** Backend + frontend skeleton, `/api/health`, FastAPI serves `frontend/dist`, Vite dev proxy, README "Run it".
*Accept:* both dev servers start; `/api/health` returns `model_loaded:true` when model files exist and `model_loaded:false` with `reason:"model_missing"` when absent, without a crash; production mode serves the page at `/`. README explains where to put model files.

**Slice 1 — Inference core.** `services/inference.py`, `/api/predict`, `/api/classes`, golden tests, error handling.
*Accept:* golden test passes; uncertain flag works with a non-sport image; EXIF-rotated photo gives the same result as the upright one.

**Slice 2 — Scan page (single image first).** App shell with navigation + design system, one image via `<input type="file" accept="image/*">` (mobile capture allowed), `/api/predict`, result card. Live camera comes in slice 3.
*Accept:* works on Android Chrome over HTTPS; loading, error and uncertain states exist.

**Slice 3 — Multi-frame camera scan.** Live camera, 4-frame capture, `/api/scan`, agreement display.
*Accept:* permission-denied and insecure-context messages; works with rear camera on phone; payload < 1.5 MB per scan.

**Slice 4 — Bulk.** `/api/bulk*`, bulk page, ZIP download.
*Accept:* 300 mixed images (incl. 3 corrupt files and 1 non-image) produce correct ZIP layout and `report.csv`; UI never freezes.

**Slice 5 — AR.** `<model-viewer>` flow for 3 sports.
*Accept:* "Xem AR" opens the native AR placement on the test phone (Samsung S24 Ultra, Chrome); button hidden when no asset.

**Slice 6 — Grad-CAM & Insights.** `/api/gradcam`, Insights page.
*Accept:* heatmap overlay returned for MobileNetV2 using the nested base model and `out_relu` (fallback last Conv2D), as specified in §12; Insights renders from `experiments.json` with no hard-coded numbers.

**Slice 7 — Polish & delivery.** Dockerfile, README, empty/skeleton states, a11y pass, dark mode, favicon/title.
*Accept:* `docker build` + `docker run -p 8000:8000` serves the whole app.

## 9. Design brief
- **Mood:** clean, modern, sporty but restrained — think a polished product, not a student demo. Mobile-first.
- **Colour:** neutral slate/zinc surfaces, ONE accent (emerald). Amber for "uncertain", red only for errors.
  Define as shadcn CSS variables; support light and dark (follow system).
- **Type:** Inter (or Geist), clear scale; tabular numbers for percentages.
- **Shape/spacing:** 12 px radius, generous whitespace, 8-pt spacing scale, max content width ~ 720 px on desktop.
- **Components:** shadcn/ui (Card, Button, Tabs, Progress, Table, Badge, Skeleton, Dialog), lucide-react icons, sonner toasts.
- **Motion:** subtle only (150–200 ms); respect `prefers-reduced-motion`.
- **Every screen has:** loading skeleton, empty state, error state. Touch targets >= 44 px. Visible focus rings.
- **Confidence meter:** horizontal bar with numeric percentage; below threshold the whole card switches to the amber "Không chắc chắn" style and shows top-3.

## 10. Config (`.env`)
`MODEL_PATH`, `LABELS_PATH`, `PREPROCESS` (mobilenet_v2), `CONFIDENCE_THRESHOLD`, `MAX_UPLOAD_MB`, `MAX_BULK_FILES`.
Bulk browsing/display: `BULK_RESULTS_PAGE_SIZE=24`, `BULK_RESULTS_MAX_LIMIT=100`, `BULK_THUMB_MAX_SIDE=256`,
`BULK_IMAGE_MAX_SIDE=2048`, `BULK_PREVIEW_JPEG_QUALITY=85`. Display resizing never changes model preprocessing or originals in ZIP.

## 11. Pitfalls to respect
- Camera needs HTTPS (or localhost). iOS Safari needs `playsinline` on `<video>`.
- TensorFlow wheels: if `pip install tensorflow==2.20.0` fails on this Python version, report it; do not switch the model format.
- Do not run Grad-CAM on every frame; compute on demand.
- Do not log or persist user photos beyond the job lifetime (privacy).

## 12. Decisions
1. Bulk limit: MAX_BULK_FILES=2000 (config). "~1000" in §1 is only the typical demo size.
   Over the limit -> reject the whole job (HTTP 413, code too_many_files).
2. Bad files: single-file endpoints (/predict, /scan, /gradcam) reject with 415 unsupported_format /
   422 invalid_image / 413 file_too_large. In /bulk a bad file NEVER fails the job: it goes to loi/ with reason
   unsupported_format | corrupt | too_large and the job continues. Same for non-images inside a ZIP.
3. A single gallery image uses /predict. /scan is only for camera multi-frame (2–6 frames).
4. Slice 2 uses <input type="file" accept="image/*"> (capture allowed on mobile) -> /predict. Live camera is Slice 3.
5. `/bulk/{id}/results` filters and sorts the complete processed result set BEFORE pagination. `label` matches the exact model
   label; `uncertain=true` means uncertain-only, false/empty means all. `sort` is `confidence_desc` (default), `confidence_asc`
   or `filename` (case-insensitive A–Z); error rows with empty confidence are last in both confidence orders, ties use input index.
   `offset` defaults to 0, `limit` defaults to 24, at most 100 (configurable). Empty query values use defaults; invalid queries
   return 400 bad_request. Response `total` counts matches, while `summary` always describes the entire job, independent of filters.
   Items carry stable zero-based input indexes including error rows. `/thumb/{index}` caches JPEGs in `thumbs/`, `/image/{index}`
   caches bounded JPEGs in `images/`; both preserve aspect ratio, apply EXIF orientation for display and use `Cache-Control: private, no-store`.
   Image endpoints never accept filenames. Missing/corrupt/unsupported/oversized images or out-of-range indexes return 404
   image_not_found; unknown/expired jobs use job_not_found/job_expired. Caches are deleted with job files on DELETE or TTL.
   Cleaning up a completed job preserves done/error on both backend and frontend and sets files_removed; cancelling a queued/running
   job still displays cancellation, even if processed equals total while ZIP creation is pending. Browsing metadata remains until TTL.
6. experiments.json schema: {"models":[{"name","strategy","accuracy","macro_f1","params_m","size_mb","latency_ms"}],
   "confusion_matrix_image":"cm.png","gradcam_gallery":[{"image","true","pred","note"}],
   "ablation":[{"name","accuracy","delta"}]}  (ablation optional). Images live in backend/data/insights/
   and are served by GET /api/insights/files/{name} (reject path traversal).
7. Golden test: backend/tests/golden/ with expected.json [{file,label,confidence}]. Golden images are 224x224
   (resize is a no-op). Require 100% label match and |confidence - expected| <= 0.01.
8. Preprocess (replaces the resize wording in §4): PREPROCESS=mobilenet_v2 (best model in the notebook is MobileNetV2).
   Notebook facts: image_size=(224,224), bilinear, no crop, mobilenet_v2.preprocess_input.
   For real phone photos use Pillow Image.resize((224,224), Image.BILINEAR) (antialiased on downscale);
   do NOT use tf.image.resize without antialias.
9. Grad-CAM: for MobileNetV2 use the nested base model and layer "out_relu"; fallback: last Conv2D inside the
   nested model; if neither is found -> HTTP 501 gradcam_unsupported. Two-stage gradient like the notebook.
10. Folder names: slugify labels (lowercase, strip diacritics, spaces->_, only [a-z0-9_]). Never alter labels.json.
    Duplicate filenames get _2, _3 suffix. Folders inside an input ZIP are ignored (flatten by basename).
    report.csv gets an extra "error" column; error rows have folder=loi and empty predicted/confidence.
11. Job expiry: 30 min after a job reaches done/error; afterwards GET returns 410 job_expired. Running jobs never expire.
12. 3D assets: the team places files in frontend/public/models3d/. Do not download assets. sports3d.ts is keyed by
    exact labels in labels.json (football, basketball, golf); warn in the dev console if a key is not in /api/classes.
13. Clean checkout: model files are git-ignored. The app must start without them: /api/health returns 200
    {model_loaded:false, reason:"model_missing"}; prediction endpoints return 503 model_not_loaded.
    Slice 0 accept: model_loaded true when files exist, false+reason when absent, never a crash.
    README says where to put the files.
14. Scan payload > 1.5 MB: client lowers JPEG quality 0.85 -> 0.75 -> 0.65 -> 0.55, then max side 512,
    then drops to 3 frames (minimum 2).
15. Error codes: 400 bad_request, 404 job_not_found, 409 job_not_ready, 410 job_expired,
    404 image_not_found, 413 file_too_large | too_many_files, 415 unsupported_format, 422 invalid_image, 501 gradcam_unsupported,
    503 model_not_loaded, 500 internal_error. Body always {"error":{"code","message"}} with a Vietnamese user-facing message.

## 13. Known issues

- **Camera scans of screens (domain shift):** recognition is poor on the saved
  baseball screen-recapture frames, despite correct predictions on the 100 held-out
  test images for the 20 model classes. The comparison on 2026-11-07 verified that
  the backend model is byte-identical (SHA256) to the notebook export, and labels
  match in length and order. Backend preprocessing matches the documented notebook
  contract in §§4/12 (RGB, 224x224, bilinear, MobileNetV2 normalization), with no
  embedded model preprocessing. The notebook-style `load_img` nearest resize and
  horizontal-flip TTA were also compared; neither made baseball top-1 on these
  frames. Thus this is not a model-file or label-order mismatch; screen recapture
  is the suspected domain shift, not a proven isolated cause. All test images were
  already 224x224, so their accuracy does not distinguish resize methods.
  Camera guidance shows the exact center-square crop over an undistorted preview
  and asks users to fill the square and avoid filming a screen. Validate further
  with original baseball photos and real camera scenes; do not change the model or
  backend preprocessing based on these screen-recapture results alone.
