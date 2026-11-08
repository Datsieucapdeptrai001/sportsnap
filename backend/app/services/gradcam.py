"""On-demand, two-stage Grad-CAM for the unchanged nested MobileNetV2."""

import base64
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from time import perf_counter_ns
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps

from app.core.errors import APIError
from app.schemas import Explanation
from app.services.inference import predict_image, preprocess_image


@dataclass
class GradCamResult:
    explanation: Explanation
    # Native spatial resolution of the target layer, e.g. 7x7 for out_relu.
    heatmap: NDArray[np.float32]


@lru_cache(maxsize=1)
def build_gradcam_graph(model: Any) -> tuple[Any, Any]:
    from tensorflow import keras

    bases = [layer for layer in model.layers if isinstance(layer, keras.Model)]
    if not bases:
        raise APIError(501, "gradcam_unsupported", "Mô hình này chưa hỗ trợ bản đồ vùng chú ý.")
    base = bases[-1]
    try:
        target = base.get_layer("out_relu")
    except ValueError:
        targets = [layer for layer in base.layers if isinstance(layer, keras.layers.Conv2D)]
        if not targets:
            raise APIError(501, "gradcam_unsupported", "Không tìm thấy lớp tích chập để tạo bản đồ chú ý.")
        target = targets[-1]
    # The outer model's input and the nested layer output are different graphs.
    conv_model = keras.Model(base.input, target.output)
    classifier_input = keras.Input(shape=target.output.shape[1:])
    value = classifier_input
    if target is not base.layers[-1]:
        # A last-Conv2D fallback may still have BN/activation layers inside base.
        tail = keras.Model(target.output, base.output)
        value = tail(value, training=False)
    for layer in model.layers[model.layers.index(base) + 1:]:
        value = layer(value, training=False)
    classifier_model = keras.Model(classifier_input, value)
    return conv_model, classifier_model


def jet_colors(heatmap: NDArray[np.float32]) -> NDArray[np.uint8]:
    """Map [0,1] to the piecewise-linear jet RGB palette without plotting deps."""
    channels = [np.clip(1.5 - np.abs(4 * heatmap - offset), 0, 1) for offset in (3, 2, 1)]
    return np.uint8(np.stack(channels, axis=-1) * 255)


def explain_image(data: bytes, model: Any, labels: list[str], threshold: float) -> GradCamResult:
    """Caller must hold the shared model lock and run outside the event loop."""
    import tensorflow as tf

    started = perf_counter_ns()
    prediction = predict_image(data, model, labels, threshold)
    batch = preprocess_image(data)
    conv_model, classifier_model = build_gradcam_graph(model)
    target_index = labels.index(prediction.label)
    with tf.GradientTape() as tape:
        conv_outputs = conv_model(batch, training=False)
        tape.watch(conv_outputs)
        probabilities = classifier_model(conv_outputs, training=False)
        score = probabilities[:, target_index]
    gradients = tape.gradient(score, conv_outputs)
    if gradients is None:
        raise APIError(501, "gradcam_unsupported", "Không thể tính vùng chú ý cho mô hình này.")
    weights = tf.reduce_mean(gradients, axis=(0, 1, 2))
    heatmap = tf.maximum(tf.reduce_sum(conv_outputs[0] * weights, axis=-1), 0)
    heatmap = tf.math.divide_no_nan(heatmap, tf.reduce_max(heatmap)).numpy().astype(np.float32)
    if not np.isfinite(heatmap).all():
        raise ValueError("Grad-CAM produced non-finite values.")
    with Image.open(BytesIO(data)) as source:
        original = ImageOps.exif_transpose(source).convert("RGB")
    # Display resizing only: preserve orientation/aspect; PNG base64 stays <1 MB
    # even for noisy RGB images (448*448*3 plus PNG/base64 overhead).
    original.thumbnail((448, 448), Image.Resampling.LANCZOS)
    resized = np.asarray(Image.fromarray(heatmap).resize(original.size, Image.Resampling.BILINEAR))
    overlay = np.uint8(np.asarray(original) * 0.6 + jet_colors(resized) * 0.4)
    buffer = BytesIO()
    Image.fromarray(overlay).save(buffer, format="PNG")
    explanation = Explanation(
        **prediction.model_dump(exclude={"latency_ms"}),
        latency_ms=(perf_counter_ns() - started) // 1_000_000,
        overlay_png_base64=base64.b64encode(buffer.getvalue()).decode("ascii"),
    )
    return GradCamResult(explanation=explanation, heatmap=heatmap)
