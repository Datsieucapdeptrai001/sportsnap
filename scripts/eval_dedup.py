"""Evaluate two-stage duplicate clustering and best-shot selection on controlled bursts."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sportsnap_lib.config import LibrarySettings  # noqa: E402
from sportsnap_lib.db import init_db  # noqa: E402
from sportsnap_lib.dedup import list_dup_groups, run_dedup  # noqa: E402
from sportsnap_lib.embedder import FastEmbedClipEmbedder  # noqa: E402
from sportsnap_lib.ingest import ingest_directory  # noqa: E402
from sportsnap_lib.vector_index import NumpyVectorIndex  # noqa: E402


def build_synthetic_burst_suite(src_root: Path, out_dir: Path, max_originals: int = 12) -> tuple[dict[str, int], set[str]]:
    """Create originals + degraded/augmented duplicate variants + clean singletons."""
    sport_dirs = sorted(p for p in src_root.iterdir() if p.is_dir())
    originals: list[Path] = []
    singletons: list[Path] = []
    for idx, d in enumerate(sport_dirs):
        imgs = sorted(d.glob("*.jpg"))
        if not imgs:
            continue
        if len(originals) < max_originals:
            originals.append(imgs[0])
            if len(imgs) > 1:
                singletons.append(imgs[1])
        else:
            singletons.append(imgs[0])

    expected_cluster: dict[str, int] = {}
    clean_orig_names: set[str] = set()

    for cid, orig in enumerate(originals):
        with Image.open(orig) as im:
            rgb = im.convert("RGB")
            orig_name = f"g{cid:02d}_0_orig.jpg"
            rgb.save(out_dir / orig_name, quality=95)
            expected_cluster[orig_name] = cid
            clean_orig_names.add(orig_name)

            # Variant 1: blurred shot
            blur = rgb.filter(ImageFilter.GaussianBlur(radius=2.5))
            blur_name = f"g{cid:02d}_1_blur.jpg"
            blur.save(out_dir / blur_name, quality=85)
            expected_cluster[blur_name] = cid

            # Variant 2: overexposed + slight crop
            w, h = rgb.size
            crop = rgb.crop((int(w * 0.05), int(h * 0.05), int(w * 0.95), int(h * 0.95))).resize((w, h))
            bright = ImageEnhance.Brightness(crop).enhance(1.65)
            bright_name = f"g{cid:02d}_2_brightcrop.jpg"
            bright.save(out_dir / bright_name, quality=85)
            expected_cluster[bright_name] = cid

            # Variant 3: mirrored copy
            mir = ImageOps.mirror(rgb)
            mir_name = f"g{cid:02d}_3_mirror.jpg"
            mir.save(out_dir / mir_name, quality=90)
            expected_cluster[mir_name] = cid

    for s_idx, single in enumerate(singletons[:8]):
        with Image.open(single) as im:
            name = f"singleton_{s_idx:02d}.jpg"
            im.convert("RGB").save(out_dir / name, quality=92)
            expected_cluster[name] = 1000 + s_idx

    return expected_cluster, clean_orig_names


def main() -> None:
    base_settings = LibrarySettings()
    base_settings.ensure_dirs()
    embedder = FastEmbedClipEmbedder()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        img_dir = tmp_path / "imgs"
        img_dir.mkdir()
        expected_cluster, clean_originals = build_synthetic_burst_suite(base_settings.external_dir, img_dir)

        sim_settings = LibrarySettings(
            data_dir=tmp_path / "data",
            db_path=tmp_path / "data" / "library.db",
            index_dir=tmp_path / "data" / "index",
            thumbs_dir=tmp_path / "data" / "thumbs",
            registry_dir=tmp_path / "data" / "models_registry",
        )
        conn = init_db(sim_settings.db_path)
        try:
            vec_index = NumpyVectorIndex()
            ingest_summary = ingest_directory(
                img_dir, conn, sim_settings, embedder=embedder, index=vec_index
            )
            dedup_summary = run_dedup(conn, vec_index)
            groups = list_dup_groups(conn)
        finally:
            conn.close()

        # Compute pairwise duplicate detection Precision / Recall / F1
        pred_cluster: dict[str, int] = {}
        best_hits = 0
        total_orig_groups = 0
        for g in groups:
            gid = g["group_id"]
            names = [Path(m["path"]).name for m in g["members"]]
            for nm in names:
                pred_cluster[nm] = gid
            best_names = [Path(m["path"]).name for m in g["members"] if m["is_best"]]
            if any(nm in clean_originals for nm in names):
                total_orig_groups += 1
                if best_names and (best_names[0] in clean_originals or "mirror" in best_names[0]):
                    best_hits += 1

        all_names = sorted(expected_cluster.keys())
        tp = fp = fn = 0
        for i in range(len(all_names)):
            for j in range(i + 1, len(all_names)):
                ni, nj = all_names[i], all_names[j]
                same_true = expected_cluster[ni] == expected_cluster[nj]
                same_pred = (ni in pred_cluster and nj in pred_cluster and pred_cluster[ni] == pred_cluster[nj])
                if same_true and same_pred:
                    tp += 1
                elif not same_true and same_pred:
                    fp += 1
                elif same_true and not same_pred:
                    fn += 1

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        best_acc = best_hits / total_orig_groups if total_orig_groups > 0 else 0.0

        report = {
            "total_images": ingest_summary.newly_indexed,
            "num_groups_detected": dedup_summary.num_groups,
            "archived_candidates": dedup_summary.archived_candidates,
            "reduction_rate": round(dedup_summary.reduction_rate, 4),
            "pairwise_precision": round(precision, 4),
            "pairwise_recall": round(recall, 4),
            "pairwise_f1": round(f1, 4),
            "best_shot_accuracy": round(best_acc, 4),
        }
        out_path = base_settings.data_dir / "eval_dedup.json"
        out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
