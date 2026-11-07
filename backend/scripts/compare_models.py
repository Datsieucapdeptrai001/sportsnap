"""Read-only model diagnostics; CSV artifacts never modify app/model files.

Example (from the repository root):
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\compare_models.py \
        --test-dir backend/debug_frames/model_compare/test_data

V1 calls the backend preprocessing verbatim. ResNet50 recovers its integer RGB
pixels before applying ResNet50's own normalization. V2 deliberately uses Keras'
default nearest resize, including its EXIF behavior, to reproduce load_img.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from collections import defaultdict
from datetime import datetime
from io import BytesIO
from pathlib import Path
import sys
from typing import Any, Sequence

import numpy as np
from numpy.typing import NDArray


BACKEND = Path(__file__).resolve().parents[1]
DOWNLOADS = Path(r"C:\Users\Admin\Downloads\all_sportsnap_outputs")
EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp"})
VARIANTS = ("V1", "V2", "V3", "V4")
sys.path.insert(0, str(BACKEND))

from app.services.inference import preprocess_image


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-model", type=Path, default=BACKEND / "models/best_model.keras")
    parser.add_argument("--backend-labels", type=Path, default=BACKEND / "models/labels.json")
    parser.add_argument("--notebook-model", type=Path, default=DOWNLOADS / "sportsnap_model/sportsnap_best_model.keras")
    parser.add_argument("--notebook-labels", type=Path, default=DOWNLOADS / "sportsnap_model/class_names.json")
    parser.add_argument("--mobilenet-model", type=Path, default=DOWNLOADS / "MobileNetV2_finetune_best.keras")
    parser.add_argument("--resnet-model", type=Path, default=DOWNLOADS / "ResNet50_finetune_best.keras")
    parser.add_argument("--downloads-dir", type=Path, default=DOWNLOADS, help="Also hash every .keras file below this directory")
    parser.add_argument("--camera-dir", type=Path, default=BACKEND / "debug_frames/cam_compare/88f9565483934f6fb6d533f0120d85e7")
    parser.add_argument("--test-dir", type=Path, help="Held-out images in <label>/<image> folders; required for accuracy")
    parser.add_argument("--output-dir", type=Path, default=BACKEND / "debug_frames/model_compare")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.batch_size < 1 or args.threads < 1:
        parser.error("--batch-size and --threads must be positive")
    return args


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def save_csv(path: Path, rows: Sequence[dict[str, Any]], columns: Sequence[str]) -> None:
    with path.open("x", encoding="utf-8-sig", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def read_labels(path: Path) -> list[str]:
    labels = json.loads(path.read_text(encoding="utf-8-sig"))
    if (not isinstance(labels, list) or not labels
            or any(not isinstance(label, str) or not label.strip() for label in labels)
            or len(set(labels)) != len(labels)):
        raise ValueError(f"Expected a non-empty list of unique, non-empty labels: {path}")
    return labels


def hash_models(paths: Sequence[Path], directory: Path, output: Path) -> dict[Path, str]:
    paths = sorted({p.resolve() for p in [*paths, *directory.rglob("*.keras")]}, key=str)
    rows: list[dict[str, Any]] = []
    hashes: dict[Path, str] = {}
    groups: dict[str, list[str]] = defaultdict(list)
    print("\nSTEP 1: model hashes\nBytes | SHA256 | File", flush=True)
    for path in paths:
        row: dict[str, Any] = {"file": str(path), "bytes": "", "sha256": "", "error": ""}
        try:
            row.update(bytes=path.stat().st_size, sha256=digest(path))
            hashes[path] = row["sha256"]
            groups[row["sha256"]].append(str(path))
            print(f"{row['bytes']} | {row['sha256']} | {path}", flush=True)
        except OSError as exc:
            row["error"] = str(exc)
            print(f"UNAVAILABLE | {path} | {exc}", flush=True)
        rows.append(row)
    for checksum, files in groups.items():
        if len(files) > 1:
            print(f"IDENTICAL SHA256 {checksum}:\n  " + "\n  ".join(files), flush=True)
    save_csv(output / "hashes.csv", rows, ("file", "bytes", "sha256", "error"))
    return hashes


def compare_labels(backend: list[str], notebook: list[str], output: Path) -> None:
    print(f"\nSTEP 2: labels: backend={len(backend)}, notebook={len(notebook)}; "
          f"same_length={len(backend) == len(notebook)}; same_order={backend == notebook}", flush=True)
    rows = []
    for index in range(max(len(backend), len(notebook))):
        left = backend[index] if index < len(backend) else None
        right = notebook[index] if index < len(notebook) else None
        rows.append({"index": index, "backend": left, "notebook": right, "equal": left == right})
        if left != right:
            print(f"  index={index}: backend={left!r}, notebook={right!r}", flush=True)
    save_csv(output / "labels.csv", rows, ("index", "backend", "notebook", "equal"))


def inspect_layers(model: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    preprocess: list[dict[str, Any]] = []
    opaque: list[dict[str, Any]] = []
    seen: set[int] = set()

    def visit(container: Any, prefix: str) -> None:
        for layer in getattr(container, "layers", []):
            if id(layer) in seen:
                continue
            seen.add(id(layer))
            name = f"{prefix}/{layer.name}"
            kind = type(layer).__name__
            if (kind in {"Rescaling", "Normalization", "Resizing", "CenterCrop"}
                    or "preprocess" in layer.name.lower()):
                preprocess.append({"path": name, "class": kind, "config": layer.get_config()})
            elif kind in {"Lambda", "TFOpLambda", "SlicingOpLambda"}:
                opaque.append({"path": name, "class": kind, "config": layer.get_config()})
            visit(layer, name)

    visit(model, model.name)
    return preprocess, opaque


def image_paths(directory: Path) -> list[Path]:
    if not directory.is_dir():
        raise ValueError(f"Image directory not found: {directory}")
    return sorted((p for p in directory.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS), key=str)


def collect_images(args: argparse.Namespace, labels: list[str]) -> list[dict[str, str]]:
    records = [{"dataset": "camera", "file": str(p.resolve()), "true_label": ""}
               for p in image_paths(args.camera_dir)]
    if not records:
        raise ValueError("No saved camera images found")
    if args.test_dir is None:
        print("TEST NOT RUN: supply --test-dir <label>/<image>; no accuracy is inferred.", flush=True)
        return records
    test = image_paths(args.test_dir)
    if not test:
        raise ValueError("No test images found")
    unknown = sorted({p.relative_to(args.test_dir).parts[0] for p in test
                      if len(p.relative_to(args.test_dir).parts) < 2
                      or p.relative_to(args.test_dir).parts[0] not in labels})
    if unknown:
        raise ValueError(f"Test folders must match model labels exactly; unknown entries: {unknown}")
    counts = dict.fromkeys(labels, 0)
    for path in test:
        label = path.relative_to(args.test_dir).parts[0]
        counts[label] += 1
        records.append({"dataset": "test", "file": str(path.resolve()), "true_label": label})
    print(f"Test set: {len(test)} images; per-label counts: {json.dumps(counts)}", flush=True)
    if any(count == 0 for count in counts.values()):
        raise ValueError("Test set is missing one or more model classes; provide the complete test directory")
    return records


def prepared_inputs(data: bytes, normalization: str, tf: Any) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    v1 = preprocess_image(data)[0]
    # No interpolation argument: this intentionally uses load_img's default nearest.
    image = tf.keras.utils.load_img(BytesIO(data), target_size=(224, 224))
    try:
        v2 = tf.keras.utils.img_to_array(image, dtype="float32")
    finally:
        image.close()
    if normalization == "resnet50":
        # V1 already ran the exact backend resize. Undo ONLY MobileNet scaling;
        # rounding restores its original integer pixels before ResNet's transform.
        pixels = np.clip(np.rint((v1 + 1.0) * 127.5), 0, 255).astype(np.float32)
        v1 = tf.keras.applications.resnet50.preprocess_input(pixels)
        v2 = tf.keras.applications.resnet50.preprocess_input(v2)
    else:
        v2 = tf.keras.applications.mobilenet_v2.preprocess_input(v2)
    return v1, v2


def run_inference(model: Any, records: list[dict[str, str]], normalization: str,
                  batch_size: int, tf: Any) -> list[dict[str, NDArray[np.float32]]]:
    results: list[dict[str, NDArray[np.float32]]] = []
    classes = int(model.output_shape[-1])
    for start in range(0, len(records), batch_size):
        tensors = []
        for record in records[start:start + batch_size]:
            v1, v2 = prepared_inputs(Path(record["file"]).read_bytes(), normalization, tf)
            # Four evaluations per image produce all four variants without
            # recomputing the unflipped probabilities for the TTA variants.
            tensors.extend((v1, v2, v2[:, ::-1, :], v1[:, ::-1, :]))
        batch = np.ascontiguousarray(tensors, dtype=np.float32)
        probabilities = np.asarray(model(batch, training=False), dtype=np.float32)
        if (probabilities.shape != (len(tensors), classes)
                or not np.isfinite(probabilities).all()
                or (probabilities < 0).any() or (probabilities > 1).any()
                or not np.allclose(probabilities.sum(axis=1), 1, atol=1e-4)):
            raise ValueError("Expected one softmax probability vector per input; no logits conversion is applied")
        for v1p, v2p, v2flip, v1flip in probabilities.reshape(-1, 4, classes):
            results.append({"V1": v1p, "V2": v2p,
                            "V3": (v2p + v2flip) / 2, "V4": (v1p + v1flip) / 2})
        print(f"  Inferred {min(start + batch_size, len(records))}/{len(records)} images", flush=True)
    return results


def report_predictions(name: str, labels: list[str], records: list[dict[str, str]],
                       results: list[dict[str, NDArray[np.float32]]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    totals = dict.fromkeys(VARIANTS, 0)
    correct = dict.fromkeys(VARIANTS, 0)
    for record, result in zip(records, results, strict=True):
        for variant, probabilities in result.items():
            top = np.argsort(-probabilities, kind="stable")[:3]
            row: dict[str, Any] = {"model": name, "variant": variant, **record}
            for rank, index in enumerate(top, 1):
                row[f"top{rank}_label"] = labels[int(index)]
                row[f"top{rank}_percent"] = float(probabilities[index]) * 100
            row["correct"] = (row["top1_label"] == record["true_label"]) if record["dataset"] == "test" else ""
            rows.append(row)
            if record["dataset"] == "camera":
                text = " | ".join(f"{row[f'top{r}_label']}: {row[f'top{r}_percent']:.4f}%" for r in (1, 2, 3))
                print(f"{name} | {variant} | {Path(record['file']).name}: {text}", flush=True)
            else:
                totals[variant] += 1
                correct[variant] += int(row["correct"])
    accuracy: list[dict[str, Any]] = []
    for variant in VARIANTS:
        if totals[variant]:
            percent = 100 * correct[variant] / totals[variant]
            accuracy.append({"model": name, "variant": variant, "correct": correct[variant],
                             "total": totals[variant], "accuracy_percent": percent})
            print(f"ACCURACY | {name} | {variant}: {correct[variant]}/{totals[variant]} = {percent:.4f}%", flush=True)
    return rows, accuracy


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = arguments()
    output = args.output_dir.resolve() / datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    output.mkdir(parents=True, exist_ok=False)
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    print(f"CSV output: {output}", flush=True)
    paths = [args.backend_model, args.notebook_model, args.mobilenet_model, args.resnet_model]
    hashes = hash_models(paths, args.downloads_dir, output)
    backend_labels = read_labels(args.backend_labels)
    notebook_labels = read_labels(args.notebook_labels)
    compare_labels(backend_labels, notebook_labels, output)

    import tensorflow as tf
    import keras

    tf.config.threading.set_intra_op_parallelism_threads(args.threads)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    print(f"\nSTEP 3: TensorFlow={tf.__version__}; Keras={keras.__version__}; "
          f"load_img interpolation={tf.keras.utils.load_img.__defaults__}", flush=True)
    print("V1=backend Pillow bilinear; V2=load_img default nearest; "
          "V3=V2 + horizontal probability TTA; V4=V1 + horizontal probability TTA.\n"
          "V2 also preserves load_img's EXIF handling; differences are not necessarily resize alone.\n"
          "Backend uses backend labels; downloaded models use notebook labels.\n"
          "ResNet50 uses resnet50.preprocess_input for every variant.\n"
          "Camera images have no asserted ground-truth label. Test accuracy uses folder names.", flush=True)
    records = collect_images(args, notebook_labels)
    save_csv(output / "images.csv", [{**r, "sha256": digest(Path(r["file"]))} for r in records],
             ("dataset", "file", "true_label", "sha256"))
    specs = [("backend_best", args.backend_model, backend_labels, "mobilenet_v2"),
             ("sportsnap_best", args.notebook_model, notebook_labels, "mobilenet_v2"),
             ("MobileNetV2_finetune", args.mobilenet_model, notebook_labels, "mobilenet_v2"),
             ("ResNet50_finetune", args.resnet_model, notebook_labels, "resnet50")]
    metadata: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []
    accuracy_rows: list[dict[str, Any]] = []
    failed_required = False
    for name, path, labels, normalization in specs:
        row: dict[str, Any] = {"model": name, "file": str(path.resolve()), "normalization": normalization,
                               "tensorflow": tf.__version__, "keras": keras.__version__, "error": ""}
        model = None
        try:
            checksum = hashes.get(path.resolve())
            if checksum is None:
                raise ValueError(f"Model unavailable: {path}")
            # Load and evaluate each requested path independently, even when the
            # byte-identical copies should necessarily produce the same result.
            tf.keras.backend.clear_session()
            model = tf.keras.models.load_model(path, compile=False)
            preprocess, opaque = inspect_layers(model)
            activation = getattr(model.layers[-1], "activation", None)
            row.update(input_shape=str(model.input_shape), output_classes=int(model.output_shape[-1]),
                       last_activation=getattr(activation, "__name__", "unknown"),
                       preprocess_layers=json.dumps(preprocess, default=str),
                       opaque_layers=json.dumps(opaque, default=str))
            print(f"\n{name}: input={row['input_shape']}, classes={row['output_classes']}, "
                  f"last_activation={row['last_activation']}", flush=True)
            print(f"  Rescaling/preprocess layers: {row['preprocess_layers']}\n"
                  f"  Lambda/opaque layers (manual inspection if present): {row['opaque_layers']}", flush=True)
            if tuple(model.input_shape[1:]) != (224, 224, 3):
                raise ValueError("Model input is incompatible with the requested 224x224 RGB comparison")
            if row["output_classes"] != len(labels):
                raise ValueError("Output class count differs from label count")
            print(f"STEP 4: evaluating {name}", flush=True)
            results = run_inference(model, records, normalization, args.batch_size, tf)
            predictions, accuracy = report_predictions(name, labels, records, results)
            prediction_rows.extend(predictions)
            accuracy_rows.extend(accuracy)
        except Exception as exc:
            row["error"] = f"{type(exc).__name__}: {exc}"
            print(f"MODEL FAILED | {name}: {row['error']}", file=sys.stderr, flush=True)
            failed_required |= name in {"backend_best", "sportsnap_best"}
        finally:
            metadata.append(row)
            if model is not None:
                del model
    save_csv(output / "models.csv", metadata,
             ("model", "file", "normalization", "tensorflow", "keras", "input_shape", "output_classes",
              "last_activation", "preprocess_layers", "opaque_layers", "error"))
    save_csv(output / "predictions.csv", prediction_rows,
             ("model", "variant", "dataset", "file", "true_label", "top1_label", "top1_percent",
              "top2_label", "top2_percent", "top3_label", "top3_percent", "correct"))
    save_csv(output / "accuracy.csv", accuracy_rows,
             ("model", "variant", "correct", "total", "accuracy_percent"))
    # Rehash inputs to detect accidental external changes during this run.
    for path, before in hashes.items():
        if digest(path) != before:
            raise ValueError(f"Model changed during comparison: {path}")
    print(f"\nFinished. Model hashes unchanged. CSV: {output}", flush=True)
    return 1 if failed_required else (0 if args.test_dir is not None else 2)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, ImportError, RuntimeError) as exc:
        print(f"Comparison stopped: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
