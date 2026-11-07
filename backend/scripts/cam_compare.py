"""Compare webcam preprocessing without changing the application or model.

Run from the repository root:
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\cam_compare.py
SPACE captures and compares one frame; Q closes the preview.
"""

from io import BytesIO
from pathlib import Path
import sys
from uuid import uuid4

try:
    import cv2
except ImportError:
    raise SystemExit(
        "Thiếu OpenCV. Chạy: python -m pip install --no-deps opencv-python"
    ) from None

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from pydantic import TypeAdapter


# Support running this file directly from either the repository or backend.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Settings
from app.core.errors import APIError
from app.main import load_keras_model
from app.services.inference import predict_image, preprocess_image


def encode_rgb(pixels: NDArray[np.uint8], *, jpeg: bool = False) -> bytes:
    """Keep RGB ordering when serializing the OpenCV-resized arrays."""
    buffer = BytesIO()
    image = Image.fromarray(pixels)
    if jpeg:
        image.save(buffer, format="JPEG", quality=95)
    else:
        image.save(buffer, format="PNG")
    return buffer.getvalue()


def comparison_inputs(frame: NDArray[np.uint8]) -> list[tuple[str, bytes]]:
    """A/B use OpenCV resize; C simulates the web's square JPEG upload."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    height, width = rgb.shape[:2]
    side = min(width, height)
    sx = (width - side) // 2
    sy = (height - side) // 2
    square = rgb[sy:sy + side, sx:sx + side]
    return [
        ("A_squash", encode_rgb(cv2.resize(rgb, (224, 224), interpolation=cv2.INTER_LINEAR))),
        ("B_crop", encode_rgb(cv2.resize(square, (224, 224), interpolation=cv2.INTER_LINEAR))),
        ("C_web", encode_rgb(cv2.resize(square, (448, 448), interpolation=cv2.INTER_LINEAR), jpeg=True)),
    ]


def compare_capture(frame: NDArray[np.uint8], config: Settings) -> Path:
    """Reload the fixed model and labels for each capture, then print top three."""
    if not config.MODEL_PATH.is_file() or not config.LABELS_PATH.is_file():
        raise ValueError("Thiếu best_model.keras hoặc labels.json. Kiểm tra MODEL_PATH và LABELS_PATH.")
    labels = TypeAdapter(list[str]).validate_json(
        config.LABELS_PATH.read_text(encoding="utf-8"), strict=True,
    )
    if not labels or any(not label.strip() for label in labels):
        raise ValueError("Danh sách nhãn phải chứa các chuỗi không rỗng.")
    model = load_keras_model(config.MODEL_PATH)
    if model.output_shape[-1] != len(labels):
        raise ValueError("Số lớp của mô hình không khớp labels.json.")

    directory = config.DEBUG_FRAMES_DIR / "cam_compare" / uuid4().hex
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "original.png").write_bytes(encode_rgb(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
    print(f"\nFrame gốc: {frame.shape[1]}×{frame.shape[0]}; ảnh lưu tại {directory}", flush=True)
    print("A/B: OpenCV INTER_LINEAR → RGB PNG 224 → backend (resize 224 không đổi).", flush=True)
    print("C: crop → OpenCV INTER_LINEAR 448 → JPEG 95 → preprocess_image của backend.", flush=True)
    print("JPEG và nội suy trong trình duyệt có thể khác OpenCV/Pillow ở mức pixel.", flush=True)
    for name, payload in comparison_inputs(frame):
        # Use the exact backend tensor, undoing normalization only for viewing.
        batch = preprocess_image(payload)
        pixels = np.clip(np.rint((batch[0] + 1) * 127.5), 0, 255).astype(np.uint8)
        Image.fromarray(pixels).save(directory / f"{name}_input.png")
        if name == "C_web":
            (directory / "C_web_upload.jpg").write_bytes(payload)
        # Reuse backend normalization, output validation and stable top-3 ranking.
        prediction = predict_image(payload, model, labels, config.CONFIDENCE_THRESHOLD)
        top3 = " | ".join(f"{item.label}: {item.confidence:.2%}" for item in prediction.top3)
        print(f"{name}: {top3}", flush=True)
    return directory


def main() -> int:
    # Windows terminals and redirected output may otherwise default to cp1252.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    config = Settings()
    camera = cv2.VideoCapture(0)
    title = "SportSnap - SPACE: chup | Q: thoat"
    try:
        if not camera.isOpened():
            print("Không mở được webcam 0. Kiểm tra quyền camera hoặc ứng dụng đang sử dụng camera.", file=sys.stderr)
            return 1
        print("SPACE: chụp và so sánh A/B/C. Q: thoát. Chọn cửa sổ preview trước khi nhấn phím.", flush=True)
        while True:
            ok, frame = camera.read()
            if not ok or frame is None:
                print("Không đọc được hình ảnh từ webcam. Vui lòng mở lại camera.", file=sys.stderr)
                return 1
            cv2.imshow(title, frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q")):
                return 0
            if cv2.getWindowProperty(title, cv2.WND_PROP_VISIBLE) < 1:
                return 0
            if key == ord(" "):
                print("Đang nạp mô hình và so sánh frame…", flush=True)
                try:
                    compare_capture(frame.copy(), config)
                except APIError as exc:
                    print(f"Không thể xử lý frame: {exc.body.error.message}", file=sys.stderr)
                except (OSError, ValueError, RuntimeError, ImportError, cv2.error) as exc:
                    print(f"Không thể so sánh frame: {exc}", file=sys.stderr)
    except cv2.error:
        print("Không thể mở preview OpenCV. Cần opencv-python có giao diện và phiên desktop.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        camera.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    raise SystemExit(main())
