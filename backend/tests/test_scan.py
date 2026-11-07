from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.main import create_app
from app.services.inference import preprocess_image
from tests.test_predict import assert_error


def uploads(data: bytes, count: int) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("files", (f"frame-{index}.png", data, "image/png")) for index in range(count)]


def test_scan_averages_full_vectors_instead_of_majority_vote(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes,
) -> None:
    classifier.predict.return_value = np.array([
        [0.40, 0.35, 0.20, 0.05],
        [0.40, 0.35, 0.20, 0.05],
        [0.40, 0.35, 0.20, 0.05],
        [0.02, 0.90, 0.05, 0.03],
    ])
    response = inference_client.post("/api/scan", files=uploads(image_bytes, 4))
    assert response.status_code == 200, response.text
    result = response.json()
    assert set(result) == {
        "label", "confidence", "top3", "is_uncertain", "threshold", "latency_ms",
        "per_frame", "agreement",
    }
    assert result["label"] == "class_b"
    assert result["confidence"] == pytest.approx(0.4875)
    assert result["agreement"] == 0.25
    assert result["per_frame"] == [
        {"label": "class_a", "confidence": 0.4},
        {"label": "class_a", "confidence": 0.4},
        {"label": "class_a", "confidence": 0.4},
        {"label": "class_b", "confidence": 0.9},
    ]
    assert [item["label"] for item in result["top3"]] == ["class_b", "class_a", "class_c"]
    assert [item["confidence"] for item in result["top3"]] == pytest.approx([0.4875, 0.305, 0.1625])
    assert result["is_uncertain"] is True
    assert result["threshold"] == 0.6
    assert isinstance(result["latency_ms"], int) and result["latency_ms"] >= 0
    classifier.predict.assert_called_once()
    batch = classifier.predict.call_args.args[0]
    assert batch.shape == (4, 224, 224, 3)
    assert batch.dtype == np.float32
    for frame in batch:
        np.testing.assert_array_equal(frame, preprocess_image(image_bytes)[0])


@pytest.mark.parametrize("count", [2, 6])
@pytest.mark.parametrize(("confidence", "threshold", "uncertain"), [
    (0.59, 0.6, True), (0.6, 0.6, False), (0.7, 0.75, True), (0.7, 0.65, False),
])
def test_valid_boundaries_agreement_and_configured_threshold(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes,
    count: int, confidence: float, threshold: float, uncertain: bool,
) -> None:
    classifier.predict.return_value = np.tile([0.1, confidence, 0.1, 0.1], (count, 1))
    inference_client.app.state.settings.CONFIDENCE_THRESHOLD = threshold
    response = inference_client.post("/api/scan", files=uploads(image_bytes, count))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["agreement"] == 1
    assert len(result["per_frame"]) == count
    assert result["confidence"] == pytest.approx(confidence)
    assert result["threshold"] == threshold
    assert result["is_uncertain"] is uncertain


@pytest.mark.parametrize("count", [0, 1, 7])
def test_frame_count_is_rejected(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes, count: int,
) -> None:
    response = inference_client.post("/api/scan", files=uploads(image_bytes, count))
    assert_error(response, 400, "bad_request")
    assert "2" in response.json()["error"]["message"]
    assert "6" in response.json()["error"]["message"]
    classifier.predict.assert_not_called()


@pytest.mark.parametrize("position", [0, 1, 3])
@pytest.mark.parametrize("corrupt", [b"", b"broken image", b"\x89PNG\r\n\x1a\n"])
def test_any_corrupt_frame_rejects_whole_scan(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes,
    position: int, corrupt: bytes,
) -> None:
    files = uploads(image_bytes, 4)
    files[position] = ("files", ("corrupt.png", corrupt, "image/png"))
    assert_error(inference_client.post("/api/scan", files=files), 422, "invalid_image")
    classifier.predict.assert_not_called()


def test_scan_uses_existing_exif_and_rgb_preprocessing(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes,
) -> None:
    buffer = BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGBA", (90, 310), (50, 100, 200, 255)).save(buffer, format="PNG", exif=exif)
    rotated = buffer.getvalue()
    classifier.predict.return_value = np.tile([0.7, 0.1, 0.1, 0.1], (2, 1))
    response = inference_client.post("/api/scan", files=[
        ("files", ("normal.png", image_bytes, "image/png")),
        ("files", ("rotated.png", rotated, "image/png")),
    ])
    assert response.status_code == 200
    np.testing.assert_array_equal(
        classifier.predict.call_args.args[0],
        np.concatenate([preprocess_image(image_bytes), preprocess_image(rotated)]),
    )


@pytest.mark.parametrize("spoof", [False, True])
def test_unsupported_frame_is_rejected(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes, spoof: bool,
) -> None:
    buffer = BytesIO()
    Image.new("RGB", (10, 10)).save(buffer, format="GIF")
    files = uploads(image_bytes, 2)
    files[1] = ("files", ("unsupported.gif", buffer.getvalue(), "image/jpeg" if spoof else "image/gif"))
    assert_error(inference_client.post("/api/scan", files=files), 415, "unsupported_format")
    classifier.predict.assert_not_called()


def test_per_frame_upload_limit_is_enforced(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes,
) -> None:
    inference_client.app.state.settings.MAX_UPLOAD_MB = 1
    files = uploads(image_bytes, 2)
    files[1] = ("files", ("large.png", b"x" * (1024 * 1024 + 1), "image/png"))
    assert_error(inference_client.post("/api/scan", files=files), 413, "file_too_large")
    classifier.predict.assert_not_called()


def test_missing_model_returns_503(tmp_path: Path, image_bytes: bytes) -> None:
    with TestClient(create_app(Settings(BASE_DIR=tmp_path, _env_file=None))) as client:
        assert_error(client.post("/api/scan", files=uploads(image_bytes, 2)), 503, "model_not_loaded")


@pytest.mark.parametrize("output", [
    None, np.array([[0.7, 0.1, 0.1, 0.1]]),
    np.full((2, 4), float("nan")), np.full((2, 4), -0.1), np.full((2, 4), 1.1),
])
def test_model_failures_are_sanitized(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes, output: np.ndarray | None,
) -> None:
    if output is None:
        classifier.predict.side_effect = RuntimeError("private scan failure")
    else:
        classifier.predict.return_value = output
    response = inference_client.post("/api/scan", files=uploads(image_bytes, 2))
    assert_error(response, 500, "internal_error")
    assert "private scan failure" not in response.text


def test_wrong_field_and_malformed_requests_use_error_envelope(inference_client: TestClient) -> None:
    assert_error(inference_client.post("/api/scan", data={"files": "text"}), 400, "bad_request")
    response = inference_client.post(
        "/api/scan", content=b"broken", headers={"Content-Type": "multipart/form-data"},
    )
    assert_error(response, 400, "bad_request")


@pytest.mark.parametrize("enabled", [False, True])
def test_debug_frames_are_opt_in_original_bytes_and_scan_only(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes, enabled: bool,
) -> None:
    config = inference_client.app.state.settings
    assert config.DEBUG_SAVE_FRAMES is False
    assert config.DEBUG_FRAMES_DIR == config.BASE_DIR / "backend/debug_frames"
    config.DEBUG_SAVE_FRAMES = enabled
    classifier.predict.return_value = np.tile([0.7, 0.1, 0.1, 0.1], (2, 1))
    for _ in range(2):
        response = inference_client.post("/api/scan", files=uploads(image_bytes, 2))
        assert response.status_code == 200, response.text
    if enabled:
        saved = list(config.DEBUG_FRAMES_DIR.iterdir())
        assert len(saved) == 4
        assert all(path.suffix == ".png" and path.read_bytes() == image_bytes for path in saved)
    else:
        assert not config.DEBUG_FRAMES_DIR.exists()

    classifier.predict.return_value = np.array([[0.7, 0.1, 0.1, 0.1]])
    response = inference_client.post("/api/predict", files={"file": ("photo.png", image_bytes, "image/png")})
    assert response.status_code == 200, response.text
    assert len(list(config.DEBUG_FRAMES_DIR.glob("*"))) == (4 if enabled else 0)


def test_debug_write_failure_does_not_break_scan(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inference_client.app.state.settings.DEBUG_SAVE_FRAMES = True
    monkeypatch.setattr(Path, "write_bytes", Mock(side_effect=PermissionError("debug directory is read-only")))
    classifier.predict.return_value = np.tile([0.7, 0.1, 0.1, 0.1], (2, 1))
    response = inference_client.post("/api/scan", files=uploads(image_bytes, 2))
    assert response.status_code == 200, response.text
    assert response.json()["label"] == "class_a"
