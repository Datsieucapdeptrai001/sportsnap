"""Unit tests for model verification, manifest validity, and dev mode gating."""

from io import BytesIO
import json
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from app.core.auth import is_dev_request, require_dev_token
from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from app.models_config import MODEL_MANIFESTS, get_manifest_by_id
from app.verify_models import get_cached_or_verify


def make_dummy_jpeg() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (64, 64), (10, 80, 160)).save(buf, format="JPEG")
    return buf.getvalue()


def test_manifests_integrity() -> None:
    assert len(MODEL_MANIFESTS) == 6
    manifest_ids = [m.id for m in MODEL_MANIFESTS]
    assert "legacy_mobilenet_v2" in manifest_ids
    assert "resnet50_finetune" in manifest_ids
    assert len(set(manifest_ids)) == len(manifest_ids)

    for m in MODEL_MANIFESTS:
        assert m.display_name.strip()
        assert m.preprocess in {"mobilenet_v2", "resnet50", "none"}
        assert m.temperature > 0
        assert 0.0 <= m.tau_low < m.tau_high <= 1.0


def test_cached_or_verify_reads_json_cache(tmp_path: Path) -> None:
    cache_file = tmp_path / "model_verification.json"
    dummy_payload = {
        "verified_at": "2026-11-13T00:00:00Z",
        "default_model_id": "legacy_mobilenet_v2",
        "models": [{"id": "legacy_mobilenet_v2", "status": "verified"}],
    }
    cache_file.write_text(json.dumps(dummy_payload), encoding="utf-8")

    with patch("app.verify_models.CACHE_PATH", cache_file):
        loaded = get_cached_or_verify()
        assert loaded["default_model_id"] == "legacy_mobilenet_v2"
        assert loaded["models"][0]["id"] == "legacy_mobilenet_v2"


def test_dev_token_auth_gating(tmp_path: Path) -> None:
    (tmp_path / "frontend" / "dist").mkdir(parents=True)
    (tmp_path / "backend" / "models").mkdir(parents=True)
    (tmp_path / "backend" / "data").mkdir(parents=True)
    (tmp_path / "backend" / "data" / "experiments.json").write_text("{}", encoding="utf-8")
    (tmp_path / "backend" / "models" / "labels.json").write_text(json.dumps(["golf", "tennis"]), encoding="utf-8")
    (tmp_path / "backend" / "models" / "best_model.keras").write_bytes(b"model")

    settings = Settings(
        _env_file=None,
        BASE_DIR=tmp_path,
        MODEL_PATH=Path("backend/models/best_model.keras"),
        LABELS_PATH=Path("backend/models/labels.json"),
        DEV_TOKEN="supersecret",
    )

    with patch("app.main.load_keras_model") as mock_load:
        mock_load.return_value = Mock(
            output_shape=(None, 2),
            predict=Mock(return_value=np.array([[0.8, 0.2]], dtype=np.float32)),
        )
        app = create_app(settings)
        with TestClient(app) as client:
            # 1. Dev verification endpoint requires valid X-Dev-Token
            unauth_resp = client.get("/api/models/verification")
            assert unauth_resp.status_code == 403

            auth_resp = client.get("/api/models/verification", headers={"X-Dev-Token": "supersecret"})
            assert auth_resp.status_code == 200

            # 2. Block model_id query parameter on /api/predict without dev token
            jpeg = make_dummy_jpeg()
            blocked_predict = client.post(
                "/api/predict?model_id=resnet50_finetune",
                files={"file": ("test.jpg", jpeg, "image/jpeg")},
            )
            assert blocked_predict.status_code == 403

            # 3. Block model_id query parameter on /api/scan without dev token
            blocked_scan = client.post(
                "/api/scan?model_id=resnet50_finetune",
                files=[
                    ("files", ("f1.jpg", jpeg, "image/jpeg")),
                    ("files", ("f2.jpg", jpeg, "image/jpeg")),
                ],
            )
            assert blocked_scan.status_code == 403

            # 4. Block model_id on bulk without dev token
            blocked_bulk = client.post(
                "/api/bulk?model_id=resnet50_finetune",
                files=[("files", ("img.jpg", jpeg, "image/jpeg"))],
            )
            assert blocked_bulk.status_code == 403
