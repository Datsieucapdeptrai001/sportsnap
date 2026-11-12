"""Fetch verified real-world sports action replacement candidates from Wikimedia Commons."""

from __future__ import annotations

import csv
import json
from io import BytesIO
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageOps

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sportsnap_lib.embedder import FastEmbedClipEmbedder  # noqa: E402

USER_AGENT = "SportSnapAcademicProject/1.0 (https://github.com/Datsieucapdeptrai001/sportsnap)"

TARGETS: dict[str, list[str]] = {
    "archery": ["5.jpg"],
    "basketball": ["1.jpg"],
    "field hockey": ["3.jpg"],
    "figure skating women": ["4.jpg"],
    "formula 1 racing": ["2.jpg", "4.jpg"],
    "golf": ["1.jpg", "2.jpg", "4.jpg"],
    "high jump": ["4.jpg"],
    "hockey": ["3.jpg", "4.jpg"],
    "olympic wrestling": ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"],
    "swimming": ["1.jpg", "2.jpg"],
    "tennis": ["1.jpg", "2.jpg"],
    "uneven bars": ["1.jpg", "5.jpg"],
}

SEARCH_QUERIES: dict[str, list[str]] = {
    "archery": ["archery competition bow arrow olympics", "archery archer shooting target"],
    "basketball": ["basketball game dunk match players", "basketball nba match court"],
    "field hockey": ["field hockey match players stick", "women field hockey olympics match"],
    "figure skating women": ["figure skating ladies olympics ice", "women figure skating competition"],
    "formula 1 racing": ["formula 1 race car track gp", "formula one racing car circuit"],
    "golf": ["golfer swinging club golf course", "golf tournament swing player"],
    "high jump": ["high jump athlete clearing bar", "high jump track and field olympics"],
    "hockey": ["ice hockey game match players", "nhl ice hockey player puck"],
    "olympic wrestling": ["freestyle wrestling olympic mat", "greco roman wrestling olympics match"],
    "swimming": ["swimming competition pool swimmer", "olympic swimming freestyle race"],
    "tennis": ["tennis player hitting ball match", "wimbledon tennis match action"],
    "uneven bars": ["uneven bars artistic gymnastics", "gymnast on uneven bars olympics"],
}

BLOCKED_TITLE_WORDS = (
    "portrait",
    "podium",
    "medal",
    "ceremony",
    "building",
    "exterior",
    "facade",
    "grandstand",
    "scoreboard",
    "trophy",
    "logo",
    "poster",
    "wwe",
    "raw",
    "smackdown",
    "netball",
    "stadium_outside",
    "arena_inside",
    "sign",
    "map",
    "diagram",
)


def commons_search(query: str, limit: int = 25) -> list[dict[str, str]]:
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrnamespace": "6",
            "gsrsearch": f"{query} filetype:bitmap",
            "gsrlimit": str(limit),
            "prop": "imageinfo",
            "iiprop": "url|mime|size",
            "iiurlwidth": "640",
        }
    )
    url = f"https://commons.wikimedia.org/w/api.php?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    pages = data.get("query", {}).get("pages", {})
    results: list[dict[str, str]] = []
    for page in pages.values():
        title = page.get("title", "")
        low = title.lower()
        if any(bad in low for bad in BLOCKED_TITLE_WORDS):
            continue
        infos = page.get("imageinfo", [])
        if not infos:
            continue
        info = infos[0]
        mime = info.get("mime", "")
        if mime not in {"image/jpeg", "image/png", "image/webp"}:
            continue
        thumb_url = info.get("thumburl") or info.get("url")
        if not thumb_url:
            continue
        results.append(
            {
                "title": title,
                "url": thumb_url,
            }
        )
    return results


def download_image(url: str) -> Image.Image | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
        with Image.open(BytesIO(raw)) as src:
            rgb = ImageOps.exif_transpose(src).convert("RGB")
            if min(rgb.size) < 160:
                return None
            return rgb.copy()
    except Exception:
        return None


def main() -> None:
    staging = Path(sys.argv[1]) if len(sys.argv) > 1 else PROJECT_ROOT / "tmp_clean_candidates"
    staging.mkdir(parents=True, exist_ok=True)

    sources_path = PROJECT_ROOT / "datasets" / "anh-ngoai" / "sources.csv"
    existing_urls: set[str] = set()
    with open(sources_path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("source_url"):
                existing_urls.add(r["source_url"].split("?")[0])

    clip = FastEmbedClipEmbedder()
    manifest: list[dict[str, str]] = []

    for sport, filenames in TARGETS.items():
        needed = len(filenames)
        pool: list[dict[str, str]] = []
        seen_titles: set[str] = set()
        for q in SEARCH_QUERIES[sport]:
            for item in commons_search(q, limit=25):
                base_url = item["url"].split("?")[0]
                if item["title"] in seen_titles or base_url in existing_urls:
                    continue
                seen_titles.add(item["title"])
                pool.append(item)
            time.sleep(0.25)

        downloaded: list[tuple[dict[str, str], Image.Image]] = []
        for item in pool[:18]:
            im = download_image(item["url"])
            if im is not None:
                downloaded.append((item, im))
            time.sleep(0.15)

        if not downloaded:
            print(f"WARN: no candidates for {sport}")
            continue

        # Score against positive sport action prompt minus anti-portrait/empty prompt
        pos_vec = clip.embed_texts([f"a sports action photograph of athletes playing {sport}"])[0]
        neg_vec = clip.embed_texts(["an empty stadium, building facade, or static headshot portrait"])[0]
        img_vecs = clip.embed_images([im for _, im in downloaded])
        scores = (img_vecs @ pos_vec) - 0.5 * (img_vecs @ neg_vec)
        order = np.argsort(-scores)

        sport_dir = staging / sport
        sport_dir.mkdir(parents=True, exist_ok=True)
        for slot_idx, fname in enumerate(filenames):
            if slot_idx >= len(order):
                break
            cand_idx = int(order[slot_idx])
            meta, im = downloaded[cand_idx]
            resized = im.resize((224, 224), Image.Resampling.LANCZOS)
            out_file = sport_dir / fname
            resized.save(out_file, format="JPEG", quality=92)
            manifest.append(
                {
                    "sport": sport,
                    "filename": fname,
                    "title": meta["title"],
                    "source_url": meta["url"],
                    "clip_score": f"{float(scores[cand_idx]):.3f}",
                    "staged_path": str(out_file),
                }
            )
            print(f"STAGED | {sport}/{fname} | score={float(scores[cand_idx]):.3f} | {meta['title']}")

    (staging / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Total staged: {len(manifest)} / {sum(len(v) for v in TARGETS.values())}")


if __name__ == "__main__":
    main()
