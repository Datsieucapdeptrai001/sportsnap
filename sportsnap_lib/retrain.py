"""Incremental CPU-friendly ResNet50 fine-tuning with human-corrected labels."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import random
import sqlite3
from typing import Any

import numpy as np
from PIL import Image, ImageOps
from sklearn.metrics import accuracy_score, f1_score

from sportsnap_lib.calibration import fit_temperature
from sportsnap_lib.config import LibrarySettings
from sportsnap_lib.ingest import SUPPORTED_EXTENSIONS, preprocess_batch, update_job
from sportsnap_lib.paths import resolve_stored_path
from sportsnap_lib.registry import (
    ModelVersionRecord,
    ensure_initial_version,
    get_active_version,
    next_version_name,
    register_version,
    update_version_in_place,
)


def _load_rgb_224(path: Path) -> np.ndarray:
    with Image.open(path) as src:
        rgb = ImageOps.exif_transpose(src).convert("RGB").resize((224, 224), Image.BILINEAR)
        return np.asarray(rgb, dtype=np.float32)


def _collect_replay_samples(
    root: Path,
    label_to_idx: dict[str, int],
    *,
    max_per_class: int = 8,
    seed: int = 42,
) -> list[tuple[Path, int]]:
    rng = random.Random(seed)
    samples: list[tuple[Path, int]] = []
    if not root.is_dir():
        return samples
    for label, idx in sorted(label_to_idx.items()):
        class_dir = root / label
        if not class_dir.is_dir():
            continue
        files = sorted(
            p for p in class_dir.iterdir()
            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
        )
        if len(files) > max_per_class:
            files = rng.sample(files, max_per_class)
        for p in files:
            samples.append((p, idx))
    return samples


def _evaluate_split(
    model: Any,
    samples: list[tuple[Path, int]],
    preprocess: str,
    batch_size: int = 32,
) -> tuple[np.ndarray, np.ndarray]:
    if not samples:
        return np.empty((0, 0), dtype=np.float32), np.empty((0,), dtype=np.int64)
    probs_list: list[np.ndarray] = []
    y_true: list[int] = []
    for start in range(0, len(samples), batch_size):
        chunk = samples[start:start + batch_size]
        arrays = [_load_rgb_224(p) for p, _ in chunk]
        batch = preprocess_batch(arrays, preprocess)
        preds = np.asarray(model.predict(batch, verbose=0), dtype=np.float32)
        probs_list.append(preds)
        y_true.extend(lbl for _, lbl in chunk)
    return np.concatenate(probs_list, axis=0), np.asarray(y_true, dtype=np.int64)


def retrain_from_corrections(
    conn: sqlite3.Connection,
    settings: LibrarySettings,
    *,
    epochs: int = 3,
    batch_size: int = 16,
    replay_per_class: int = 6,
    eval_per_class: int = 5,
    correction_repeat: int = 3,
    learning_rate: float = 1e-4,
    activate: bool = False,
    in_place: bool = False,
    sync_source_model: bool = True,
    job_id: str | None = None,
) -> ModelVersionRecord:
    """Fine-tune the active ResNet50 model using human-corrected labels + replay."""
    import tensorflow as tf

    settings.ensure_dirs()
    parent = get_active_version(conn)
    if parent is None:
        parent = ensure_initial_version(conn, settings)

    labels = json.loads(parent.labels_path.read_text(encoding="utf-8"))
    label_to_idx = {lbl: idx for idx, lbl in enumerate(labels)}

    update_job(conn, job_id, state="running", progress=0.05, message="Đang gom dữ liệu nhãn đã sửa...")
    correction_rows = conn.execute(
        """
        SELECT i.path, l.label
        FROM labels l
        JOIN images i ON i.id = l.image_id
        WHERE l.source = 'human'
        ORDER BY i.id ASC
        """
    ).fetchall()
    corrections: list[tuple[Path, int]] = []
    for r in correction_rows:
        resolved = resolve_stored_path(str(r["path"]), settings.project_root)
        if str(r["label"]) in label_to_idx and resolved is not None:
            corrections.append((resolved, label_to_idx[str(r["label"])]))
    n_corrections = len(corrections)
    if n_corrections == 0:
        raise ValueError("Chưa có ảnh nào được người dùng sửa/xác nhận nhãn (source='human').")

    replay = _collect_replay_samples(
        settings.train_dir, label_to_idx, max_per_class=replay_per_class
    )
    train_samples = corrections * max(1, correction_repeat) + replay
    rng = random.Random(42)
    rng.shuffle(train_samples)

    hash_input = "|".join(f"{p}:{idx}" for p, idx in sorted(train_samples)).encode("utf-8")
    train_hash = hashlib.sha256(hash_input).hexdigest()[:16]

    update_job(conn, job_id, state="running", progress=0.20, message="Đang chuẩn bị batch huấn luyện...")
    x_train = preprocess_batch([_load_rgb_224(p) for p, _ in train_samples], parent.preprocess)
    y_train = np.asarray([idx for _, idx in train_samples], dtype=np.int32)

    val_samples = _collect_replay_samples(
        settings.valid_dir, label_to_idx, max_per_class=eval_per_class, seed=7
    )
    test_samples = _collect_replay_samples(
        settings.test_dir, label_to_idx, max_per_class=eval_per_class, seed=11
    )

    update_job(conn, job_id, state="running", progress=0.35, message=f"Đang nạp mô hình gốc {parent.version}...")
    model = tf.keras.models.load_model(parent.checkpoint_path, compile=False)

    # Match SportSnap_02_ThiNghiem_BoSung_Muc12.ipynb / DECISIONS.md §6:
    # Unfreeze conv5_block* layers while keeping BatchNormalization frozen.
    for layer in model.layers:
        if isinstance(layer, tf.keras.Model):
            layer.trainable = True
            for sub in layer.layers:
                if isinstance(sub, tf.keras.layers.BatchNormalization):
                    sub.trainable = False
                elif sub.name.startswith("conv5_block") or "block_16" in sub.name or "Conv_1" in sub.name:
                    sub.trainable = True
                else:
                    sub.trainable = False
        elif isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False
        else:
            layer.trainable = True

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=learning_rate),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    update_job(
        conn,
        job_id,
        state="running",
        progress=0.50,
        message=f"Đang tinh chỉnh {epochs} epoch trên {len(train_samples)} mẫu...",
    )
    history = model.fit(
        x_train,
        y_train,
        epochs=epochs,
        batch_size=batch_size,
        verbose=0,
    )

    update_job(conn, job_id, state="running", progress=0.80, message="Đang hiệu chỉnh xác suất & đánh giá...")
    val_probs, val_y = _evaluate_split(model, val_samples, parent.preprocess)
    cal_report = fit_temperature(val_probs, val_y)

    eval_target = test_samples if test_samples else val_samples
    test_probs, test_y = _evaluate_split(model, eval_target, parent.preprocess)
    if len(test_y) > 0:
        test_preds = np.argmax(test_probs, axis=1)
        eval_acc = float(accuracy_score(test_y, test_preds))
        eval_f1 = float(f1_score(test_y, test_preds, average="macro", zero_division=0))
    else:
        eval_acc = float(history.history["accuracy"][-1])
        eval_f1 = eval_acc

    metrics = {
        "train_samples": len(train_samples),
        "n_corrections": n_corrections,
        "train_accuracy": round(float(history.history["accuracy"][-1]), 4),
        "eval_accuracy": round(eval_acc, 4),
        "eval_macro_f1": round(eval_f1, 4),
        "ece_before": cal_report.ece_before,
        "ece_after": cal_report.ece_after,
        "nll_before": cal_report.nll_before,
        "nll_after": cal_report.nll_after,
    }

    if in_place:
        target_ckpt = parent.checkpoint_path
        target_ckpt.parent.mkdir(parents=True, exist_ok=True)
        model.save(target_ckpt)
        # Keep the active serving file in models/ updated when retraining in place
        # (never touch backend/models/best_model.keras golden checkpoint).
        src_norm = str(settings.source_model_path).replace("\\", "/")
        if (
            sync_source_model
            and settings.source_model_path.is_file()
            and "backend/models/" not in src_norm
            and settings.source_model_path.resolve() != target_ckpt.resolve()
        ):
            model.save(settings.source_model_path)
        record = update_version_in_place(
            conn,
            version=parent.version,
            train_set_hash=train_hash,
            n_corrections_used=n_corrections,
            metrics=metrics,
            temperature=cal_report.temperature,
            tau_high=cal_report.tau_high,
            tau_low=cal_report.tau_low,
        )
        done_label = parent.version
    else:
        new_version = next_version_name(conn)
        version_dir = settings.registry_dir / new_version
        version_dir.mkdir(parents=True, exist_ok=True)
        ckpt_path = version_dir / f"{parent.backbone}_retrained.keras"
        labels_path = version_dir / "labels.json"
        labels_path.write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
        model.save(ckpt_path)
        record = register_version(
            conn,
            version=new_version,
            parent=parent.version,
            train_set_hash=train_hash,
            n_corrections_used=n_corrections,
            metrics=metrics,
            temperature=cal_report.temperature,
            tau_high=cal_report.tau_high,
            tau_low=cal_report.tau_low,
            preprocess=parent.preprocess,
            backbone=parent.backbone,
            checkpoint_path=ckpt_path,
            labels_path=labels_path,
            activate=activate,
        )
        done_label = new_version

    update_job(
        conn,
        job_id,
        state="done",
        progress=1.0,
        message=f"Đã cập nhật {done_label} (eval acc: {eval_acc:.1%}, ECE: {cal_report.ece_after:.4f}).",
    )
    return record
