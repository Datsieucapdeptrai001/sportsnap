from io import BytesIO
from unittest.mock import Mock

import numpy as np
import pytest
from PIL import Image, ImageOps

from app.services.inference import predict_image, preprocess_image


def test_preprocessing_matches_notebook_order_and_bilinear_without_crop() -> None:
    # An asymmetric image makes resizing, cropping and orientation distinguishable.
    pixels = np.random.default_rng(7).integers(0, 256, (391, 157, 3), dtype=np.uint8)
    source = Image.fromarray(pixels)
    exif = Image.Exif()
    exif[274] = 6
    buffer = BytesIO()
    source.save(buffer, format="PNG", exif=exif)
    with Image.open(BytesIO(buffer.getvalue())) as image:
        expected = np.asarray(
            ImageOps.exif_transpose(image).convert("RGB").resize((224, 224), Image.BILINEAR),
            dtype=np.float32,
        )
    # Independent arithmetic checks the MobileNetV2 scaling, including float32.
    expected = expected / np.float32(127.5) - np.float32(1)
    actual = preprocess_image(buffer.getvalue())
    assert actual.shape == (1, 224, 224, 3)
    assert actual.dtype == np.float32
    np.testing.assert_array_equal(actual[0], expected)
    assert -1 <= actual.min() <= actual.max() <= 1


@pytest.mark.parametrize("mode", ["L", "RGBA", "P"])
def test_preprocessing_converts_to_rgb(mode: str) -> None:
    buffer = BytesIO()
    Image.new(mode, (224, 224)).save(buffer, format="PNG")
    result = preprocess_image(buffer.getvalue())
    assert result.shape == (1, 224, 224, 3)
    assert result.dtype == np.float32


@pytest.mark.parametrize(
    ("confidence", "threshold", "uncertain"),
    [(0.59, 0.60, True), (0.60, 0.60, False), (0.61, 0.60, False), (0.65, 0.70, True)],
)
def test_prediction_ranking_threshold_and_batch(
    image_bytes: bytes, confidence: float, threshold: float, uncertain: bool
) -> None:
    model = Mock(predict=Mock(return_value=np.array([[0.10, confidence, 0.20, 0.05]])))
    result = predict_image(image_bytes, model, ["d", "b", "a", "c"], threshold)
    assert result.label == "b"
    assert result.confidence == confidence
    assert [item.label for item in result.top3] == ["b", "a", "d"]
    assert [item.confidence for item in result.top3] == [confidence, 0.20, 0.10]
    assert result.is_uncertain is uncertain
    assert result.threshold == threshold
    assert isinstance(result.latency_ms, int) and result.latency_ms >= 0
    model.predict.assert_called_once()
    assert model.predict.call_args.args[0].shape == (1, 224, 224, 3)


def test_exif_rotated_image_has_identical_pixels_and_prediction() -> None:
    pixels = np.random.default_rng(9).integers(0, 256, (170, 310, 3), dtype=np.uint8)
    upright = Image.fromarray(pixels)
    normal = BytesIO()
    upright.save(normal, format="PNG")
    rotated = BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    upright.transpose(Image.Transpose.ROTATE_90).save(rotated, format="PNG", exif=exif)
    np.testing.assert_array_equal(preprocess_image(normal.getvalue()), preprocess_image(rotated.getvalue()))
    model = Mock(predict=Mock(return_value=np.array([[0.7, 0.2, 0.1]])))
    first = predict_image(normal.getvalue(), model, ["a", "b", "c"], 0.6)
    second = predict_image(rotated.getvalue(), model, ["a", "b", "c"], 0.6)
    assert first.model_dump(exclude={"latency_ms"}) == second.model_dump(exclude={"latency_ms"})
