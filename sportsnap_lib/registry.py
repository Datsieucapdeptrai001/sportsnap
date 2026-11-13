"""Versioned model registry under data/models_registry/ (source models stay read-only)."""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sportsnap_lib.config import LibrarySettings
from sportsnap_lib.db import utc_now_iso


@dataclass(frozen=True)
class ModelVersionRecord:
    """Metadata row for a registered classifier version."""

    version: str
    parent: str | None
    created_at: str
    train_set_hash: str | None
    n_corrections_used: int
    metrics: dict[str, Any]
    temperature: float
    tau_high: float | None
    tau_low: float | None
    preprocess: str
    backbone: str
    checkpoint_path: Path
    labels_path: Path
    is_active: bool


def _row_to_record(row: sqlite3.Row) -> ModelVersionRecord:
    return ModelVersionRecord(
        version=str(row["version"]),
        parent=row["parent"],
        created_at=str(row["created_at"]),
        train_set_hash=row["train_set_hash"],
        n_corrections_used=int(row["n_corrections_used"]),
        metrics=json.loads(str(row["metrics_json"])),
        temperature=float(row["temperature"]),
        tau_high=float(row["tau_high"]) if row["tau_high"] is not None else None,
        tau_low=float(row["tau_low"]) if row["tau_low"] is not None else None,
        preprocess=str(row["preprocess"]),
        backbone=str(row["backbone"]),
        checkpoint_path=Path(str(row["checkpoint_path"])),
        labels_path=Path(str(row["labels_path"])),
        is_active=bool(row["is_active"]),
    )


def file_sha256(path: Path) -> str:
    """Compute SHA-256 hex digest of a file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_initial_version(
    conn: sqlite3.Connection, settings: LibrarySettings
) -> ModelVersionRecord:
    """Register v1 from the read-only source model if the registry is empty."""
    existing = get_active_version(conn)
    if existing is not None:
        return existing

    any_row = conn.execute("SELECT * FROM model_versions LIMIT 1").fetchone()
    if any_row is not None:
        rec = _row_to_record(any_row)
        promote_version(conn, rec.version)
        return get_active_version(conn)  # type: ignore[return-value]

    if not settings.source_model_path.is_file():
        raise FileNotFoundError(
            f"Source model not found: {settings.source_model_path}"
        )
    if not settings.source_labels_path.is_file():
        raise FileNotFoundError(
            f"Source labels not found: {settings.source_labels_path}"
        )

    settings.ensure_dirs()
    v1_dir = settings.registry_dir / "v1"
    v1_dir.mkdir(parents=True, exist_ok=True)
    dest_model = v1_dir / settings.source_model_path.name
    dest_labels = v1_dir / "labels.json"

    if not dest_model.is_file():
        shutil.copy2(settings.source_model_path, dest_model)
    if not dest_labels.is_file():
        shutil.copy2(settings.source_labels_path, dest_labels)

    metrics = {
        "source_model": settings.source_model_path.name,
        "source_sha256": file_sha256(settings.source_model_path),
        "status": "active",
    }
    conn.execute(
        """
        INSERT INTO model_versions (
            version, parent, created_at, train_set_hash, n_corrections_used,
            metrics_json, temperature, tau_high, tau_low,
            preprocess, backbone, checkpoint_path, labels_path, is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """,
        (
            "v1",
            None,
            utc_now_iso(),
            None,
            0,
            json.dumps(metrics),
            1.0,
            None,
            None,
            settings.source_preprocess,
            settings.source_backbone,
            str(dest_model),
            str(dest_labels),
        ),
    )
    conn.commit()
    active = get_active_version(conn)
    assert active is not None
    return active


def get_active_version(conn: sqlite3.Connection) -> ModelVersionRecord | None:
    """Return the currently active model version, or None if none is active."""
    row = conn.execute(
        "SELECT * FROM model_versions WHERE is_active = 1 LIMIT 1"
    ).fetchone()
    return _row_to_record(row) if row is not None else None


def list_versions(conn: sqlite3.Connection) -> list[ModelVersionRecord]:
    """Return all registered model versions ordered from newest to oldest."""
    rows = conn.execute(
        "SELECT * FROM model_versions ORDER BY created_at DESC, version DESC"
    ).fetchall()
    return [_row_to_record(r) for r in rows]


def promote_version(conn: sqlite3.Connection, version: str) -> ModelVersionRecord:
    """Set the specified registered version as the sole active model."""
    row = conn.execute(
        "SELECT * FROM model_versions WHERE version = ?", (version,)
    ).fetchone()
    if row is None:
        raise ValueError(f"Unknown model version: {version}")
    conn.execute("UPDATE model_versions SET is_active = 0")
    conn.execute(
        "UPDATE model_versions SET is_active = 1 WHERE version = ?", (version,)
    )
    conn.commit()
    updated = conn.execute(
        "SELECT * FROM model_versions WHERE version = ?", (version,)
    ).fetchone()
    assert updated is not None
    return _row_to_record(updated)
