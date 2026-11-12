"""Two-stage duplicate clustering (pHash + CLIP cosine) and best-shot quality scoring."""

from __future__ import annotations

from dataclasses import dataclass
import json
import sqlite3
from typing import Any

import imagehash
import numpy as np

from sportsnap_lib.db import utc_now_iso
from sportsnap_lib.vector_index import NumpyVectorIndex, VectorIndex, l2_normalize


@dataclass(frozen=True)
class DedupSummary:
    total_images: int
    num_groups: int
    duplicate_images: int
    archived_candidates: int
    reduction_rate: float


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if ra < rb:
                self.parent[rb] = ra
            else:
                self.parent[ra] = rb


def _safe_phash(value: str | None) -> imagehash.ImageHash | None:
    if not value:
        return None
    try:
        return imagehash.hex_to_hash(value)
    except Exception:
        return None


def _normalize_group_values(values: list[float]) -> list[float]:
    lo = min(values)
    hi = max(values)
    if hi - lo <= 1e-9:
        return [1.0 if hi > 0 else 0.0 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


def run_dedup(
    conn: sqlite3.Connection,
    index: VectorIndex | None = None,
    *,
    phash_threshold: int = 8,
    clip_threshold: float = 0.92,
    w_sharpness: float = 0.45,
    w_exposure: float = 0.25,
    w_confidence: float = 0.30,
) -> DedupSummary:
    """Cluster duplicate/burst images, score quality, and persist dup_groups/dup_members."""
    rows = conn.execute(
        """
        SELECT
            i.id, i.phash, i.phash_mirror, i.sharpness, i.exposure,
            COALESCE(p.calibrated_prob, p.top1_prob, 0.0) AS conf
        FROM images i
        LEFT JOIN predictions p ON p.image_id = i.id
        ORDER BY i.id ASC
        """
    ).fetchall()

    n = len(rows)
    conn.execute("DELETE FROM dup_members")
    conn.execute("DELETE FROM dup_groups")
    if n < 2:
        conn.commit()
        return DedupSummary(
            total_images=n,
            num_groups=0,
            duplicate_images=0,
            archived_candidates=0,
            reduction_rate=0.0,
        )

    ids = [int(r["id"]) for r in rows]
    phashes = [_safe_phash(r["phash"]) for r in rows]
    pmirrors = [_safe_phash(r["phash_mirror"]) for r in rows]
    uf = _UnionFind(n)

    # Stage A: Perceptual hash (exact, resized, cropped, mirrored)
    for i in range(n):
        hi = phashes[i]
        if hi is None:
            continue
        for j in range(i + 1, n):
            hj = phashes[j]
            if hj is None:
                continue
            dist = hi - hj
            if pmirrors[j] is not None:
                dist = min(dist, hi - pmirrors[j])
            if dist <= phash_threshold:
                uf.union(i, j)

    # Stage B: CLIP semantic cosine similarity (burst shots / slight angle shifts)
    if isinstance(index, NumpyVectorIndex) and index.vectors is not None and index.size > 0:
        id_to_vec_pos = {img_id: pos for pos, img_id in enumerate(index.ids)}
        ordered_indices: list[int] = []
        ordered_vecs: list[np.ndarray] = []
        for idx_i, img_id in enumerate(ids):
            vec_pos = id_to_vec_pos.get(img_id)
            if vec_pos is not None:
                ordered_indices.append(idx_i)
                ordered_vecs.append(index.vectors[vec_pos])
        if len(ordered_vecs) >= 2:
            mat = l2_normalize(np.stack(ordered_vecs, axis=0))
            sim = mat @ mat.T
            m = len(ordered_indices)
            rows_idx, cols_idx = np.where(np.triu(sim >= clip_threshold, k=1))
            for r_i, c_i in zip(rows_idx.tolist(), cols_idx.tolist()):
                if r_i < m and c_i < m:
                    uf.union(ordered_indices[r_i], ordered_indices[c_i])

    components: dict[int, list[int]] = {}
    for i in range(n):
        root = uf.find(i)
        components.setdefault(root, []).append(i)

    dup_clusters = [members for members in components.values() if len(members) >= 2]
    params_json = json.dumps(
        {
            "phash_threshold": phash_threshold,
            "clip_threshold": clip_threshold,
            "weights": {
                "sharpness": w_sharpness,
                "exposure": w_exposure,
                "confidence": w_confidence,
            },
        }
    )
    now = utc_now_iso()
    duplicate_images = 0

    for cluster in dup_clusters:
        cur = conn.execute(
            "INSERT INTO dup_groups (params_json, created_at) VALUES (?, ?)",
            (params_json, now),
        )
        group_id = int(cur.lastrowid)

        raw_sharp = [float(rows[idx]["sharpness"] or 0.0) for idx in cluster]
        norm_sharp = _normalize_group_values(raw_sharp)
        raw_exp = [float(rows[idx]["exposure"] or 0.0) for idx in cluster]
        raw_conf = [float(rows[idx]["conf"] or 0.0) for idx in cluster]

        scored: list[tuple[int, float, float, float, float]] = []
        for pos, idx in enumerate(cluster):
            s_sharp = norm_sharp[pos]
            s_exp = float(np.clip(raw_exp[pos], 0.0, 1.0))
            s_conf = float(np.clip(raw_conf[pos], 0.0, 1.0))
            total = (
                w_sharpness * s_sharp + w_exposure * s_exp + w_confidence * s_conf
            )
            scored.append((ids[idx], total, s_sharp, s_exp, s_conf))

        best_id = max(scored, key=lambda item: (item[1], item[2], -item[0]))[0]
        for img_id, total, s_sharp, s_exp, s_conf in scored:
            is_best = 1 if img_id == best_id else 0
            conn.execute(
                """
                INSERT INTO dup_members (
                    group_id, image_id, score_total, score_sharpness,
                    score_exposure, score_conf, is_best, user_decision
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    group_id,
                    img_id,
                    total,
                    s_sharp,
                    s_exp,
                    s_conf,
                    is_best,
                    "keep" if is_best else "archive",
                ),
            )
        duplicate_images += len(cluster)

    conn.commit()
    archived_candidates = duplicate_images - len(dup_clusters)
    reduction_rate = archived_candidates / n if n > 0 else 0.0
    return DedupSummary(
        total_images=n,
        num_groups=len(dup_clusters),
        duplicate_images=duplicate_images,
        archived_candidates=archived_candidates,
        reduction_rate=float(reduction_rate),
    )


def list_dup_groups(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return all persisted duplicate clusters with their scored image members."""
    groups = conn.execute(
        "SELECT group_id, params_json, created_at FROM dup_groups ORDER BY group_id ASC"
    ).fetchall()
    output: list[dict[str, Any]] = []
    for g in groups:
        gid = int(g["group_id"])
        members = conn.execute(
            """
            SELECT
                m.image_id, m.score_total, m.score_sharpness, m.score_exposure,
                m.score_conf, m.is_best, m.user_decision,
                i.path, i.width, i.height, l.label, p.top1_prob, p.calibrated_prob
            FROM dup_members m
            JOIN images i ON i.id = m.image_id
            LEFT JOIN labels l ON l.image_id = i.id
            LEFT JOIN predictions p ON p.image_id = i.id
            WHERE m.group_id = ?
            ORDER BY m.is_best DESC, m.score_total DESC, m.image_id ASC
            """,
            (gid,),
        ).fetchall()
        output.append(
            {
                "group_id": gid,
                "created_at": str(g["created_at"]),
                "members": [
                    {
                        "image_id": int(m["image_id"]),
                        "path": str(m["path"]),
                        "width": int(m["width"]),
                        "height": int(m["height"]),
                        "label": str(m["label"] or ""),
                        "confidence": float(
                            m["calibrated_prob"]
                            if m["calibrated_prob"] is not None
                            else (m["top1_prob"] or 0.0)
                        ),
                        "score_total": float(m["score_total"]),
                        "score_sharpness": float(m["score_sharpness"]),
                        "score_exposure": float(m["score_exposure"]),
                        "score_conf": float(m["score_conf"]),
                        "is_best": bool(m["is_best"]),
                        "user_decision": m["user_decision"],
                    }
                    for m in members
                ],
            }
        )
    return output


def set_group_decision(
    conn: sqlite3.Connection,
    group_id: int,
    best_image_id: int | None = None,
    *,
    keep_all: bool = False,
) -> dict[str, Any]:
    """Update keep/archive decisions for a duplicate cluster."""
    rows = conn.execute(
        "SELECT image_id FROM dup_members WHERE group_id = ?", (group_id,)
    ).fetchall()
    if not rows:
        raise ValueError(f"Unknown duplicate group: {group_id}")
    member_ids = {int(r["image_id"]) for r in rows}
    if keep_all:
        conn.execute(
            "UPDATE dup_members SET user_decision = 'keep' WHERE group_id = ?",
            (group_id,),
        )
    else:
        if best_image_id is None or best_image_id not in member_ids:
            raise ValueError(f"Image {best_image_id} does not belong to group {group_id}")
        conn.execute(
            "UPDATE dup_members SET user_decision = 'archive', is_best = 0 WHERE group_id = ?",
            (group_id,),
        )
        conn.execute(
            "UPDATE dup_members SET user_decision = 'keep', is_best = 1 WHERE group_id = ? AND image_id = ?",
            (group_id, best_image_id),
        )
    conn.commit()
    return next(g for g in list_dup_groups(conn) if g["group_id"] == group_id)
