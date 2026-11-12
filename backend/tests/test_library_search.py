"""Tests for Phase 1 ingestion pipeline, Vietnamese query expansion, and hybrid CLIP search."""

from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sportsnap_lib.config import LibrarySettings  # noqa: E402
from sportsnap_lib.db import init_db  # noqa: E402
from sportsnap_lib.embedder import Embedder  # noqa: E402
from sportsnap_lib.ingest import ingest_directory  # noqa: E402
from sportsnap_lib.registry import register_version  # noqa: E402
from sportsnap_lib.search import (  # noqa: E402
    browse_images,
    expand_vietnamese_query,
    search_by_text,
    search_similar_images,
)
from sportsnap_lib.vector_index import NumpyVectorIndex, l2_normalize  # noqa: E402


class DummyClipEmbedder(Embedder):
    """Deterministic color-channel-based embedder for fast unit testing."""

    @property
    def model_name(self) -> str:
        return "dummy-clip"

    @property
    def dim(self) -> int:
        return 3

    def embed_images(self, images):
        vecs = []
        for item in images:
            im = Image.open(item).convert("RGB") if not isinstance(item, Image.Image) else item.convert("RGB")
            arr = np.asarray(im, dtype=np.float32)
            mean_rgb = arr.mean(axis=(0, 1)) + 1e-3
            vecs.append(mean_rgb)
        return l2_normalize(np.stack(vecs, axis=0))

    def embed_texts(self, texts):
        vecs = []
        for text in texts:
            low = text.lower()
            if "archery" in low or "bắn cung" in low:
                vecs.append([1.0, 0.05, 0.05])
            elif "swimming" in low or "bơi" in low:
                vecs.append([0.05, 0.05, 1.0])
            else:
                vecs.append([0.05, 1.0, 0.05])
        return l2_normalize(np.asarray(vecs, dtype=np.float32))


def test_vietnamese_query_expansion() -> None:
    expanded = expand_vietnamese_query("bắn cung ngoài trời")
    assert "archery" in expanded
    assert "outdoor" in expanded
    assert expand_vietnamese_query("tennis match") == "tennis match"


def test_ingest_idempotency_and_hybrid_search(tmp_path: Path) -> None:
    img_dir = tmp_path / "imgs"
    img_dir.mkdir()
    Image.new("RGB", (128, 128), (240, 20, 20)).save(img_dir / "archery_red.jpg")
    Image.new("RGB", (128, 128), (20, 20, 240)).save(img_dir / "swim_blue.jpg")
    Image.new("RGB", (128, 128), (20, 240, 20)).save(img_dir / "golf_green.jpg")

    data_dir = tmp_path / "data"
    settings = LibrarySettings(
        project_root=tmp_path,
        data_dir=data_dir,
        db_path=data_dir / "library.db",
        index_dir=data_dir / "index",
        thumbs_dir=data_dir / "thumbs",
        registry_dir=data_dir / "models_registry",
    )
    settings.ensure_dirs()
    ckpt = settings.registry_dir / "v1" / "dummy.keras"
    ckpt.parent.mkdir(parents=True, exist_ok=True)
    ckpt.write_bytes(b"x")
    lbls = settings.registry_dir / "v1" / "labels.json"
    lbls.write_text('["archery", "golf", "swimming"]', encoding="utf-8")

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
            backbone="dummy",
            checkpoint_path=ckpt,
            labels_path=lbls,
            activate=True,
        )

        # Model assigns archery=0.90, golf=0.50 (review), swimming=0.25 (unknown)
        def fake_predict(batch, verbose=0):
            out = []
            for row in batch:
                mean = row.mean(axis=(0, 1))
                if mean[0] > mean[1] and mean[0] > mean[2]:
                    out.append([0.90, 0.05, 0.05])
                elif mean[1] > mean[2]:
                    out.append([0.25, 0.50, 0.25])
                else:
                    out.append([0.35, 0.30, 0.35])
            return np.asarray(out, dtype=np.float32)

        dummy_model = SimpleNamespace(predict=Mock(side_effect=fake_predict))
        embedder = DummyClipEmbedder()
        vec_index = NumpyVectorIndex()

        first = ingest_directory(
            img_dir,
            conn,
            settings,
            model=dummy_model,
            labels=["archery", "golf", "swimming"],
            preprocess="none",
            embedder=embedder,
            index=vec_index,
        )
        assert first.total_scanned == 3
        assert first.newly_indexed == 3
        assert first.skipped_existing == 0

        # Re-ingesting the same folder must skip existing SHA-1s
        second = ingest_directory(
            img_dir,
            conn,
            settings,
            model=dummy_model,
            labels=["archery", "golf", "swimming"],
            preprocess="none",
            embedder=embedder,
            index=vec_index,
        )
        assert second.newly_indexed == 0
        assert second.skipped_existing == 3

        # Text search in Vietnamese
        hits, exp = search_by_text(conn, vec_index, embedder, "bắn cung", k=3)
        assert "archery" in exp
        assert Path(hits[0].path).name == "archery_red.jpg"

        # Hybrid filter restricts results to review status
        filtered, _ = search_by_text(conn, vec_index, embedder, "bắn cung", k=3, status="review")
        assert len(filtered) == 1
        assert Path(filtered[0].path).name == "golf_green.jpg"

        # Image similarity excludes self
        sim_hits = search_similar_images(conn, vec_index, embedder, image_id=hits[0].image_id, k=5)
        assert all(item.image_id != hits[0].image_id for item in sim_hits)

        all_items, total = browse_images(conn)
        assert total == 3
        assert len(all_items) == 3
    finally:
        conn.close()
