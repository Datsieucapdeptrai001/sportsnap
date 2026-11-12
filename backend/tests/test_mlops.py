"""Tests for Phase 3 calibration, model registry versioning, and incremental retraining."""

from __future__ import annotations

from pathlib import Path
import sys

import numpy as np
from PIL import Image
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sportsnap_lib.calibration import compute_ece, fit_temperature  # noqa: E402
from sportsnap_lib.config import LibrarySettings  # noqa: E402
from sportsnap_lib.db import init_db, set_image_label, utc_now_iso  # noqa: E402
from sportsnap_lib.registry import (  # noqa: E402
    get_active_version,
    list_versions,
    promote_version,
    register_version,
)
from sportsnap_lib.retrain import retrain_from_corrections  # noqa: E402


def test_temperature_scaling_reduces_overconfident_nll() -> None:
    # Overconfident logits-like probabilities (often wrong at 0.98)
    probs = np.array(
        [
            [0.98, 0.02],
            [0.98, 0.02],
            [0.02, 0.98],
            [0.95, 0.05],  # wrong
            [0.05, 0.95],  # wrong
        ],
        dtype=np.float32,
    )
    y_true = np.array([0, 0, 1, 1, 0], dtype=np.int64)
    report = fit_temperature(probs, y_true)
    assert report.temperature > 1.0
    assert report.nll_after <= report.nll_before
    assert report.ece_after < report.ece_before
    assert compute_ece(probs, y_true) == pytest.approx(report.ece_before, abs=1e-4)


def test_retrain_from_human_corrections_and_rollback(tmp_path: Path) -> None:
    import tensorflow as tf

    data_dir = tmp_path / "data"
    settings = LibrarySettings(
        project_root=tmp_path,
        data_dir=data_dir,
        db_path=data_dir / "library.db",
        index_dir=data_dir / "index",
        thumbs_dir=data_dir / "thumbs",
        registry_dir=data_dir / "models_registry",
        train_dir=tmp_path / "missing_train",
        valid_dir=tmp_path / "missing_valid",
        test_dir=tmp_path / "missing_test",
    )
    settings.ensure_dirs()

    # Tiny 2-class flat CNN model for fast CPU smoke test
    inputs = tf.keras.Input(shape=(224, 224, 3))
    x = tf.keras.layers.Rescaling(1.0 / 255)(inputs)
    x = tf.keras.layers.Conv2D(4, 3, activation="relu")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    outputs = tf.keras.layers.Dense(2, activation="softmax")(x)
    tiny_model = tf.keras.Model(inputs, outputs)

    v1_dir = settings.registry_dir / "v1"
    v1_dir.mkdir(parents=True, exist_ok=True)
    v1_ckpt = v1_dir / "tiny.keras"
    v1_lbls = v1_dir / "labels.json"
    tiny_model.save(v1_ckpt)
    v1_lbls.write_text('["archery", "boxing"]', encoding="utf-8")

    img1 = tmp_path / "c1.jpg"
    img2 = tmp_path / "c2.jpg"
    Image.new("RGB", (64, 64), (200, 10, 10)).save(img1)
    Image.new("RGB", (64, 64), (10, 10, 200)).save(img2)

    conn = init_db(settings.db_path)
    try:
        register_version(
            conn,
            version="v1",
            parent=None,
            train_set_hash=None,
            n_corrections_used=0,
            metrics={},
            temperature=1.0,
            tau_high=0.60,
            tau_low=0.35,
            preprocess="none",
            backbone="tiny",
            checkpoint_path=v1_ckpt,
            labels_path=v1_lbls,
            activate=True,
        )
        now = utc_now_iso()
        for idx, (path, lbl) in enumerate([(img1, "archery"), (img2, "boxing")], start=1):
            cur = conn.execute(
                "INSERT INTO images (path, sha1, width, height, taken_at, added_at, thumb_path) "
                "VALUES (?, ?, 64, 64, NULL, ?, ?)",
                (str(path), f"sha{idx}", now, str(path)),
            )
            set_image_label(conn, int(cur.lastrowid), lbl, "human")
        conn.commit()

        v2 = retrain_from_corrections(
            conn,
            settings,
            epochs=1,
            batch_size=2,
            replay_per_class=0,
            correction_repeat=1,
            activate=True,
        )
        assert v2.version == "v2"
        assert v2.parent == "v1"
        assert v2.n_corrections_used == 2
        assert v2.is_active is True
        assert v2.checkpoint_path.is_file()

        versions = list_versions(conn)
        assert [v.version for v in versions] == ["v2", "v1"]

        # Rollback back to v1
        rolled = promote_version(conn, "v1")
        assert rolled.version == "v1"
        assert get_active_version(conn).version == "v1"
    finally:
        conn.close()
