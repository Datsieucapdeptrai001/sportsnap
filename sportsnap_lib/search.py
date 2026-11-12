"""Hybrid natural-language + visual similarity search over SQLite and CLIP VectorIndex."""

from __future__ import annotations

from dataclasses import dataclass
import re
import sqlite3
from typing import Any

from PIL import Image

from sportsnap_lib.embedder import Embedder
from sportsnap_lib.vector_index import VectorIndex


VI_EN_SPORTS_TERMS: tuple[tuple[str, str], ...] = (
    ("bắn cung", "archery bow arrow target"),
    ("bóng chày", "baseball bat pitcher ball"),
    ("bóng rổ", "basketball hoop court dunk"),
    ("quyền anh", "boxing ring gloves punch"),
    ("đấm bốc", "boxing ring gloves punch"),
    ("chèo thuyền", "canoe slalom kayak water paddle"),
    ("khúc côn cầu trên cỏ", "field hockey stick grass"),
    ("trượt băng nghệ thuật", "figure skating ice rink"),
    ("bóng đá mỹ", "american football helmet turf"),
    ("bóng đá", "football soccer match field"),
    ("công thức 1", "formula 1 racing car track"),
    ("đua xe f1", "formula 1 racing car track"),
    ("đánh gôn", "golf golfer green club"),
    ("chơi golf", "golf golfer green club"),
    ("nhảy cao", "high jump track and field bar"),
    ("khúc côn cầu", "ice hockey rink puck"),
    ("đấu vật", "olympic wrestling mat"),
    ("mã cầu", "polo horse mallet field"),
    ("trượt patin", "rollerblade roller derby skating"),
    ("bơi lội", "swimming pool swimmer water"),
    ("quần vợt", "tennis racket court net"),
    ("xà lệch", "uneven bars gymnastics"),
    ("bóng chuyền", "volleyball net court spike"),
    ("ngoài trời", "outdoor grass daylight"),
    ("trong nhà", "indoor arena stadium"),
    ("dưới nước", "underwater swimming pool"),
    ("trên băng", "ice rink winter"),
    ("cầu thủ", "athlete player"),
    ("vận động viên", "athlete sportsman"),
    ("đang chạy", "running action"),
    ("đang nhảy", "jumping action"),
    ("sân cỏ", "green grass field"),
    ("khán đài", "stadium crowd"),
)


def expand_vietnamese_query(query: str) -> str:
    """Translate common Vietnamese sports/scene cues into English CLIP descriptors."""
    clean = query.strip()
    if not clean:
        return ""
    lowered = re.sub(r"\s+", " ", clean.lower())
    hints: list[str] = []
    for vi_phrase, en_hint in VI_EN_SPORTS_TERMS:
        if vi_phrase in lowered:
            hints.append(en_hint)
    if not hints:
        return clean
    return f"a sports photo of {' '.join(hints)} ({clean})"


@dataclass(frozen=True)
class SearchResultItem:
    image_id: int
    path: str
    width: int
    height: int
    taken_at: str | None
    label: str
    label_source: str
    top1_label: str
    top1_prob: float
    calibrated_prob: float | None
    status: str
    sharpness: float | None
    exposure: float | None
    similarity: float | None


def _build_filter_sql(
    *,
    label: str | None = None,
    status: str | None = None,
    source: str | None = None,
    min_conf: float | None = None,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if label:
        clauses.append("l.label = ?")
        params.append(label)
    if status:
        clauses.append("p.status = ?")
        params.append(status)
    if source:
        clauses.append("l.source = ?")
        params.append(source)
    if min_conf is not None:
        clauses.append("COALESCE(p.calibrated_prob, p.top1_prob) >= ?")
        params.append(float(min_conf))
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where_sql, params


def _fetch_allowed_ids(
    conn: sqlite3.Connection,
    *,
    label: str | None = None,
    status: str | None = None,
    source: str | None = None,
    min_conf: float | None = None,
) -> set[int] | None:
    if not any(v is not None and v != "" for v in (label, status, source, min_conf)):
        return None
    where_sql, params = _build_filter_sql(
        label=label, status=status, source=source, min_conf=min_conf
    )
    rows = conn.execute(
        f"""
        SELECT i.id
        FROM images i
        JOIN predictions p ON p.image_id = i.id
        JOIN labels l ON l.image_id = i.id
        {where_sql}
        """,
        params,
    ).fetchall()
    return {int(row["id"]) for row in rows}


def _hydrate_rows(
    conn: sqlite3.Connection,
    hits: list[tuple[int, float | None]],
) -> list[SearchResultItem]:
    if not hits:
        return []
    ids = [img_id for img_id, _ in hits]
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""
        SELECT
            i.id, i.path, i.width, i.height, i.taken_at, i.sharpness, i.exposure,
            p.top1_label, p.top1_prob, p.calibrated_prob, p.status,
            l.label AS effective_label, l.source AS label_source
        FROM images i
        JOIN predictions p ON p.image_id = i.id
        JOIN labels l ON l.image_id = i.id
        WHERE i.id IN ({placeholders})
        """,
        ids,
    ).fetchall()
    by_id = {int(row["id"]): row for row in rows}
    items: list[SearchResultItem] = []
    for img_id, sim in hits:
        row = by_id.get(img_id)
        if row is None:
            continue
        items.append(
            SearchResultItem(
                image_id=int(row["id"]),
                path=str(row["path"]),
                width=int(row["width"]),
                height=int(row["height"]),
                taken_at=row["taken_at"],
                label=str(row["effective_label"]),
                label_source=str(row["label_source"]),
                top1_label=str(row["top1_label"]),
                top1_prob=float(row["top1_prob"]),
                calibrated_prob=float(row["calibrated_prob"])
                if row["calibrated_prob"] is not None
                else None,
                status=str(row["status"]),
                sharpness=float(row["sharpness"]) if row["sharpness"] is not None else None,
                exposure=float(row["exposure"]) if row["exposure"] is not None else None,
                similarity=float(sim) if sim is not None else None,
            )
        )
    return items


def browse_images(
    conn: sqlite3.Connection,
    *,
    label: str | None = None,
    status: str | None = None,
    source: str | None = None,
    min_conf: float | None = None,
    limit: int = 48,
    offset: int = 0,
) -> tuple[list[SearchResultItem], int]:
    """Browse indexed library images filtered by metadata without a vector query."""
    where_sql, params = _build_filter_sql(
        label=label, status=status, source=source, min_conf=min_conf
    )
    total = int(
        conn.execute(
            f"""
            SELECT COUNT(*)
            FROM images i
            JOIN predictions p ON p.image_id = i.id
            JOIN labels l ON l.image_id = i.id
            {where_sql}
            """,
            params,
        ).fetchone()[0]
    )
    rows = conn.execute(
        f"""
        SELECT i.id
        FROM images i
        JOIN predictions p ON p.image_id = i.id
        JOIN labels l ON l.image_id = i.id
        {where_sql}
        ORDER BY i.id DESC
        LIMIT ? OFFSET ?
        """,
        [*params, int(limit), int(offset)],
    ).fetchall()
    return _hydrate_rows(conn, [(int(r["id"]), None) for r in rows]), total


def search_by_text(
    conn: sqlite3.Connection,
    index: VectorIndex,
    embedder: Embedder,
    query: str,
    *,
    k: int = 24,
    label: str | None = None,
    status: str | None = None,
    source: str | None = None,
    min_conf: float | None = None,
) -> tuple[list[SearchResultItem], str]:
    """Semantic text-to-image search with optional SQL hybrid filters."""
    expanded = expand_vietnamese_query(query)
    if not expanded:
        items, _ = browse_images(
            conn, label=label, status=status, source=source, min_conf=min_conf, limit=k
        )
        return items, ""
    allowed_ids = _fetch_allowed_ids(
        conn, label=label, status=status, source=source, min_conf=min_conf
    )
    if allowed_ids is not None and not allowed_ids:
        return [], expanded
    query_vec = embedder.embed_texts([expanded])[0]
    raw_hits = index.search(query_vec, k=k, allowed_ids=allowed_ids)
    return _hydrate_rows(conn, [(img_id, score) for img_id, score in raw_hits]), expanded


def search_similar_images(
    conn: sqlite3.Connection,
    index: VectorIndex,
    embedder: Embedder,
    *,
    image_id: int | None = None,
    query_image: Image.Image | None = None,
    k: int = 24,
    label: str | None = None,
    status: str | None = None,
    source: str | None = None,
    min_conf: float | None = None,
) -> list[SearchResultItem]:
    """Find visually/semantically similar images by existing image_id or uploaded image."""
    if image_id is not None:
        vec = index.get_vector(image_id) if hasattr(index, "get_vector") else None
        if vec is None:
            row = conn.execute("SELECT path FROM images WHERE id = ?", (image_id,)).fetchone()
            if row is None:
                raise ValueError(f"Unknown image_id: {image_id}")
            with Image.open(row["path"]) as src:
                vec = embedder.embed_images([src.convert("RGB")])[0]
    elif query_image is not None:
        vec = embedder.embed_images([query_image.convert("RGB")])[0]
    else:
        raise ValueError("Either image_id or query_image is required.")

    allowed_ids = _fetch_allowed_ids(
        conn, label=label, status=status, source=source, min_conf=min_conf
    )
    if allowed_ids is not None and not allowed_ids:
        return []
    fetch_k = k + (1 if image_id is not None else 0)
    raw_hits = index.search(vec, k=fetch_k, allowed_ids=allowed_ids)
    filtered = [
        (hit_id, score)
        for hit_id, score in raw_hits
        if image_id is None or hit_id != image_id
    ][:k]
    return _hydrate_rows(conn, filtered)
