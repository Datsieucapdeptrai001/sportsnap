"""Unit tests for user corrections and confidence tiering."""

from io import BytesIO
import json
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from app.core.config import Settings
from app.main import create_app
from app.services.inference import get_confidence_tier, predict_image
from sportsnap_lib.db import init_db, list_corrections, record_correction, undo_correction


def make_dummy_jpeg() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (64, 64), (10, 80, 160)).save(buf, format="JPEG")
    return buf.getvalue()


def test_confidence_tiers() -> None:
    assert get_confidence_tier(0.95) == ("certain", "Chắc chắn")
    assert get_confidence_tier(0.75) == ("certain", "Chắc chắn")
    assert get_confidence_tier(0.74) == ("likely", "Có thể là…")
    assert get_confidence_tier(0.40) == ("likely", "Có thể là…")
    assert get_confidence_tier(0.39) == ("uncertain", "Chưa chắc")
    assert get_confidence_tier(0.10) == ("uncertain", "Chưa chắc")


def test_predict_image_confidence_tier_and_alternatives() -> None:
    mock_model = Mock()
    # 3 classes: 0.85 (certain), 0.10, 0.05
    mock_model.predict.return_value = np.array([[0.85, 0.10, 0.05]], dtype=np.float32)
    labels = ["archery", "boxing", "tennis"]

    pred = predict_image(make_dummy_jpeg(), mock_model, labels, threshold=0.60)
    assert pred.label == "archery"
    assert pred.confidence == pytest.approx(0.85)
    tier, tier_vi = get_confidence_tier(pred.confidence)
    assert tier == "certain"
    assert tier_vi == "Chắc chắn"
    alternatives = pred.top3[1:]
    assert len(alternatives) == 2
    assert alternatives[0].label == "boxing"
    assert alternatives[1].label == "tennis"


def test_corrections_db_and_undo(tmp_path: Path) -> None:
    db_file = tmp_path / "test_library.db"
    conn = init_db(db_file)

    corr_id = record_correction(
        conn=conn,
        image_sha1="abc123sha1",
        image_path="data/corrections/abc123sha1.jpg",
        previous_label="golf",
        predicted_label="golf",
        corrected_label="archery",
        confidence=0.55,
        model_id="legacy_mobilenet_v2",
    )
    assert corr_id > 0

    active = list_corrections(conn, include_undone=False)
    assert len(active) == 1
    assert active[0]["corrected_label"] == "archery"
    assert active[0]["undone_at"] is None

    # Undo by correction_id
    count, restored = undo_correction(conn, correction_id=corr_id)
    assert count == 1
    assert restored == "golf"

    # Should no longer be in active list
    assert len(list_corrections(conn, include_undone=False)) == 0
    # But in full list with undone_at set
    all_rows = list_corrections(conn, include_undone=True)
    assert len(all_rows) == 1
    assert all_rows[0]["undone_at"] is not None


def test_corrections_api_endpoints(tmp_path: Path) -> None:
    (tmp_path / "frontend" / "dist").mkdir(parents=True)
    (tmp_path / "backend" / "models").mkdir(parents=True)
    (tmp_path / "backend" / "data").mkdir(parents=True)
    (tmp_path / "backend" / "data" / "experiments.json").write_text("{}", encoding="utf-8")
    (tmp_path / "backend" / "models" / "labels.json").write_text(json.dumps(["archery", "boxing"]), encoding="utf-8")
    (tmp_path / "backend" / "models" / "best_model.keras").write_bytes(b"dummy_weights")

    settings = Settings(
        _env_file=None,
        BASE_DIR=tmp_path,
        MODEL_PATH=Path("backend/models/best_model.keras"),
        LABELS_PATH=Path("backend/models/labels.json"),
    )

    with patch("app.main.load_keras_model") as mock_load:
        mock_load.return_value = Mock(output_shape=(None, 2))
        app = create_app(settings)
        with TestClient(app) as client:
            # 1. Create correction
            payload = {
                "image_sha1": "testsha1xyz",
                "image_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
                "previous_label": "boxing",
                "predicted_label": "boxing",
                "corrected_label": "archery",
                "confidence": 0.42,
                "model_id": "legacy_mobilenet_v2",
            }
            create_resp = client.post("/api/corrections", json=payload)
            assert create_resp.status_code == 201
            data = create_resp.json()
            assert data["corrected_label"] == "archery"
            assert data["previous_label"] == "boxing"
            corr_id = data["id"]

            # 2. List corrections
            list_resp = client.get("/api/corrections")
            assert list_resp.status_code == 200
            items = list_resp.json()
            assert len(items) == 1
            assert items[0]["id"] == corr_id

            # 3. Undo correction
            undo_resp = client.post("/api/corrections/undo", json={"correction_id": corr_id})
            assert undo_resp.status_code == 200
            undo_data = undo_resp.json()
            assert undo_data["undone"] is True
            assert undo_data["restored_label"] == "boxing"

            # 4. List should now be empty
            assert len(client.get("/api/corrections").json()) == 0
