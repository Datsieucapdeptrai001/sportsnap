from io import BytesIO
from time import perf_counter_ns
from typing import Protocol
import warnings

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import APIError
from app.schemas import ClassConfidence, FramePrediction, Prediction, ScanResult


SUPPORTED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
SUPPORTED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})


class Classifier(Protocol):
    def predict(
        self, batch: NDArray[np.float32], *, verbose: int = 0
    ) -> NDArray[np.floating]: ...


def preprocess_image(data: bytes, preprocess: str = "mobilenet_v2") -> NDArray[np.float32]:
    """Apply only the notebook preprocessing specified in SPEC sections 4 and 12."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format not in SUPPORTED_FORMATS:
                    raise APIError(
                        415, "unsupported_format", "Chỉ hỗ trợ ảnh JPG, JPEG, PNG hoặc WebP."
                    )
                source.verify()
            # verify() invalidates the decoder, so reopen before reading pixels.
            with Image.open(BytesIO(data)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                image = image.resize((224, 224), Image.BILINEAR)
                pixels = np.asarray(image, dtype=np.float32)
    except (
        UnidentifiedImageError, OSError, SyntaxError, ValueError,
        Image.DecompressionBombError, Image.DecompressionBombWarning,
    ) as exc:
        raise APIError(
            422, "invalid_image", "Ảnh bị hỏng hoặc không thể đọc được. Vui lòng chọn ảnh khác."
        ) from exc

    # Keep TensorFlow lazy: a checkout without model files can still start.
    if preprocess == "mobilenet_v2":
        from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
    elif preprocess == "resnet50":
        from tensorflow.keras.applications.resnet50 import preprocess_input
    else:
        raise ValueError(f"Unsupported preprocess mode: {preprocess}")

    return np.expand_dims(preprocess_input(pixels), axis=0)


def predict_image(
    data: bytes,
    model: Classifier,
    labels: list[str],
    threshold: float,
    preprocess: str = "mobilenet_v2",
) -> Prediction:
    started = perf_counter_ns()
    batch = preprocess_image(data, preprocess=preprocess)
    outputs = np.asarray(model.predict(batch, verbose=0))
    if (
        outputs.shape != (1, len(labels))
        or not labels
        or not np.isfinite(outputs).all()
        or (outputs < 0).any()
        or (outputs > 1).any()
    ):
        raise ValueError("Model output must contain one probability per label.")
    probabilities = outputs[0]
    indices = np.argsort(-probabilities, kind="stable")[:3]
    top3 = [
        ClassConfidence(label=labels[int(index)], confidence=float(probabilities[index]))
        for index in indices
    ]
    return Prediction(
        label=top3[0].label,
        confidence=top3[0].confidence,
        top3=top3,
        is_uncertain=top3[0].confidence < threshold,
        threshold=threshold,
        latency_ms=(perf_counter_ns() - started) // 1_000_000,
    )


def predict_frames(
    frames: list[bytes],
    model: Classifier,
    labels: list[str],
    threshold: float,
    preprocess: str = "mobilenet_v2",
) -> ScanResult:
    started = perf_counter_ns()
    # Decode every frame before inference; one bad frame rejects the whole scan.
    batch = np.concatenate(
        [preprocess_image(frame, preprocess=preprocess) for frame in frames], axis=0
    )
    outputs = np.asarray(model.predict(batch, verbose=0))
    if (
        outputs.shape != (len(frames), len(labels))
        or not labels
        or not np.isfinite(outputs).all()
        or (outputs < 0).any()
        or (outputs > 1).any()
    ):
        raise ValueError("Model output must contain one probability per frame and label.")
    probabilities = outputs.mean(axis=0)
    indices = np.argsort(-probabilities, kind="stable")[:3]
    top3 = [
        ClassConfidence(label=labels[int(index)], confidence=float(probabilities[index]))
        for index in indices
    ]
    frame_indices = outputs.argmax(axis=1)
    return ScanResult(
        label=top3[0].label,
        confidence=top3[0].confidence,
        top3=top3,
        is_uncertain=top3[0].confidence < threshold,
        threshold=threshold,
        latency_ms=(perf_counter_ns() - started) // 1_000_000,
        per_frame=[
            FramePrediction(label=labels[int(index)], confidence=float(outputs[row, index]))
            for row, index in enumerate(frame_indices)
        ],
        agreement=float(np.count_nonzero(frame_indices == indices[0]) / len(frames)),
    )
