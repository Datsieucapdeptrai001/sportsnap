from io import BytesIO
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from app.core.config import Settings
from app.main import create_app
from app.services.gradcam import explain_image
from app.services.inference import preprocess_image


def make_image_bytes(color: tuple[int, int, int] = (24, 120, 200)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (64, 64), color).save(buffer, format="JPEG")
    return buffer.getvalue()


def test_preprocess_none_preserves_0_to_255_float32() -> None:
    raw = make_image_bytes((100, 150, 200))
    batch = preprocess_image(raw, preprocess="none")
    assert batch.shape == (1, 224, 224, 3)
    assert batch.dtype == np.float32
    assert batch.min() >= 0.0
    assert batch.max() > 100.0


def test_gradcam_supports_flat_cnn_without_nested_backbone() -> None:
    import tensorflow as tf

    inputs = tf.keras.Input(shape=(224, 224, 3))
    x = tf.keras.layers.Rescaling(1.0 / 255)(inputs)
    x = tf.keras.layers.Conv2D(4, 3, activation="relu", name="last_conv")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    outputs = tf.keras.layers.Dense(2, activation="softmax")(x)
    model = tf.keras.Model(inputs, outputs)

    result = explain_image(make_image_bytes(), model, ["archery", "boxing"], 0.6, preprocess="none")
    assert result.explanation.label in {"archery", "boxing"}
    assert len(result.explanation.overlay_png_base64) > 20
    assert result.heatmap.ndim == 2


def test_models_list_select_and_compare(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "models").mkdir(parents=True)
    (tmp_path / "backend" / "models").mkdir(parents=True)
    (tmp_path / "frontend" / "dist").mkdir(parents=True)
    (tmp_path / "backend" / "data" / "insights").mkdir(parents=True)
    (tmp_path / "backend" / "data" / "experiments.json").write_text("{}", encoding="utf-8")

    new_labels = ["archery", "boxing"]
    old_labels = ["football", "golf"]
    (tmp_path / "models" / "labels.json").write_text(json.dumps(new_labels), encoding="utf-8")
    (tmp_path / "backend" / "models" / "labels.json").write_text(json.dumps(old_labels), encoding="utf-8")
    (tmp_path / "models" / "ResNet50_finetune_best.keras").write_bytes(b"resnet")
    (tmp_path / "models" / "cnn_scratch_best.keras").write_bytes(b"cnn")
    (tmp_path / "backend" / "models" / "best_model.keras").write_bytes(b"legacy")

    def fake_loader(path: Path) -> object:
        name = path.name
        if "ResNet50" in name:
            return SimpleNamespace(
                output_shape=(None, 2),
                predict=Mock(return_value=np.array([[0.9, 0.1]], dtype=np.float32)),
            )
        if "cnn_scratch" in name:
            return SimpleNamespace(
                output_shape=(None, 2),
                predict=Mock(return_value=np.array([[0.3, 0.7]], dtype=np.float32)),
            )
        return SimpleNamespace(
            output_shape=(None, 2),
            predict=Mock(return_value=np.array([[0.2, 0.8]], dtype=np.float32)),
        )

    monkeypatch.setattr("app.main.load_keras_model", fake_loader)
    settings = Settings(
        _env_file=None,
        BASE_DIR=tmp_path,
        MODEL_PATH=Path("models/ResNet50_finetune_best.keras"),
        LABELS_PATH=Path("models/labels.json"),
        PREPROCESS="resnet50",
    )

    with TestClient(create_app(settings)) as client:
        listed = client.get("/api/models")
        assert listed.status_code == 200
        payload = listed.json()
        assert payload["active_model_id"] == "resnet50_finetune"
        assert [m["id"] for m in payload["models"]] == [
            "resnet50_finetune",
            "cnn_scratch",
            "legacy_mobilenet_v2",
        ]

        selected = client.post("/api/models/select", json={"model_id": "legacy_mobilenet_v2"})
        assert selected.status_code == 200
        assert selected.json()["active_model_id"] == "legacy_mobilenet_v2"
        assert client.get("/api/health").json()["preprocess"] == "mobilenet_v2"
        assert client.get("/api/classes").json()["classes"] == old_labels

        compared = client.post(
            "/api/models/compare",
            files={"file": ("sample.jpg", make_image_bytes(), "image/jpeg")},
        )
        assert compared.status_code == 200
        items = {entry["id"]: entry["prediction"]["label"] for entry in compared.json()["results"]}
        assert items == {
            "resnet50_finetune": "archery",
            "cnn_scratch": "boxing",
            "legacy_mobilenet_v2": "golf",
        }
