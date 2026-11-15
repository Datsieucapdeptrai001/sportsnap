"""Tests for Phase 2 two-stage duplicate detection and best-shot quality scoring."""

from __future__ import annotations

from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sportsnap_lib.db import init_db, set_image_label, utc_now_iso  # noqa: E402
from sportsnap_lib.dedup import list_dup_groups, run_dedup, set_group_decision  # noqa: E402
from sportsnap_lib.ingest import compute_exposure, compute_sharpness  # noqa: E402
from sportsnap_lib.vector_index import NumpyVectorIndex  # noqa: E402
import imagehash  # noqa: E402


def _make_patterned_image() -> Image.Image:
    im = Image.new("RGB", (224, 224), (120, 140, 120))
    draw = ImageDraw.Draw(im)
    for x in range(20, 200, 24):
        draw.rectangle([x, 30, x + 12, 190], fill=(20, 200, 40), outline=(255, 255, 255))
    return im


def test_dedup_clusters_mirror_and_blur_and_picks_sharp_original(tmp_path: Path) -> None:
    conn = init_db(tmp_path / "library.db")
    try:
        sharp = _make_patterned_image()
        blurry = sharp.filter(ImageFilter.GaussianBlur(radius=4.0))
        mirrored = ImageOps.mirror(sharp)
        unrelated = Image.new("RGB", (224, 224), (20, 20, 200))

        variants = [
            ("sharp.jpg", sharp, 0.92, np.array([1.0, 0.0, 0.0], dtype=np.float32)),
            ("blurry.jpg", blurry, 0.55, np.array([0.99, 0.1, 0.0], dtype=np.float32)),
            ("mirrored.jpg", mirrored, 0.85, np.array([0.98, 0.1, 0.0], dtype=np.float32)),
            ("unrelated.jpg", unrelated, 0.90, np.array([0.0, 0.0, 1.0], dtype=np.float32)),
        ]

        idx = NumpyVectorIndex()
        now = utc_now_iso()
        ids: list[int] = []
        for name, im, conf, vec in variants:
            p = tmp_path / name
            im.save(p)
            arr = np.asarray(im, dtype=np.float32)
            cur = conn.execute(
                """
                INSERT INTO images (
                    path, sha1, width, height, taken_at, added_at,
                    thumb_path, phash, phash_mirror, sharpness, exposure
                )
                VALUES (?, ?, 224, 224, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(p),
                    name,
                    now,
                    str(p),
                    str(imagehash.phash(im)),
                    str(imagehash.phash(ImageOps.mirror(im))),
                    compute_sharpness(arr),
                    compute_exposure(arr),
                ),
            )
            img_id = int(cur.lastrowid)
            ids.append(img_id)
            conn.execute(
                """
                INSERT INTO predictions (image_id, model_version, probs_json, top1_label, top1_prob, calibrated_prob, status)
                VALUES (?, 'v1', '[1.0]', 'archery', ?, ?, 'auto')
                """,
                (img_id, conf, conf),
            )
            set_image_label(conn, img_id, "archery", "model")
            idx.add([img_id], vec[None, :])
        conn.commit()

        summary = run_dedup(conn, idx)
        assert summary.total_images == 4
        assert summary.num_groups == 1
        assert summary.duplicate_images == 3
        assert summary.archived_candidates == 2
        assert summary.reduction_rate == 0.5

        groups = list_dup_groups(conn)
        assert len(groups) == 1
        best = [m for m in groups[0]["members"] if m["is_best"]]
        assert len(best) == 1
        assert Path(best[0]["path"]).name == "sharp.jpg"

        # Manual override decision
        updated = set_group_decision(conn, groups[0]["group_id"], keep_all=True)
        assert all(m["user_decision"] == "keep" for m in updated["members"])
    finally:
        conn.close()
