"""Evaluate CLIP semantic text-to-image and image-to-image retrieval metrics (Recall@K, mAP@10)."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from time import perf_counter
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sportsnap_lib.config import LibrarySettings  # noqa: E402
from sportsnap_lib.embedder import FastEmbedClipEmbedder  # noqa: E402
from sportsnap_lib.ingest import iter_image_files  # noqa: E402
from sportsnap_lib.vector_index import NumpyVectorIndex  # noqa: E402


def average_precision_at_k(relevant: list[bool], k: int = 10) -> float:
    hits = 0
    score = 0.0
    for rank, rel in enumerate(relevant[:k], start=1):
        if rel:
            hits += 1
            score += hits / rank
    total_rel = sum(relevant)
    denom = min(total_rel, k)
    return score / denom if denom > 0 else 0.0


def evaluate_dataset(root: Path, embedder: FastEmbedClipEmbedder) -> dict[str, object]:
    files = iter_image_files(root)
    labels = [p.parent.name for p in files]
    ids = list(range(1, len(files) + 1))

    t0 = perf_counter()
    vecs = embedder.embed_images(files)
    index_seconds = perf_counter() - t0

    index = NumpyVectorIndex(vectors=vecs, ids=ids)
    id_to_label = dict(zip(ids, labels))
    unique_labels = sorted(set(labels))

    # 1. Text-to-image retrieval: one natural-language prompt per sport
    prompts = [f"a sports photo of {lbl}" for lbl in unique_labels]
    t1 = perf_counter()
    prompt_vecs = embedder.embed_texts(prompts)
    text_r1, text_r5, text_map10 = [], [], []
    for lbl, q_vec in zip(unique_labels, prompt_vecs):
        hits = index.search(q_vec, k=10)
        rels = [id_to_label[img_id] == lbl for img_id, _ in hits]
        text_r1.append(float(any(rels[:1])))
        text_r5.append(float(any(rels[:5])))
        text_map10.append(average_precision_at_k(rels, k=10))
    text_ms = (perf_counter() - t1) * 1000.0 / max(len(unique_labels), 1)

    # 2. Image-to-image retrieval: query each image against remaining images
    t2 = perf_counter()
    img_r1, img_r5, img_map10 = [], [], []
    for img_id, lbl in zip(ids, labels):
        q_vec = index.get_vector(img_id)
        assert q_vec is not None
        hits = [(hid, s) for hid, s in index.search(q_vec, k=11) if hid != img_id][:10]
        rels = [id_to_label[hid] == lbl for hid, _ in hits]
        img_r1.append(float(any(rels[:1])))
        img_r5.append(float(any(rels[:5])))
        img_map10.append(average_precision_at_k(rels, k=10))
    img_ms = (perf_counter() - t2) * 1000.0 / max(len(ids), 1)

    return {
        "dataset": str(root.relative_to(PROJECT_ROOT)),
        "num_images": len(files),
        "num_classes": len(unique_labels),
        "embed_seconds": round(index_seconds, 2),
        "text_to_image": {
            "recall_at_1": round(float(np.mean(text_r1)), 4),
            "recall_at_5": round(float(np.mean(text_r5)), 4),
            "map_at_10": round(float(np.mean(text_map10)), 4),
            "avg_query_ms": round(text_ms, 2),
        },
        "image_to_image": {
            "recall_at_1": round(float(np.mean(img_r1)), 4),
            "recall_at_5": round(float(np.mean(img_r5)), 4),
            "map_at_10": round(float(np.mean(img_map10)), 4),
            "avg_query_ms": round(img_ms, 2),
        },
    }


def main() -> None:
    settings = LibrarySettings()
    settings.ensure_dirs()
    embedder = FastEmbedClipEmbedder()
    results = []
    for target in (settings.test_dir, settings.external_dir):
        if target.is_dir():
            results.append(evaluate_dataset(target, embedder))
    out_path = settings.data_dir / "eval_search.json"
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
