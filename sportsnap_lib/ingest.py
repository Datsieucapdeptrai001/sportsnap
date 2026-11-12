"""Batch photo library ingestion pipeline (ResNet50/classifier + CLIP + quality metrics)."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Callable, Iterable, Sequence

import imagehash
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps

from sportsnap_lib.config import LibrarySettings
from sportsnap_lib.db import set_image_label, utc_now_iso
from sportsnap_lib.embedder import Embedder, FastEmbedClipEmbedder
from sportsnap_lib.registry import ensure_initial_version, get_active_version
from sportsnap_lib.vector_index import NumpyVectorIndex, VectorIndex


SUPPORTED_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp"})


@dataclass(frozen=True)
class IngestSummary:
    total_scanned: int
    newly_indexed: int
    skipped_existing: int
    failed: int


def compute_sharpness(rgb_224: NDArray[np.float32]) -> float:
    """Compute Laplacian variance on a 224x224 RGB float32 array without OpenCV."""
    gray = (
        0.299 * rgb_224[:, :, 0]
        + 0.587 * rgb_224[:, :, 1]
        + 0.114 * rgb_224[:, :, 2]
    )
    lap = (
        gray[:-2, 1:-1]
        + gray[2:, 1:-1]
        + gray[1:-1, :-2]
        + gray[1:-1, 2:]
        - 4.0 * gray[1:-1, 1:-1]
    )
    return float(np.var(lap))


def compute_exposure(rgb_224: NDArray[np.float32]) -> float:
    """Return exposure balance score in [0, 1] rewarding midtones and low clipping."""
    gray = (
        0.299 * rgb_224[:, :, 0]
        + 0.587 * rgb_224[:, :, 1]
        + 0.114 * rgb_224[:, :, 2]
    ) / 255.0
    mean_score = max(0.0, 1.0 - abs(float(np.mean(gray)) - 0.5) * 2.0)
    non_clipped = float(np.mean((gray >= 0.06) & (gray <= 0.94)))
    return float(np.clip(0.5 * mean_score + 0.5 * non_clipped, 0.0, 1.0))


def apply_temperature_scaling(
    probs: NDArray[np.floating], temperature: float
) -> NDArray[np.float32]:
    """Scale probabilities by temperature T in probability/log space."""
    arr = np.asarray(probs, dtype=np.float64)
    if abs(temperature - 1.0) < 1e-6:
        return arr.astype(np.float32)
    t = max(float(temperature), 1e-3)
    logits = np.log(np.clip(arr, 1e-12, 1.0)) / t
    logits -= np.max(logits, axis=1, keepdims=True)
    exp = np.exp(logits)
    return (exp / np.sum(exp, axis=1, keepdims=True)).astype(np.float32)


def preprocess_batch(
    images: Sequence[NDArray[np.float32]], preprocess: str
) -> NDArray[np.float32]:
    """Preprocess list of (224, 224, 3) float32 RGB arrays for the given backbone."""
    batch = np.stack(images, axis=0).astype(np.float32)
    if preprocess == "mobilenet_v2":
        from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

        return np.asarray(preprocess_input(batch.copy()), dtype=np.float32)
    if preprocess == "resnet50":
        from tensorflow.keras.applications.resnet50 import preprocess_input

        return np.asarray(preprocess_input(batch.copy()), dtype=np.float32)
    if preprocess == "none":
        return batch
    raise ValueError(f"Unsupported preprocess mode: {preprocess}")


def extract_exif_taken_at(img: Image.Image) -> str | None:
    """Extract EXIF capture timestamp if present."""
    try:
        exif = img.getexif()
        if not exif:
            return None
        for tag_id in (36867, 36868, 306):  # DateTimeOriginal, DateTimeDigitized, DateTime
            val = exif.get(tag_id)
            if isinstance(val, str) and val.strip():
                return val.strip()
    except Exception:
        return None
    return None


def iter_image_files(folder: Path) -> list[Path]:
    """Recursively collect supported image files sorted deterministically."""
    if not folder.is_dir():
        raise FileNotFoundError(f"Directory not found: {folder}")
    return sorted(
        p
        for p in folder.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def update_job(
    conn: sqlite3.Connection,
    job_id: str | None,
    *,
    state: str,
    progress: float,
    message: str | None = None,
    error: str | None = None,
) -> None:
    """Upsert job progress row in SQLite when job_id is supplied."""
    if not job_id:
        return
    now = utc_now_iso()
    conn.execute(
        """
        INSERT INTO jobs (id, type, state, progress, message, error, created_at, updated_at)
        VALUES (?, 'ingest', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            state = excluded.state,
            progress = excluded.progress,
            message = excluded.message,
            error = excluded.error,
            updated_at = excluded.updated_at
        """,
        (job_id, state, float(progress), message, error, now, now),
    )
    conn.commit()


def _make_predictor(model: Any) -> Callable[[NDArray[np.float32]], NDArray[np.float32]]:
    """Build fast @tf.function predictor when possible, else fall back to .predict."""
    try:
        import tensorflow as tf

        if isinstance(model, tf.keras.Model):
            @tf.function(reduce_retracing=True)
            def _fast_forward(x):
                return model(x, training=False)

            def _call(batch: NDArray[np.float32]) -> NDArray[np.float32]:
                return np.asarray(_fast_forward(tf.convert_to_tensor(batch)).numpy(), dtype=np.float32)

            return _call
    except Exception:
        pass
    return lambda batch: np.asarray(model.predict(batch, verbose=0), dtype=np.float32)


def ingest_paths(
    paths: Sequence[Path],
    conn: sqlite3.Connection,
    settings: LibrarySettings,
    *,
    model: Any | None = None,
    labels: list[str] | None = None,
    preprocess: str | None = None,
    embedder: Embedder | None = None,
    index: VectorIndex | None = None,
    batch_size: int = 32,
    job_id: str | None = None,
) -> IngestSummary:
    """Ingest a list of image files into SQLite and the CLIP vector index."""
    settings.ensure_dirs()
    version_rec = get_active_version(conn)
    if version_rec is None:
        version_rec = ensure_initial_version(conn, settings)

    if model is None or labels is None:
        from tensorflow.keras.models import load_model

        model = load_model(version_rec.checkpoint_path, compile=False)
        labels = json.loads(version_rec.labels_path.read_text(encoding="utf-8"))
        preprocess = version_rec.preprocess
    active_preprocess = preprocess or version_rec.preprocess
    temperature = version_rec.temperature
    tau_high = version_rec.tau_high if version_rec.tau_high is not None else 0.60
    tau_low = version_rec.tau_low if version_rec.tau_low is not None else 0.35

    clip = embedder or FastEmbedClipEmbedder()
    vec_index = index if index is not None else NumpyVectorIndex.load(settings.index_dir)
    predictor = _make_predictor(model)

    existing_sha1s = {
        row["sha1"]
        for row in conn.execute("SELECT sha1 FROM images").fetchall()
    }
    next_row_index = int(
        conn.execute("SELECT COALESCE(MAX(row_index) + 1, 0) FROM embeddings").fetchone()[0]
    )

    total = len(paths)
    newly_indexed = 0
    skipped = 0
    failed = 0
    update_job(conn, job_id, state="running", progress=0.0, message=f"Đang quét {total} ảnh...")

    pending_records: list[dict[str, Any]] = []

    def _flush_batch() -> None:
        nonlocal newly_indexed, next_row_index
        if not pending_records:
            return
        rgb_arrays = [rec["rgb_224"] for rec in pending_records]
        pil_thumbs = [rec["pil_rgb"] for rec in pending_records]

        batch_input = preprocess_batch(rgb_arrays, active_preprocess)
        raw_probs = predictor(batch_input)
        cal_probs = apply_temperature_scaling(raw_probs, temperature)
        clip_vecs = clip.embed_images(pil_thumbs)

        added_ids: list[int] = []
        added_vecs: list[NDArray[np.float32]] = []
        now = utc_now_iso()

        for row_idx, rec in enumerate(pending_records):
            probs = raw_probs[row_idx]
            c_probs = cal_probs[row_idx]
            top_idx = int(np.argmax(c_probs))
            top_label = labels[top_idx]
            raw_prob = float(probs[top_idx])
            cal_prob = float(c_probs[top_idx])
            if cal_prob >= tau_high:
                status = "auto"
            elif cal_prob >= tau_low:
                status = "review"
            else:
                status = "unknown"

            cur = conn.execute(
                """
                INSERT INTO images (
                    path, sha1, width, height, taken_at, added_at,
                    thumb_path, phash, phash_mirror, sharpness, exposure
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(rec["path"]),
                    rec["sha1"],
                    rec["width"],
                    rec["height"],
                    rec["taken_at"],
                    now,
                    str(rec["thumb_path"]),
                    rec["phash"],
                    rec["phash_mirror"],
                    rec["sharpness"],
                    rec["exposure"],
                ),
            )
            image_id = int(cur.lastrowid)
            conn.execute(
                """
                INSERT INTO predictions (
                    image_id, model_version, probs_json, top1_label,
                    top1_prob, calibrated_prob, status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    image_id,
                    version_rec.version,
                    json.dumps([float(v) for v in probs]),
                    top_label,
                    raw_prob,
                    cal_prob,
                    status,
                ),
            )
            set_image_label(conn, image_id, top_label, "model")
            conn.execute(
                """
                INSERT INTO embeddings (image_id, clip_model, dim, row_index)
                VALUES (?, ?, ?, ?)
                """,
                (image_id, clip.model_name, int(clip_vecs.shape[1]), next_row_index),
            )
            next_row_index += 1
            added_ids.append(image_id)
            added_vecs.append(clip_vecs[row_idx])
            newly_indexed += 1

        conn.commit()
        if added_ids:
            vec_index.add(added_ids, np.stack(added_vecs, axis=0))
        pending_records.clear()

    for idx, path in enumerate(paths, start=1):
        try:
            raw_bytes = path.read_bytes()
            sha1 = hashlib.sha1(raw_bytes).hexdigest()
            if sha1 in existing_sha1s:
                skipped += 1
                continue
            with Image.open(path) as src:
                taken_at = extract_exif_taken_at(src)
                rgb = ImageOps.exif_transpose(src).convert("RGB")
                width, height = rgb.size
                thumb = rgb.copy()
                thumb.thumbnail((settings.thumb_max_side, settings.thumb_max_side), Image.Resampling.LANCZOS)
                thumb_path = settings.thumbs_dir / f"{sha1}.jpg"
                thumb.save(thumb_path, format="JPEG", quality=88)

                resized = rgb.resize((224, 224), Image.BILINEAR)
                rgb_224 = np.asarray(resized, dtype=np.float32)
                sharpness = compute_sharpness(rgb_224)
                exposure = compute_exposure(rgb_224)
                phash = str(imagehash.phash(rgb))
                phash_mirror = str(imagehash.phash(ImageOps.mirror(rgb)))

            existing_sha1s.add(sha1)
            pending_records.append(
                {
                    "path": path.resolve(),
                    "sha1": sha1,
                    "width": width,
                    "height": height,
                    "taken_at": taken_at,
                    "thumb_path": thumb_path.resolve(),
                    "phash": phash,
                    "phash_mirror": phash_mirror,
                    "sharpness": sharpness,
                    "exposure": exposure,
                    "rgb_224": rgb_224,
                    "pil_rgb": thumb,
                }
            )
            if len(pending_records) >= batch_size:
                _flush_batch()
                update_job(
                    conn,
                    job_id,
                    state="running",
                    progress=idx / max(total, 1),
                    message=f"Đã xử lý {idx}/{total} ảnh ({newly_indexed} ảnh mới)...",
                )
        except Exception:
            failed += 1

    _flush_batch()
    vec_index.save(settings.index_dir)
    update_job(
        conn,
        job_id,
        state="done",
        progress=1.0,
        message=f"Hoàn tất: {newly_indexed} ảnh mới, {skipped} ảnh đã có, {failed} lỗi.",
    )
    return IngestSummary(
        total_scanned=total,
        newly_indexed=newly_indexed,
        skipped_existing=skipped,
        failed=failed,
    )


def ingest_directory(
    folder: Path,
    conn: sqlite3.Connection,
    settings: LibrarySettings,
    **kwargs: Any,
) -> IngestSummary:
    """Scan a directory recursively and ingest all supported images."""
    files = iter_image_files(folder)
    return ingest_paths(files, conn, settings, **kwargs)
