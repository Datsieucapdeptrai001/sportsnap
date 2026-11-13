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


@lru_cache(maxsize=8)
def build_gradcam_graph(model: Any) -> tuple[Any, Any]:
    from tensorflow import keras

    bases = [layer for layer in model.layers if isinstance(layer, keras.Model)]
    if bases:
        base = bases[-1]
        target = None
        for layer_name in ("out_relu", "conv5_block3_out"):
            try:
                target = base.get_layer(layer_name)
                break
            except ValueError:
                continue
        if target is None:
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

    # Flat models (such as cnn_scratch_best.keras) expose Conv2D layers directly.
    target = None
    try:
        target = model.get_layer("last_conv")
    except ValueError:
        conv_layers = [layer for layer in model.layers if isinstance(layer, keras.layers.Conv2D)]
        if conv_layers:
            target = conv_layers[-1]
    if target is None:
        raise APIError(501, "gradcam_unsupported", "Mô hình này chưa hỗ trợ bản đồ vùng chú ý.")

    model_input = model.inputs[0] if getattr(model, "inputs", None) else model.input
    conv_model = keras.Model(model_input, target.output)
    classifier_input = keras.Input(shape=target.output.shape[1:])
    value = classifier_input
    for layer in model.layers[model.layers.index(target) + 1:]:
        value = layer(value, training=False)
    classifier_model = keras.Model(classifier_input, value)
    return conv_model, classifier_model


def jet_colors(heatmap: NDArray[np.float32]) -> NDArray[np.uint8]:
    """Map [0,1] to the piecewise-linear jet RGB palette without plotting deps."""
    channels = [np.clip(1.5 - np.abs(4 * heatmap - offset), 0, 1) for offset in (3, 2, 1)]
    return np.uint8(np.stack(channels, axis=-1) * 255)


def explain_image(
    data: bytes,
    model: Any,
    labels: list[str],
    threshold: float,
    preprocess: str = "mobilenet_v2",
) -> GradCamResult:
    """Caller must hold the shared model lock and run outside the event loop."""
    import tensorflow as tf

    started = perf_counter_ns()
    prediction = predict_image(data, model, labels, threshold, preprocess=preprocess)
    batch = preprocess_image(data, preprocess=preprocess)
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
    # Threshold background noise to avoid washing out the original photo with a blue tint.
    # Pixels with heatmap < 0.10 keep 100% original photo. Higher activations smoothly ramp up to vivid alpha 0.82.
    threshold_val = 0.10
    alpha = np.clip((resized - threshold_val) / (1.0 - threshold_val), 0.0, 1.0)[..., np.newaxis] * 0.82
    orig_arr = np.asarray(original, dtype=np.float32)
    jet_arr = jet_colors(resized).astype(np.float32)
    overlay = np.uint8(orig_arr * (1.0 - alpha) + jet_arr * alpha)
    buffer = BytesIO()
    Image.fromarray(overlay).save(buffer, format="PNG")
    explanation = Explanation(
        **prediction.model_dump(exclude={"latency_ms"}),
        latency_ms=(perf_counter_ns() - started) // 1_000_000,
        overlay_png_base64=base64.b64encode(buffer.getvalue()).decode("ascii"),
    )
    return GradCamResult(explanation=explanation, heatmap=heatmap)
