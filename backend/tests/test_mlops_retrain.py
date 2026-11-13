"""Unit tests for Slice C MLOps retraining loop with single-model file retention."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image
import pytest

from sportsnap_lib.config import LibrarySettings
from sportsnap_lib.db import init_db, record_correction, set_image_label
from sportsnap_lib.registry import (
    ensure_initial_version,
    get_active_version,
    list_versions,
    promote_version,
)
from sportsnap_lib.retrain import retrain_from_corrections


def _make_dummy_image(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (224, 224), (50, 100, 150))
    img.save(path, format="JPEG")
    return path


def test_retrain_single_model_file_retention_and_metrics(tmp_path: Path) -> None:
    """Retraining must overwrite only retrained_best.keras without creating separate v2/v3 dirs."""
    data_dir = tmp_path / "data"
    registry_dir = data_dir / "models_registry"
    db_path = data_dir / "library.db"

    src_model = tmp_path / "models" / "ResNet50_finetune_best.keras"
    src_labels = tmp_path / "models" / "labels.json"
    src_model.parent.mkdir(parents=True)
    src_model.write_bytes(b"dummy_base_model")
    labels = ["archery", "boxing", "tennis"]
    src_labels.write_text(json.dumps(labels), encoding="utf-8")

    # Create dummy train dataset for replay
    train_dir = tmp_path / "datasets" / "sports-classification" / "train"
    for lbl in labels:
        _make_dummy_image(train_dir / lbl / "img1.jpg")
        _make_dummy_image(train_dir / lbl / "img2.jpg")

    valid_dir = tmp_path / "datasets" / "sports-classification" / "valid"
    for lbl in labels:
        _make_dummy_image(valid_dir / lbl / "v1.jpg")

    settings = LibrarySettings(
        project_root=tmp_path,
        data_dir=data_dir,
        db_path=db_path,
        index_dir=data_dir / "index",
        thumbs_dir=data_dir / "thumbs",
        registry_dir=registry_dir,
        source_model_path=src_model,
        source_labels_path=src_labels,
        train_dir=train_dir,
        valid_dir=valid_dir,
        test_dir=valid_dir,
    )
    conn = init_db(db_path)
    v1 = ensure_initial_version(conn, settings)
    assert v1.version == "v1"
    assert v1.is_active is True

    # 1. Add user correction from Scan page
    corr_img = _make_dummy_image(tmp_path / "data" / "corrections" / "scan1.jpg")
    record_correction(
        conn=conn,
        image_sha1="sha1_scan1",
        image_path=str(corr_img),
        previous_label="boxing",
        predicted_label="boxing",
        corrected_label="archery",
        confidence=0.52,
    )

    # 2. Add user correction from Library review
    lib_img = _make_dummy_image(tmp_path / "datasets" / "anh-ngoai" / "lib1.jpg")
    conn.execute(
        "INSERT INTO images (id, path, sha1, width, height, added_at, thumb_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, str(lib_img), "sha1_lib1", 224, 224, "2026-01-01", str(lib_img)),
    )
    set_image_label(conn, 1, "tennis", "human")

    # Mock tf.keras model fit and predict to avoid running full neural net weights in unit test
    mock_tf_model = Mock()
    mock_tf_model.layers = []
    # predict returns 3-class softmax probs
    mock_tf_model.predict.return_value = np.array(
        [[0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8]], dtype=np.float32
    )
    mock_history = Mock()
    mock_history.history = {"accuracy": [0.92]}
    mock_tf_model.fit.return_value = mock_history

    saved_paths: list[Path] = []

    def mock_save(dest_path: Path | str, *args, **kwargs) -> None:
        p = Path(dest_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"retrained_weights")
        saved_paths.append(p)

    mock_tf_model.save = mock_save

    with patch("tensorflow.keras.models.load_model", return_value=mock_tf_model):
        rec_v2 = retrain_from_corrections(
            conn=conn,
            settings=settings,
            epochs=2,
            replay_per_class=2,
            eval_per_class=1,
            activate=True,
        )

    # Check that retrained version is v2
    assert rec_v2.version == "v2"
    assert rec_v2.is_active is True
    assert rec_v2.n_corrections_used == 2

    # Verify quantitative metrics before and after are tracked
    assert "eval_accuracy_before" in rec_v2.metrics
    assert "eval_accuracy" in rec_v2.metrics
    assert "eval_macro_f1_before" in rec_v2.metrics
    assert "eval_macro_f1" in rec_v2.metrics

    # CRUCIAL USER CONSTRAINT:
    # Model file is strictly saved to single designated file retrained_best.keras
    expected_ckpt = registry_dir / "retrained_best.keras"
    assert rec_v2.checkpoint_path == expected_ckpt
    assert expected_ckpt.is_file()

    # Verify NO directory v2/ was created with extra .keras files
    v2_dir = registry_dir / "v2"
    assert not v2_dir.exists()

    # Verify corrections were marked used for training
    used_rows = conn.execute("SELECT is_used_for_training FROM corrections").fetchall()
    assert all(r["is_used_for_training"] == 1 for r in used_rows)

    # Check list_versions shows both v1 and v2
    versions = list_versions(conn)
    assert len(versions) == 2
    assert versions[0].version == "v2"
    assert versions[0].is_active is True
    assert versions[1].version == "v1"
    assert versions[1].is_active is False

    # Test Rollback to v1 (Base Model)
    rec_v1 = promote_version(conn, "v1")
    assert rec_v1.version == "v1"
    assert rec_v1.is_active is True
    active_now = get_active_version(conn)
    assert active_now is not None
    assert active_now.version == "v1"

    # Second retrain (v3) must also save to the SAME file retrained_best.keras
    with patch("tensorflow.keras.models.load_model", return_value=mock_tf_model):
        rec_v3 = retrain_from_corrections(
            conn=conn,
            settings=settings,
            epochs=1,
            replay_per_class=2,
            eval_per_class=1,
            activate=True,
        )
    assert rec_v3.version == "v3"
    assert rec_v3.checkpoint_path == expected_ckpt
    # Check still NO v3/ directory
    v3_dir = registry_dir / "v3"
    assert not v3_dir.exists()
    # Still only retrained_best.keras exists as the single retrained file
    assert (registry_dir / "retrained_best.keras").is_file()

