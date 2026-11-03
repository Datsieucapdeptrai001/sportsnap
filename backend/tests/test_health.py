import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(BASE_DIR=tmp_path, _env_file=None)


@pytest.mark.parametrize("missing", ["both", "model", "labels"])
def test_missing_files_do_not_prevent_startup(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, missing: str
) -> None:
    settings.MODEL_PATH.parent.mkdir(parents=True)
    if missing == "labels":
        settings.MODEL_PATH.touch()
    if missing == "model":
        settings.LABELS_PATH.write_text('["football"]', encoding="utf-8")
    loader = Mock(side_effect=AssertionError("Missing files must bypass model loading."))
    monkeypatch.setattr("app.main.load_keras_model", loader)

    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {
            "status": "ok", "model_loaded": False, "num_classes": 0,
            "preprocess": "mobilenet_v2", "reason": "model_missing",
        }
    loader.assert_not_called()


def test_model_and_labels_load_once_per_lifespan(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.MODEL_PATH.parent.mkdir(parents=True)
    settings.MODEL_PATH.touch()
    labels = ["football", "basketball"]
    settings.LABELS_PATH.write_text(json.dumps(labels), encoding="utf-8")
    model = SimpleNamespace(output_shape=(None, 2))
    loader = Mock(return_value=model)
    monkeypatch.setattr("app.main.load_keras_model", loader)
    application = create_app(settings)

    with TestClient(application) as client:
        for _ in range(2):
            response = client.get("/api/health")
            assert response.status_code == 200
            assert response.json() == {
                "status": "ok", "model_loaded": True, "num_classes": 2,
                "preprocess": "mobilenet_v2",
            }
        assert application.state.model is model
        assert application.state.labels == labels
    loader.assert_called_once_with(settings.MODEL_PATH)
    assert application.state.model is None


@pytest.mark.parametrize("labels", ['{', '{}', '[]', '[1]', '[""]'])
def test_invalid_labels_do_not_prevent_startup(settings: Settings, labels: str) -> None:
    settings.MODEL_PATH.parent.mkdir(parents=True)
    settings.MODEL_PATH.touch()
    settings.LABELS_PATH.write_text(labels, encoding="utf-8")
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["model_loaded"] is False
        assert response.json()["reason"] == "model_load_failed"
        assert response.json()["num_classes"] == 0


@pytest.mark.parametrize("failure", [ImportError("TensorFlow unavailable"), ValueError("Invalid model")])
def test_model_loading_errors_do_not_prevent_startup(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, failure: Exception
) -> None:
    settings.MODEL_PATH.parent.mkdir(parents=True)
    settings.MODEL_PATH.touch()
    settings.LABELS_PATH.write_text('["football"]', encoding="utf-8")
    monkeypatch.setattr("app.main.load_keras_model", Mock(side_effect=failure))
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["model_loaded"] is False
        assert response.json()["reason"] == "model_load_failed"
        assert str(failure) not in response.text


def test_mismatched_labels_do_not_report_model_ready(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.MODEL_PATH.parent.mkdir(parents=True)
    settings.MODEL_PATH.touch()
    settings.LABELS_PATH.write_text('["football"]', encoding="utf-8")
    monkeypatch.setattr("app.main.load_keras_model", Mock(return_value=SimpleNamespace(output_shape=(None, 2))))
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/health").json()["reason"] == "model_load_failed"


def test_static_frontend_and_api_can_be_served_together(settings: Settings) -> None:
    settings.FRONTEND_DIST.mkdir(parents=True)
    (settings.FRONTEND_DIST / "index.html").write_text("<h1>SportSnap</h1>", encoding="utf-8")
    with TestClient(create_app(settings)) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert "SportSnap" in response.text
        assert client.get("/api/health").json()["reason"] == "model_missing"


def test_configured_cors_origin(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        response = client.get("/api/health", headers={"Origin": "https://untrusted.example"})
        assert "access-control-allow-origin" not in response.headers


def test_real_model_health_when_files_are_available() -> None:
    config = Settings()
    if not config.MODEL_PATH.is_file() or not config.LABELS_PATH.is_file():
        pytest.skip("Optional, git-ignored model files are not available.")
    labels = json.loads(config.LABELS_PATH.read_text(encoding="utf-8"))
    with TestClient(create_app(config)) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["model_loaded"] is True
        assert response.json()["num_classes"] == len(labels)
        assert "reason" not in response.json()
