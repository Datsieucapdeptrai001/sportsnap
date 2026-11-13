"""SQLite schema and data access helpers for SportSnap Smart Photo Library."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal


SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    sha1 TEXT NOT NULL UNIQUE,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    taken_at TEXT,
    added_at TEXT NOT NULL,
    thumb_path TEXT NOT NULL,
    phash TEXT,
    phash_mirror TEXT,
    sharpness REAL,
    exposure REAL
);

CREATE TABLE IF NOT EXISTS predictions (
    image_id INTEGER PRIMARY KEY,
    model_version TEXT NOT NULL,
    probs_json TEXT NOT NULL,
    top1_label TEXT NOT NULL,
    top1_prob REAL NOT NULL,
    calibrated_prob REAL,
    status TEXT NOT NULL CHECK(status IN ('auto', 'review', 'unknown')),
    FOREIGN KEY(image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
    image_id INTEGER PRIMARY KEY,
    clip_model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    row_index INTEGER NOT NULL,
    FOREIGN KEY(image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS labels (
    image_id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('model', 'human')),
    updated_at TEXT NOT NULL,
    FOREIGN KEY(image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dup_groups (
    group_id INTEGER PRIMARY KEY AUTOINCREMENT,
    params_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dup_members (
    group_id INTEGER NOT NULL,
    image_id INTEGER NOT NULL,
    score_total REAL NOT NULL,
    score_sharpness REAL NOT NULL,
    score_exposure REAL NOT NULL,
    score_conf REAL NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0,
    user_decision TEXT,
    PRIMARY KEY(group_id, image_id),
    FOREIGN KEY(group_id) REFERENCES dup_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY(image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS model_versions (
    version TEXT PRIMARY KEY,
    parent TEXT,
    created_at TEXT NOT NULL,
    train_set_hash TEXT,
    n_corrections_used INTEGER NOT NULL DEFAULT 0,
    metrics_json TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 1.0,
    tau_high REAL,
    tau_low REAL,
    preprocess TEXT NOT NULL DEFAULT 'resnet50',
    backbone TEXT NOT NULL DEFAULT 'resnet50',
    checkpoint_path TEXT NOT NULL,
    labels_path TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    state TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0.0,
    message TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT,
    image_sha1 TEXT NOT NULL,
    image_path TEXT NOT NULL,
    previous_label TEXT NOT NULL,
    predicted_label TEXT NOT NULL,
    corrected_label TEXT NOT NULL,
    confidence REAL,
    model_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT,
    is_used_for_training INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
CREATE INDEX IF NOT EXISTS idx_labels_source ON labels(source);
CREATE INDEX IF NOT EXISTS idx_embeddings_row ON embeddings(row_index);
CREATE INDEX IF NOT EXISTS idx_corrections_undone ON corrections(undone_at);
CREATE INDEX IF NOT EXISTS idx_corrections_sha1 ON corrections(image_sha1);
CREATE INDEX IF NOT EXISTS idx_corrections_batch ON corrections(batch_id);
"""


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


def connect_db(db_path: Path) -> sqlite3.Connection:
    """Open a SQLite connection configured with WAL mode and foreign keys."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db(db_path: Path) -> sqlite3.Connection:
    """Create database tables if absent and return an open connection."""
    conn = connect_db(db_path)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    return conn


def set_image_label(
    conn: sqlite3.Connection,
    image_id: int,
    label: str,
    source: Literal["model", "human"],
) -> None:
    """Upsert label for an image while guaranteeing human labels are never overwritten by model."""
    existing = conn.execute(
        "SELECT source FROM labels WHERE image_id = ?", (image_id,)
    ).fetchone()
    if existing is not None and existing["source"] == "human" and source == "model":
        return
    conn.execute(
        """
        INSERT INTO labels (image_id, label, source, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(image_id) DO UPDATE SET
            label = excluded.label,
            source = excluded.source,
            updated_at = excluded.updated_at
        """,
        (image_id, label, source, utc_now_iso()),
    )
    conn.commit()


def record_correction(
    conn: sqlite3.Connection,
    image_sha1: str,
    image_path: str,
    previous_label: str,
    predicted_label: str,
    corrected_label: str,
    confidence: float | None = None,
    model_id: str = "legacy_mobilenet_v2",
    batch_id: str | None = None,
) -> int:
    """Record a user correction in the database."""
    cur = conn.execute(
        """
        INSERT INTO corrections (
            batch_id, image_sha1, image_path, previous_label,
            predicted_label, corrected_label, confidence, model_id,
            created_at, undone_at, is_used_for_training
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
        """,
        (
            batch_id,
            image_sha1,
            image_path,
            previous_label,
            predicted_label,
            corrected_label,
            confidence,
            model_id,
            utc_now_iso(),
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def undo_correction(
    conn: sqlite3.Connection,
    correction_id: int | None = None,
    image_sha1: str | None = None,
    batch_id: str | None = None,
) -> tuple[int, str | None]:
    """Mark matching active corrections as undone, returning (count, restored_label)."""
    now = utc_now_iso()
    restored_label: str | None = None
    if correction_id is not None:
        row = conn.execute(
            "SELECT previous_label FROM corrections WHERE id = ? AND undone_at IS NULL",
            (correction_id,),
        ).fetchone()
        if row:
            restored_label = str(row["previous_label"])
        cur = conn.execute(
            "UPDATE corrections SET undone_at = ? WHERE id = ? AND undone_at IS NULL",
            (now, correction_id),
        )
    elif image_sha1 is not None:
        row = conn.execute(
            "SELECT previous_label FROM corrections WHERE image_sha1 = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1",
            (image_sha1,),
        ).fetchone()
        if row:
            restored_label = str(row["previous_label"])
        cur = conn.execute(
            "UPDATE corrections SET undone_at = ? WHERE image_sha1 = ? AND undone_at IS NULL",
            (now, image_sha1),
        )
    elif batch_id is not None:
        cur = conn.execute(
            "UPDATE corrections SET undone_at = ? WHERE batch_id = ? AND undone_at IS NULL",
            (now, batch_id),
        )
    else:
        return 0, None
    conn.commit()
    return int(cur.rowcount), restored_label


def list_corrections(
    conn: sqlite3.Connection,
    limit: int = 100,
    include_undone: bool = False,
) -> list[sqlite3.Row]:
    """List recent corrections."""
    query = "SELECT * FROM corrections"
    if not include_undone:
        query += " WHERE undone_at IS NULL"
    query += " ORDER BY id DESC LIMIT ?"
    return conn.execute(query, (limit,)).fetchall()
