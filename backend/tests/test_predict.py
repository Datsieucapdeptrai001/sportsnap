from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi.testclient import TestClient
from httpx import Response
from PIL import Image

from app.core.config import Settings
from app.main import create_app


def assert_error(response: Response, status: int, code: str) -> None:
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == code
    assert body["error"]["message"]
    assert "Traceback" not in response.text


def test_classes_use_training_order(inference_client: TestClient) -> None:
    response = inference_client.get("/api/classes")
    assert response.status_code == 200
    assert response.json() == {"classes": ["class_a", "class_b", "class_c", "class_d"]}


@pytest.mark.parametrize(("format", "mime"), [("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")])
def test_supported_images_return_prediction(
    inference_client: TestClient, format: str, mime: str
) -> None:
    data = BytesIO()
    Image.new("RGB", (320, 160), (50, 100, 150)).save(data, format=format)
    response = inference_client.post("/api/predict", files={"file": ("photo", data.getvalue(), mime)})
    assert response.status_code == 200
    result = response.json()
    assert set(result) == {"label", "confidence", "top3", "is_uncertain", "threshold", "latency_ms"}
    assert result["label"] == "class_b"
    assert result["confidence"] == 0.55
    assert result["top3"] == [
        {"label": "class_b", "confidence": 0.55},
        {"label": "class_c", "confidence": 0.25},
        {"label": "class_a", "confidence": 0.15},
    ]
    assert result["is_uncertain"] is True
    assert result["threshold"] == 0.6
    assert isinstance(result["latency_ms"], int) and result["latency_ms"] >= 0


def test_threshold_is_configurable(inference_client: TestClient, image_bytes: bytes) -> None:
    inference_client.app.state.settings.CONFIDENCE_THRESHOLD = 0.5
    response = inference_client.post("/api/predict", files={"file": ("photo.png", image_bytes, "image/png")})
    assert response.json()["is_uncertain"] is False
    assert response.json()["threshold"] == 0.5


@pytest.mark.parametrize("mime", ["text/plain", "image/gif", "application/zip"])
def test_unsupported_upload_is_rejected(
    inference_client: TestClient, classifier: Mock, mime: str
) -> None:
    response = inference_client.post("/api/predict", files={"file": ("file", b"unsupported", mime)})
    assert_error(response, 415, "unsupported_format")
    classifier.predict.assert_not_called()


def test_mime_spoof_cannot_bypass_format_check(inference_client: TestClient, classifier: Mock) -> None:
    data = BytesIO()
    Image.new("RGB", (16, 16)).save(data, format="GIF")
    response = inference_client.post("/api/predict", files={"file": ("photo.jpg", data.getvalue(), "image/jpeg")})
    assert_error(response, 415, "unsupported_format")
    classifier.predict.assert_not_called()


@pytest.mark.parametrize("data", [b"", b"not an image", b"\xff\xd8\xff\xe0\x00\x10JFIF"])
def test_invalid_image_is_rejected(
    inference_client: TestClient, classifier: Mock, data: bytes
) -> None:
    response = inference_client.post("/api/predict", files={"file": ("photo.jpg", data, "image/jpeg")})
    assert_error(response, 422, "invalid_image")
    classifier.predict.assert_not_called()


def test_corrupt_png_checksum_is_rejected(inference_client: TestClient, image_bytes: bytes) -> None:
    data = bytearray(image_bytes)
    index = data.index(b"IDAT") + 5
    data[index] ^= 1
    response = inference_client.post("/api/predict", files={"file": ("photo.png", bytes(data), "image/png")})
    assert_error(response, 422, "invalid_image")


def test_truncated_jpeg_is_rejected(inference_client: TestClient) -> None:
    data = BytesIO()
    Image.new("RGB", (256, 256), (50, 100, 150)).save(data, format="JPEG")
    response = inference_client.post("/api/predict", files={"file": ("photo.jpg", data.getvalue()[:-20], "image/jpeg")})
    assert_error(response, 422, "invalid_image")


def test_decompression_bomb_is_rejected(
    inference_client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 40_000)
    response = inference_client.post("/api/predict", files={"file": ("photo.png", image_bytes, "image/png")})
    assert_error(response, 422, "invalid_image")


def test_upload_limit_boundary(inference_client: TestClient, classifier: Mock, image_bytes: bytes) -> None:
    limit = 12 * 1024 * 1024
    data = image_bytes + b"\0" * (limit - len(image_bytes))
    response = inference_client.post("/api/predict", files={"file": ("photo.png", data, "image/png")})
    assert response.status_code == 200
    classifier.predict.reset_mock()
    response = inference_client.post("/api/predict", files={"file": ("photo.png", data + b"\0", "image/png")})
    assert_error(response, 413, "file_too_large")
    classifier.predict.assert_not_called()
    inference_client.app.state.settings.MAX_UPLOAD_MB = 1
    response = inference_client.post("/api/predict", files={"file": ("photo.png", data, "image/png")})
    assert_error(response, 413, "file_too_large")


def test_missing_model_returns_503(tmp_path: Path, image_bytes: bytes) -> None:
    with TestClient(create_app(Settings(BASE_DIR=tmp_path, _env_file=None))) as client:
        assert client.get("/api/classes").json() == {"classes": []}
        response = client.post("/api/predict", files={"file": ("photo.png", image_bytes, "image/png")})
        assert_error(response, 503, "model_not_loaded")


def test_missing_file_uses_error_envelope(inference_client: TestClient) -> None:
    assert_error(inference_client.post("/api/predict"), 400, "bad_request")
    assert_error(inference_client.post("/api/predict", data={"file": "text"}), 400, "bad_request")


def test_malformed_multipart_uses_error_envelope(inference_client: TestClient) -> None:
    response = inference_client.post("/api/predict", content=b"broken", headers={"Content-Type": "multipart/form-data"})
    assert_error(response, 400, "bad_request")


@pytest.mark.parametrize("output", [None, np.array([[float("nan"), 0, 0, 0]]), np.array([[1.1, 0, 0, 0]])])
def test_model_failures_are_sanitized(
    inference_client: TestClient, classifier: Mock, image_bytes: bytes, output: np.ndarray | None
) -> None:
    if output is None:
        classifier.predict.side_effect = RuntimeError("private model failure")
    else:
        classifier.predict.return_value = output
    response = inference_client.post("/api/predict", files={"file": ("photo.png", image_bytes, "image/png")})
    assert_error(response, 500, "internal_error")
    assert "private model failure" not in response.text


def test_predict_cors_preflight(inference_client: TestClient) -> None:
    response = inference_client.options("/api/predict", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_predict_routes_precede_static_mount(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, classifier: Mock, image_bytes: bytes
) -> None:
    config = Settings(BASE_DIR=tmp_path, _env_file=None)
    config.MODEL_PATH.parent.mkdir(parents=True)
    config.MODEL_PATH.touch()
    config.LABELS_PATH.write_text('["class_a", "class_b", "class_c", "class_d"]', encoding="utf-8")
    config.FRONTEND_DIST.mkdir(parents=True)
    (config.FRONTEND_DIST / "index.html").write_text("SportSnap", encoding="utf-8")
    classifier.output_shape = (None, 4)
    monkeypatch.setattr("app.main.load_keras_model", Mock(return_value=classifier))
    with TestClient(create_app(config)) as client:
        assert client.get("/").status_code == 200
        assert client.get("/api/classes").status_code == 200
        assert client.post("/api/predict", files={"file": ("photo.png", image_bytes, "image/png")}).status_code == 200
