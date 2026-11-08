import base64
import json
import subprocess
import sys
from collections.abc import Iterator
from io import BytesIO
from pathlib import Path
from time import perf_counter

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from app.schemas import InsightsResponse
from app.services.gradcam import build_gradcam_graph, explain_image, jet_colors
from scripts.build_experiments import build_experiments, split_metrics


BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def real_client() -> Iterator[TestClient]:
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.get("/api/health").json()["model_loaded"]
        yield client


def test_explain_golden_top1_uncertainty_and_native_heatmap(real_client: TestClient) -> None:
    expected = json.loads((BACKEND / "tests/golden/expected.json").read_text())
    latencies: list[float] = []
    nonzero_maps = 0
    for entry in expected:
        data = (BACKEND / "tests/golden" / entry["file"]).read_bytes()
        files = {"file": (entry["file"], data, "image/png")}
        prediction = real_client.post("/api/predict", files=files).json()
        started = perf_counter()
        response = real_client.post("/api/explain", files=files)
        latencies.append((perf_counter() - started) * 1000)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["label"] == prediction["label"] == entry["label"]
        assert result["confidence"] == prediction["confidence"]
        assert result["top3"] == prediction["top3"]
        assert result["is_uncertain"] == prediction["is_uncertain"]
        assert result["is_uncertain"] == (result["confidence"] < result["threshold"])
        assert len(result["overlay_png_base64"]) < 1_000_000
        with Image.open(BytesIO(base64.b64decode(result["overlay_png_base64"], validate=True))) as overlay:
            assert overlay.format == "PNG" and overlay.size == (224, 224)
        with real_client.app.state.model_lock:
            heatmap = explain_image(data, real_client.app.state.model, real_client.app.state.labels, 0.6).heatmap
        assert heatmap.shape == (7, 7)
        assert heatmap.dtype == np.float32
        assert np.isfinite(heatmap).all() and heatmap.min() >= 0 and heatmap.max() <= 1
        nonzero_maps += int(heatmap.max() > 0)
    assert nonzero_maps > 0
    print(f"CPU /api/explain golden wall ms: cold={latencies[0]:.1f}, warm_mean={np.mean(latencies[1:]):.1f}, all={latencies}")


def test_overlay_aspect_orientation_and_size_bound(real_client: TestClient) -> None:
    buffer = BytesIO()
    image = Image.fromarray(np.random.default_rng(0).integers(0, 256, (600, 900, 3), dtype=np.uint8))
    exif = Image.Exif()
    exif[274] = 6
    image.save(buffer, format="PNG", exif=exif)
    response = real_client.post("/api/gradcam", files={"file": ("rotated.png", buffer.getvalue(), "image/png")})
    assert response.status_code == 200
    encoded = response.json()["overlay_png_base64"]
    assert len(encoded) < 1_000_000
    with Image.open(BytesIO(base64.b64decode(encoded))) as overlay:
        assert overlay.height == 448 and abs(overlay.width / overlay.height - 600 / 900) < 0.003


@pytest.mark.parametrize("filename,data,mime,status,code", [
    ("bad.txt", b"text", "text/plain", 415, "unsupported_format"),
    ("bad.png", b"not an image", "image/png", 422, "invalid_image"),
    ("large.png", b"x" * (12 * 1024 * 1024 + 1), "image/png", 413, "file_too_large"),
])
def test_explain_rejects_uploads(
    real_client: TestClient, filename: str, data: bytes, mime: str, status: int, code: str,
) -> None:
    response = real_client.post("/api/explain", files={"file": (filename, data, mime)})
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_explain_missing_model_and_file(tmp_path: Path) -> None:
    with TestClient(create_app(Settings(BASE_DIR=tmp_path, _env_file=None))) as client:
        assert client.post("/api/explain").status_code == 400
        response = client.post("/api/explain", files={"file": ("image.png", b"x", "image/png")})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "model_not_loaded"


def test_gradcam_fallback_zero_map_and_unsupported(image_bytes: bytes) -> None:
    import tensorflow as tf

    inputs = tf.keras.Input((224, 224, 3))
    conv = tf.keras.layers.Conv2D(2, 1, kernel_initializer="zeros")(inputs)
    tail = tf.keras.layers.ReLU()(conv)
    base = tf.keras.Model(inputs, tail)
    outer_input = tf.keras.Input((224, 224, 3))
    outputs = tf.keras.layers.Dense(2, activation="softmax")(
        tf.keras.layers.GlobalAveragePooling2D()(base(outer_input))
    )
    model = tf.keras.Model(outer_input, outputs)
    result = explain_image(image_bytes, model, ["a", "b"], 0.6)
    assert result.heatmap.shape == (224, 224)
    assert np.count_nonzero(result.heatmap) == 0
    assert result.explanation.label == "a" and result.explanation.is_uncertain
    assert np.all(jet_colors(np.array([0, 0.5, 1], dtype=np.float32)) == [[0, 0, 127], [127, 255, 127], [127, 0, 0]])
    with pytest.raises(APIError) as error:
        build_gradcam_graph(tf.keras.Model(inputs, tf.keras.layers.GlobalAveragePooling2D()(inputs)))
    assert error.value.status_code == 501 and error.value.body.error.code == "gradcam_unsupported"


def test_explain_holds_shared_lock_off_event_loop(
    inference_client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio
    from types import SimpleNamespace

    def operation(*args: object) -> object:
        assert inference_client.app.state.model_lock.locked()
        with pytest.raises(RuntimeError):
            asyncio.get_running_loop()
        return SimpleNamespace(explanation={
            "label": "a", "confidence": 0.5, "top3": [{"label": "a", "confidence": 0.5}],
            "is_uncertain": True, "threshold": 0.6, "latency_ms": 1, "overlay_png_base64": "a",
        })

    monkeypatch.setattr("app.api.insights.explain_image", operation)
    assert inference_client.post("/api/explain", files={"file": ("a.png", image_bytes, "image/png")}).status_code == 200


def test_insights_schema_sources_and_files(real_client: TestClient) -> None:
    response = real_client.get("/api/insights")
    assert response.status_code == 200
    expected = json.loads((BACKEND / "data/experiments.json").read_text(encoding="utf-8"))
    assert response.json() == expected
    data = InsightsResponse.model_validate(response.json())
    assert {model.name for model in data.models} == {"CNN_Scratch", "MobileNetV2", "ResNet50"}
    assert data.selected_model == "MobileNetV2"
    assert all(model.latency_ms is None and model.params_m is None and model.size_mb is None for model in data.models)
    assert real_client.get("/api/insights/files/cm.png").headers["content-type"] == "image/png"
    for name in ("%2e%2e%2fexperiments.json", "%2e%2e%5csummary.csv", "missing.png"):
        response = real_client.get(f"/api/insights/files/{name}")
        assert response.status_code == 404


def test_experiments_rebuild_is_byte_reproducible(tmp_path: Path) -> None:
    subprocess.run([
        sys.executable, str(BACKEND / "scripts/build_experiments.py"), "--output", str(tmp_path / "experiments.json"),
    ], check=True)
    assert (tmp_path / "experiments.json").read_bytes() == (BACKEND / "data/experiments.json").read_bytes()
    # PNG compression/encoding can differ between Windows and Linux Pillow/zlib
    # builds even when decoded pixels match. Compare image content, not PNG bytes.
    with Image.open(tmp_path / "insights/cm.png") as actual, Image.open(BACKEND / "data/insights/cm.png") as expected:
        assert actual.size == expected.size
        assert actual.mode == expected.mode == "RGB"
        actual_pixels = np.asarray(actual, dtype=np.int16)
        expected_pixels = np.asarray(expected, dtype=np.int16)
        mean_abs_diff = float(np.abs(actual_pixels - expected_pixels).mean())
        # Allow less than one intensity level out of 255 on average for minor
        # font/antialiasing differences, while keeping the matrix fills exact.
        assert mean_abs_diff < 1.0, f"Confusion matrix pixel MAE {mean_abs_diff:.4f} must be < 1.0 on the 0-255 scale."
        data = json.loads((tmp_path / "experiments.json").read_text(encoding="utf-8"))
        matrix = next(split["confusion_matrix"] for split in data["splits"] if split["split"] == "test")
        cell_width, cell_height = actual.width // len(matrix), actual.height // len(matrix)
        # Sample the lower-right background of every cell, away from its count.
        # This catches a changed matrix cell even if whole-image MAE stays small.
        assert np.array_equal(
            actual_pixels[cell_height - 2::cell_height, cell_width - 2::cell_width],
            expected_pixels[cell_height - 2::cell_height, cell_width - 2::cell_width],
        )


def test_macro_f1_confusion_math_and_attribution(tmp_path: Path) -> None:
    rows = [{"thuc_te": "a", "du_doan": "a"}, {"thuc_te": "a", "du_doan": "b"}]
    result = split_metrics(rows, ["a", "b"], "test")
    assert result["confusion_matrix"] == [[1, 1], [0, 0]]
    assert result["accuracy"] == 0.5 and result["macro_f1"] == pytest.approx(1 / 3)
    assert result["top_confusions"] == [{"true": "a", "pred": "b", "count": 1}]
    summary = tmp_path / "summary.csv"
    summary.write_text("Mô hình,Test Accuracy,Val Accuracy\nMobileNetV2,0.9,1\nResNet50,1,1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="ambiguous"):
        build_experiments(summary, BACKEND / "data/ket_qua_du_doan_tat_ca_anh.csv", BACKEND / "models/labels.json")
