"""Phase 0 CLIP Spike: benchmark fastembed (ONNX Runtime) vs open_clip (PyTorch CPU).

Measures model load time, image embedding latency (ms/image), text embedding latency
(ms/query), embedding dimension, L2 normalization check, and RAM delta on CPU.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
import psutil


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEST_DIR = PROJECT_ROOT / "datasets" / "sports-classification" / "test"

TEXT_QUERIES = [
    "a photo of archery",
    "a photo of baseball",
    "a photo of basketball",
    "a photo of boxing",
    "a photo of swimming",
    "a player celebrating a goal",
    "swimmer underwater",
    "crowd in a stadium",
    "race car on track",
    "athlete jumping over a bar",
]


def sample_images(test_dir: Path, limit: int = 20) -> list[Path]:
    paths: list[Path] = []
    for class_dir in sorted(test_dir.iterdir()):
        if not class_dir.is_dir():
            continue
        for img in sorted(class_dir.iterdir()):
            if img.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                paths.append(img)
                break
        if len(paths) >= limit:
            break
    return paths


def rss_mb() -> float:
    return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)


def bench_fastembed(images: list[Path], queries: list[str]) -> dict[str, object]:
    from fastembed import ImageEmbedding, TextEmbedding

    mem0 = rss_mb()
    t0 = time.perf_counter()
    img_model = ImageEmbedding(model_name="Qdrant/clip-ViT-B-32-vision")
    txt_model = TextEmbedding(model_name="Qdrant/clip-ViT-B-32-text")
    # Warmup (triggers ONNX session + first pass)
    _ = list(img_model.embed([str(images[0])]))
    _ = list(txt_model.embed([queries[0]]))
    load_sec = time.perf_counter() - t0

    t1 = time.perf_counter()
    img_vecs = np.asarray(list(img_model.embed([str(p) for p in images])), dtype=np.float32)
    img_ms = (time.perf_counter() - t1) / len(images) * 1000.0

    t2 = time.perf_counter()
    txt_vecs = np.asarray(list(txt_model.embed(queries)), dtype=np.float32)
    txt_ms = (time.perf_counter() - t2) / len(queries) * 1000.0

    mem1 = rss_mb()
    img_norms = np.linalg.norm(img_vecs, axis=1)
    txt_norms = np.linalg.norm(txt_vecs, axis=1)

    return {
        "backend": "fastembed",
        "models": ["Qdrant/clip-ViT-B-32-vision", "Qdrant/clip-ViT-B-32-text"],
        "dim": int(img_vecs.shape[1]),
        "num_images": len(images),
        "num_queries": len(queries),
        "load_and_warmup_sec": round(load_sec, 2),
        "ms_per_image": round(img_ms, 2),
        "ms_per_text": round(txt_ms, 2),
        "rss_delta_mb": round(mem1 - mem0, 1),
        "max_norm_err": float(max(np.max(np.abs(img_norms - 1.0)), np.max(np.abs(txt_norms - 1.0)))),
    }


def bench_open_clip(images: list[Path], queries: list[str]) -> dict[str, object]:
    import open_clip
    import torch
    from PIL import Image

    mem0 = rss_mb()
    t0 = time.perf_counter()
    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
    model.eval()
    tokenizer = open_clip.get_tokenizer("ViT-B-32")

    with torch.no_grad():
        with Image.open(images[0]) as im:
            _ = model.encode_image(preprocess(im.convert("RGB")).unsqueeze(0))
        _ = model.encode_text(tokenizer([queries[0]]))
    load_sec = time.perf_counter() - t0

    t1 = time.perf_counter()
    with torch.no_grad():
        tensors = []
        for p in images:
            with Image.open(p) as im:
                tensors.append(preprocess(im.convert("RGB")))
        batch = torch.stack(tensors, dim=0)
        feats = model.encode_image(batch)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        img_vecs = feats.cpu().numpy().astype(np.float32)
    img_ms = (time.perf_counter() - t1) / len(images) * 1000.0

    t2 = time.perf_counter()
    with torch.no_grad():
        toks = tokenizer(queries)
        tfeats = model.encode_text(toks)
        tfeats = tfeats / tfeats.norm(dim=-1, keepdim=True)
        txt_vecs = tfeats.cpu().numpy().astype(np.float32)
    txt_ms = (time.perf_counter() - t2) / len(queries) * 1000.0

    mem1 = rss_mb()
    img_norms = np.linalg.norm(img_vecs, axis=1)
    txt_norms = np.linalg.norm(txt_vecs, axis=1)

    return {
        "backend": "open_clip",
        "models": ["ViT-B-32 (laion2b_s34b_b79k)"],
        "dim": int(img_vecs.shape[1]),
        "num_images": len(images),
        "num_queries": len(queries),
        "load_and_warmup_sec": round(load_sec, 2),
        "ms_per_image": round(img_ms, 2),
        "ms_per_text": round(txt_ms, 2),
        "rss_delta_mb": round(mem1 - mem0, 1),
        "max_norm_err": float(max(np.max(np.abs(img_norms - 1.0)), np.max(np.abs(txt_norms - 1.0)))),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=["fastembed", "open_clip"], required=True)
    parser.add_argument("--test-dir", type=Path, default=DEFAULT_TEST_DIR)
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    images = sample_images(args.test_dir, limit=args.limit)
    if args.backend == "fastembed":
        res = bench_fastembed(images, TEXT_QUERIES)
    else:
        res = bench_open_clip(images, TEXT_QUERIES)
    print(json.dumps(res, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
