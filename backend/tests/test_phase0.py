"""Phase 0 unit tests for sportsnap_lib foundation (db, vector_index, registry, embedder)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sportsnap_lib.config import LibrarySettings  # noqa: E402
from sportsnap_lib.db import init_db, set_image_label, utc_now_iso  # noqa: E402
from sportsnap_lib.embedder import FastEmbedClipEmbedder  # noqa: E402
from sportsnap_lib.registry import ensure_initial_version, get_active_version, promote_version  # noqa: E402
from sportsnap_lib.vector_index import FaissVectorIndex, NumpyVectorIndex, l2_normalize  # noqa: E402


def test_db_schema_and_human_label_precedence(tmp_path: Path) -> None:
    db_path = tmp_path / "library.db"
    conn = init_db(db_path)
    try:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        expected_tables = {
            "images",
            "predictions",
            "embeddings",
            "labels",
            "dup_groups",
            "dup_members",
            "model_versions",
            "jobs",
        }
        assert expected_tables.issubset(tables)

        now = utc_now_iso()
        cur = conn.execute(
            "INSERT INTO images (path, sha1, width, height, taken_at, added_at, thumb_path) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("a.jpg", "deadbeef", 224, 224, None, now, "thumbs/a.jpg"),
        )
        image_id = int(cur.lastrowid)
        conn.commit()

        set_image_label(conn, image_id, "golf", "model")
        row = conn.execute(
            "SELECT label, source FROM labels WHERE image_id = ?", (image_id,)
        ).fetchone()
        assert row["label"] == "golf" and row["source"] == "model"

        set_image_label(conn, image_id, "archery", "human")
        set_image_label(conn, image_id, "football", "model")  # must not overwrite human
        row = conn.execute(
            "SELECT label, source FROM labels WHERE image_id = ?", (image_id,)
        ).fetchone()
        assert row["label"] == "archery" and row["source"] == "human"
    finally:
        conn.close()


@pytest.mark.parametrize("index_cls", [NumpyVectorIndex, FaissVectorIndex])
def test_vector_index_add_search_filter_and_roundtrip(
    tmp_path: Path, index_cls: type[NumpyVectorIndex] | type[FaissVectorIndex]
) -> None:
    rng = np.random.default_rng(42)
    vecs = rng.normal(size=(5, 16)).astype(np.float32)
    ids = [10, 20, 30, 40, 50]

    idx = index_cls()
    idx.add(ids[:3], vecs[:3])
    idx.add(ids[3:], vecs[3:])
    assert idx.size == 5
    assert idx.dim == 16

    # Exact self-match
    hits = idx.search(vecs[2], k=3)
    assert hits[0][0] == 30
    assert hits[0][1] == pytest.approx(1.0, abs=1e-5)

    # Filter by allowed_ids
    filtered = idx.search(vecs[2], k=3, allowed_ids={10, 40})
    assert {img_id for img_id, _ in filtered} == {10, 40}

    # Persistence round-trip
    idx_dir = tmp_path / "index"
    idx.save(idx_dir)
    loaded = index_cls.load(idx_dir)
    assert loaded.size == 5
    assert loaded.dim == 16
    hits_loaded = loaded.search(vecs[2], k=3)
    assert hits_loaded[0][0] == 30
    assert hits_loaded[0][1] == pytest.approx(1.0, abs=1e-5)


def test_l2_normalize_unit_length() -> None:
    arr = np.array([[3.0, 4.0], [0.0, 0.0]], dtype=np.float32)
    normed = l2_normalize(arr)
    assert np.linalg.norm(normed[0]) == pytest.approx(1.0, abs=1e-6)
    assert np.all(normed[1] == 0.0)


def test_registry_initial_v1_and_promote_without_mutating_source(tmp_path: Path) -> None:
    src_model = tmp_path / "source_models" / "ResNet50_finetune_best.keras"
    src_labels = tmp_path / "source_models" / "labels.json"
    src_model.parent.mkdir(parents=True)
    src_model.write_bytes(b"fake-keras-bytes")
    src_labels.write_text(json.dumps(["archery", "boxing"]), encoding="utf-8")

    settings = LibrarySettings(
        project_root=tmp_path,
        data_dir=tmp_path / "data",
        db_path=tmp_path / "data" / "library.db",
        index_dir=tmp_path / "data" / "index",
        thumbs_dir=tmp_path / "data" / "thumbs",
        registry_dir=tmp_path / "data" / "models_registry",
        source_model_path=src_model,
        source_labels_path=src_labels,
    )
    conn = init_db(settings.db_path)
    try:
        v1 = ensure_initial_version(conn, settings)
        assert v1.version == "v1"
        assert v1.is_active is True
        assert v1.checkpoint_path.is_file()
        assert v1.checkpoint_path != src_model
        assert v1.preprocess == "resnet50"
        assert v1.backbone == "resnet50"

        # Add v2 and test promote / rollback
        v2_dir = settings.registry_dir / "v2"
        v2_dir.mkdir(parents=True)
        v2_ckpt = v2_dir / "model.keras"
        v2_ckpt.write_bytes(b"v2-bytes")
        conn.execute(
            """
            INSERT INTO model_versions (
                version, parent, created_at, train_set_hash, n_corrections_used,
                metrics_json, temperature, tau_high, tau_low,
                preprocess, backbone, checkpoint_path, labels_path, is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                "v2", "v1", utc_now_iso(), "abc", 5, json.dumps({"ext_top1": 0.7}),
                1.2, 0.8, 0.4, "resnet50", "resnet50", str(v2_ckpt), str(v1.labels_path),
            ),
        )
        conn.commit()
        promote_version(conn, "v2")
        assert get_active_version(conn).version == "v2"
        promote_version(conn, "v1")
        assert get_active_version(conn).version == "v1"
    finally:
        conn.close()


def test_embedder_interface_properties() -> None:
    emb = FastEmbedClipEmbedder()
    assert emb.model_name == "Qdrant/clip-ViT-B-32"
    assert emb.dim == 512
