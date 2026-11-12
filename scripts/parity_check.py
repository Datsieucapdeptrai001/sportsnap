"""Phase 0 Parity & CPU Inference Benchmark for SportSnap (ResNet50 / MobileNetV2).

Verifies that the backend serving preprocessing (`preprocess_image`) reproduces
expected accuracy (>= 0.96) on the 100 official test images, and measures CPU
latency across eager batch-1, @tf.function batch-1, and @tf.function batch-32.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from pathlib import Path

import numpy as np
import tensorflow as tf

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.inference import preprocess_image  # noqa: E402


VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def collect_images(test_dir: Path, labels: list[str]) -> tuple[list[Path], list[int]]:
    paths: list[Path] = []
    targets: list[int] = []
    for idx, label in enumerate(labels):
        class_dir = test_dir / label
        if not class_dir.is_dir():
            raise FileNotFoundError(f"Missing test class directory: {class_dir}")
        for img_path in sorted(class_dir.iterdir()):
            if img_path.is_file() and img_path.suffix.lower() in VALID_EXTS:
                paths.append(img_path)
                targets.append(idx)
    return paths, targets


def run_parity_and_benchmark(
    model_path: Path,
    labels_path: Path,
    test_dir: Path,
    preprocess: str,
    batch_size: int = 32,
) -> dict[str, object]:
    labels: list[str] = json.loads(labels_path.read_text(encoding="utf-8"))
    paths, targets = collect_images(test_dir, labels)
    if not paths:
        raise RuntimeError(f"No images found in {test_dir}")

    t_load0 = time.perf_counter()
    model = tf.keras.models.load_model(model_path, compile=False)
    load_sec = time.perf_counter() - t_load0

    if tuple(model.input_shape[1:]) != (224, 224, 3):
        raise ValueError(f"Unexpected input_shape: {model.input_shape}")
    if int(model.output_shape[-1]) != len(labels):
        raise ValueError(
            f"Output dim {model.output_shape[-1]} != num labels {len(labels)}"
        )

    # 1. Preprocess using exact backend serving path
    batches = [
        preprocess_image(p.read_bytes(), preprocess=preprocess) for p in paths
    ]
    x_all = np.concatenate(batches, axis=0).astype(np.float32)

    # 2. Parity evaluation via model.predict (serving path)
    preds_eager = model.predict(x_all, batch_size=batch_size, verbose=0)
    pred_ids = np.argmax(preds_eager, axis=1)
    correct = int(np.sum(pred_ids == np.array(targets)))
    accuracy = correct / len(targets)

    # 3. CPU latency benchmark: eager batch-1 vs @tf.function batch-1 vs @tf.function batch-32
    @tf.function(input_signature=[tf.TensorSpec(shape=[None, 224, 224, 3], dtype=tf.float32)])
    def fast_infer(x: tf.Tensor) -> tf.Tensor:
        return model(x, training=False)

    # Warmup
    _ = model.predict(x_all[:1], verbose=0)
    _ = fast_infer(tf.constant(x_all[:1])).numpy()
    _ = fast_infer(tf.constant(x_all[:batch_size])).numpy()

    # Eager predict batch-1 (20 iterations)
    n_b1 = 20
    t0 = time.perf_counter()
    for i in range(n_b1):
        _ = model.predict(x_all[i : i + 1], verbose=0)
    eager_b1_ms = (time.perf_counter() - t0) / n_b1 * 1000.0

    # @tf.function batch-1 (20 iterations)
    t0 = time.perf_counter()
    for i in range(n_b1):
        _ = fast_infer(tf.constant(x_all[i : i + 1])).numpy()
    tf_fn_b1_ms = (time.perf_counter() - t0) / n_b1 * 1000.0

    # @tf.function batched over all 100 images
    t0 = time.perf_counter()
    out_chunks = []
    for start in range(0, len(x_all), batch_size):
        chunk = tf.constant(x_all[start : start + batch_size])
        out_chunks.append(fast_infer(chunk).numpy())
    preds_fast = np.concatenate(out_chunks, axis=0)
    tf_fn_batch_ms_per_img = (time.perf_counter() - t0) / len(x_all) * 1000.0
    max_diff = float(np.max(np.abs(preds_eager - preds_fast)))

    return {
        "cpu": platform.processor(),
        "cpu_count": os.cpu_count(),
        "tf_version": tf.__version__,
        "model_path": str(model_path),
        "preprocess": preprocess,
        "num_images": len(paths),
        "correct": correct,
        "accuracy": accuracy,
        "load_seconds": round(load_sec, 3),
        "eager_batch1_ms_per_img": round(eager_b1_ms, 2),
        "tf_function_batch1_ms_per_img": round(tf_fn_b1_ms, 2),
        f"tf_function_batch{batch_size}_ms_per_img": round(tf_fn_batch_ms_per_img, 2),
        "max_prob_diff_eager_vs_tffn": max_diff,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        type=Path,
        default=PROJECT_ROOT / "models" / "ResNet50_finetune_best.keras",
    )
    parser.add_argument(
        "--labels",
        type=Path,
        default=PROJECT_ROOT / "models" / "labels.json",
    )
    parser.add_argument(
        "--test-dir",
        type=Path,
        default=PROJECT_ROOT / "datasets" / "sports-classification" / "test",
    )
    parser.add_argument("--preprocess", default="resnet50")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    result = run_parity_and_benchmark(
        model_path=args.model,
        labels_path=args.labels,
        test_dir=args.test_dir,
        preprocess=args.preprocess,
        batch_size=args.batch_size,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if float(result["accuracy"]) < 0.96:
        raise SystemExit(
            f"PARITY GATE FAILED: accuracy {result['accuracy']:.4f} < 0.96"
        )


if __name__ == "__main__":
    main()
