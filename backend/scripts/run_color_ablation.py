"""Run reproducible Color Ablation (RGB vs Grayscale vs R-B Channel Swap) on the clean 500-image test set.

Answers the core research question on how much court/environment/uniform color contributes
to classification decisions across MobileNetV2, ResNet50, and CNN_Scratch.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from sklearn.metrics import accuracy_score, f1_score


SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def load_test_dataset(
    test_dir: Path,
    labels: list[str],
    image_size: tuple[int, int] = (224, 224),
) -> tuple[np.ndarray, np.ndarray]:
    """Load RGB float32 images matching tf.keras.utils.image_dataset_from_directory bilinear resize."""
    images: list[np.ndarray] = []
    targets: list[int] = []
    for idx, label in enumerate(labels):
        class_dir = test_dir / label
        if not class_dir.is_dir():
            raise FileNotFoundError(f"Missing class directory in test split: {class_dir}")
        files = sorted(
            p for p in class_dir.iterdir()
            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
        )
        for path in files:
            with Image.open(path) as img:
                rgb = img.convert("RGB").resize(image_size, Image.Resampling.BILINEAR)
                images.append(np.asarray(rgb, dtype=np.float32))
                targets.append(idx)
    if not images:
        raise ValueError(f"No test images found under {test_dir}")
    return np.stack(images, axis=0), np.asarray(targets, dtype=np.int64)


def to_grayscale_rgb(x_rgb: np.ndarray) -> np.ndarray:
    """Convert RGB [0..255] batch to 3-channel ITU-R BT.601 luminance grayscale [0..255]."""
    lum = (
        0.299 * x_rgb[..., 0]
        + 0.587 * x_rgb[..., 1]
        + 0.114 * x_rgb[..., 2]
    )
    return np.stack([lum, lum, lum], axis=-1).astype(np.float32)


def to_rb_swapped(x_rgb: np.ndarray) -> np.ndarray:
    """Swap Red and Blue channels (R <-> B) to destroy semantic court/uniform color while preserving edges."""
    return x_rgb[..., ::-1].copy()


def preprocess_for_mode(x_rgb: np.ndarray, mode: str) -> np.ndarray:
    import tensorflow as tf

    if mode == "mobilenet_v2":
        return tf.keras.applications.mobilenet_v2.preprocess_input(x_rgb.copy())
    if mode == "resnet50":
        return tf.keras.applications.resnet50.preprocess_input(x_rgb.copy())
    if mode == "none":
        return x_rgb.astype(np.float32, copy=True)
    raise ValueError(f"Unsupported preprocess mode: {mode}")


def evaluate_condition(
    model: Any,
    x_raw: np.ndarray,
    y_true: np.ndarray,
    labels: list[str],
    preprocess_mode: str,
    batch_size: int = 32,
) -> dict[str, Any]:
    x_prep = preprocess_for_mode(x_raw, preprocess_mode)
    probs = np.asarray(model.predict(x_prep, batch_size=batch_size, verbose=0), dtype=np.float32)
    y_pred = np.argmax(probs, axis=1)
    acc = float(accuracy_score(y_true, y_pred))
    macro_f1 = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
    per_class: dict[str, float] = {}
    for idx, label in enumerate(labels):
        mask = y_true == idx
        per_class[label] = round(float(np.mean(y_pred[mask] == y_true[mask])), 4) if np.any(mask) else 0.0
    return {
        "accuracy": round(acc, 4),
        "macro_f1": round(macro_f1, 4),
        "correct": int(np.sum(y_pred == y_true)),
        "total": int(len(y_true)),
        "per_class": per_class,
    }


def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        if bold
        else ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    for fp in candidates:
        if Path(fp).is_file():
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


def render_chart(summary: dict[str, Any], out_path: Path) -> None:
    """Render crisp 2-panel Vietnamese figure using Pillow (zero extra dependencies)."""
    W, H = 1600, 740
    img = Image.new("RGB", (W, H), "#ffffff")
    draw = ImageDraw.Draw(img)

    f_title = _load_font(26, bold=True)
    f_sub = _load_font(18, bold=True)
    f_lbl = _load_font(15, bold=False)
    f_lbl_b = _load_font(15, bold=True)
    f_small = _load_font(13, bold=False)
    f_small_b = _load_font(13, bold=True)

    # Main title
    draw.text(
        (40, 22),
        "Thí nghiệm Color Ablation — Đánh giá vai trò màu sắc / màu sân (500 ảnh test sạch)",
        fill="#0f172a",
        font=f_title,
    )
    draw.line((40, 64, W - 40, 64), fill="#e2e8f0", width=2)

    # ---------- Panel A: 3-model grouped bar chart ----------
    ax_x0, ax_y0, ax_x1, ax_y1 = 90, 130, 700, 600
    draw.text((40, 82), "A. So sánh Accuracy 3 mô hình khi mất / đổi màu (%)", fill="#0f172a", font=f_sub)

    for pct in (0, 20, 40, 60, 80, 100):
        y = int(ax_y1 - (pct / 100.0) * (ax_y1 - ax_y0))
        draw.line((ax_x0, y, ax_x1, y), fill="#e2e8f0" if pct > 0 else "#475569", width=1 if pct > 0 else 2)
        draw.text((ax_x0 - 46, y - 9), f"{pct}%", fill="#475569", font=f_small)
    draw.line((ax_x0, ax_y0, ax_x0, ax_y1), fill="#475569", width=2)

    models = summary["models"]
    colors = [("#10b981", "Ảnh màu gốc (RGB)"), ("#64748b", "Ảnh xám (Grayscale)"), ("#f59e0b", "Hoán đổi kênh (R↔B)")]
    group_w = (ax_x1 - ax_x0) / max(1, len(models))
    bar_w = 42

    for idx, m in enumerate(models):
        cx = ax_x0 + group_w * (idx + 0.5)
        vals = [
            m["rgb_orig"]["accuracy"] * 100.0,
            m["grayscale"]["accuracy"] * 100.0,
            m["rb_swap"]["accuracy"] * 100.0,
        ]
        offsets = [-bar_w - 6, 0, bar_w + 6]
        for val, off, (col, _) in zip(vals, offsets, colors):
            bx0 = int(cx + off - bar_w / 2)
            bx1 = int(cx + off + bar_w / 2)
            by0 = int(ax_y1 - (val / 100.0) * (ax_y1 - ax_y0))
            draw.rounded_rectangle((bx0, by0, bx1, ax_y1), radius=4, fill=col)
            txt = f"{val:.1f}%"
            tw = draw.textlength(txt, font=f_small_b)
            draw.text((bx0 + (bar_w - tw) / 2, by0 - 20), txt, fill="#0f172a", font=f_small_b)

        name = m["name"]
        nw = draw.textlength(name, font=f_lbl_b)
        draw.text((cx - nw / 2, ax_y1 + 12), name, fill="#0f172a", font=f_lbl_b)
        drop_txt = f"Xám: -{m['grayscale_drop_pp']:.1f} | R↔B: -{m['rb_swap_drop_pp']:.1f} đ.p.t"
        dw = draw.textlength(drop_txt, font=f_small)
        draw.text((cx - dw / 2, ax_y1 + 36), drop_txt, fill="#475569", font=f_small)

    # Legend Panel A
    leg_x, leg_y = 90, 675
    for col, label in colors:
        draw.rounded_rectangle((leg_x, leg_y, leg_x + 18, leg_y + 18), radius=3, fill=col)
        draw.text((leg_x + 26, leg_y - 1), label, fill="#0f172a", font=f_lbl)
        leg_x += int(draw.textlength(label, font=f_lbl)) + 52

    # ---------- Panel B: Top 12 color-sensitive classes (MobileNetV2) ----------
    bx_x0, bx_y0, bx_x1, bx_y1 = 960, 130, 1525, 610
    draw.text((760, 82), "B. 12 lớp nhạy cảm màu sắc nhất (MobileNetV2 · giảm đ.p.t)", fill="#0f172a", font=f_sub)

    mnv2_rows = sorted(
        summary["per_class_mobilenet_v2"],
        key=lambda row: (max(row["grayscale_drop_pp"], row["rb_swap_drop_pp"]), row["grayscale_drop_pp"] + row["rb_swap_drop_pp"]),
        reverse=True,
    )[:12]
    max_drop = max(
        20.0,
        max((max(r["grayscale_drop_pp"], r["rb_swap_drop_pp"]) for r in mnv2_rows), default=20.0),
    )
    max_scale = float(int((max_drop + 19) // 20) * 20)

    for tick in range(0, int(max_scale) + 1, 20):
        tx = int(bx_x0 + (tick / max_scale) * (bx_x1 - bx_x0))
        draw.line((tx, bx_y0, tx, bx_y1), fill="#e2e8f0" if tick > 0 else "#475569", width=1 if tick > 0 else 2)
        t_str = f"{tick}"
        tw = draw.textlength(t_str, font=f_small)
        draw.text((tx - tw / 2, bx_y1 + 6), t_str, fill="#475569", font=f_small)
    draw.text((bx_x0 + 100, bx_y1 + 26), "Mức sụt giảm Accuracy so với ảnh gốc (điểm phần trăm)", fill="#475569", font=f_small)

    row_h = (bx_y1 - bx_y0) / max(1, len(mnv2_rows))
    for i, row in enumerate(mnv2_rows):
        ry = bx_y0 + i * row_h + row_h * 0.5
        cname = row["class_name"]
        cw = draw.textlength(cname, font=f_lbl)
        draw.text((bx_x0 - cw - 12, ry - 10), cname, fill="#0f172a", font=f_lbl)

        gd = max(0.0, float(row["grayscale_drop_pp"]))
        sd = max(0.0, float(row["rb_swap_drop_pp"]))
        # Grayscale bar (top half)
        gx1 = int(bx_x0 + (gd / max_scale) * (bx_x1 - bx_x0))
        if gx1 > bx_x0:
            draw.rounded_rectangle((bx_x0, int(ry - 13), gx1, int(ry - 1)), radius=2, fill="#64748b")
        if row["grayscale_drop_pp"] > 0:
            draw.text((max(gx1, bx_x0) + 6, int(ry - 15)), f"-{row['grayscale_drop_pp']:.0f}", fill="#334155", font=f_small)
        # R<->B swap bar (bottom half)
        sx1 = int(bx_x0 + (sd / max_scale) * (bx_x1 - bx_x0))
        if sx1 > bx_x0:
            draw.rounded_rectangle((bx_x0, int(ry + 1), sx1, int(ry + 13)), radius=2, fill="#f59e0b")
        if row["rb_swap_drop_pp"] > 0:
            draw.text((max(sx1, bx_x0) + 6, int(ry)), f"-{row['rb_swap_drop_pp']:.0f}", fill="#b45309", font=f_small_b)

    # Legend Panel B
    draw.rounded_rectangle((960, 678, 978, 696), radius=3, fill="#64748b")
    draw.text((986, 677), "Giảm khi chuyển ảnh xám", fill="#0f172a", font=f_lbl)
    draw.rounded_rectangle((1210, 678, 1228, 696), radius=3, fill="#f59e0b")
    draw.text((1236, 677), "Giảm khi hoán đổi kênh R↔B", fill="#0f172a", font=f_lbl)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="PNG")


def main() -> None:
    project_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-dir", type=Path, default=project_root / "datasets/sports-classification/test")
    parser.add_argument("--labels", type=Path, default=project_root / "backend/models/labels.json")
    parser.add_argument("--mobilenet", type=Path, default=project_root / "backend/models/best_model.keras")
    parser.add_argument("--resnet", type=Path, default=project_root / "models/ResNet50_finetune_best.keras")
    parser.add_argument("--cnn", type=Path, default=project_root / "models/cnn_scratch_best.keras")
    parser.add_argument("--output-json", type=Path, default=project_root / "backend/data/color_ablation.json")
    parser.add_argument("--output-chart", type=Path, default=project_root / "backend/data/insights/color_ablation_chart.png")
    args = parser.parse_args()

    import tensorflow as tf

    labels: list[str] = json.loads(args.labels.read_text(encoding="utf-8-sig"))
    x_rgb, y_true = load_test_dataset(args.test_dir, labels)
    x_gray = to_grayscale_rgb(x_rgb)
    x_swap = to_rb_swapped(x_rgb)

    specs = [
        ("MobileNetV2", args.mobilenet, "mobilenet_v2"),
        ("ResNet50", args.resnet, "resnet50"),
        ("CNN_Scratch", args.cnn, "none"),
    ]

    model_results: list[dict[str, Any]] = []
    mnv2_per_class: list[dict[str, Any]] = []

    for name, ckpt, mode in specs:
        if not ckpt.is_file():
            raise FileNotFoundError(f"Model checkpoint not found: {ckpt}")
        print(f"Evaluating {name} ({ckpt.name}) on {len(y_true)} test images...", flush=True)
        model = tf.keras.models.load_model(ckpt, compile=False)
        res_orig = evaluate_condition(model, x_rgb, y_true, labels, mode)
        res_gray = evaluate_condition(model, x_gray, y_true, labels, mode)
        res_swap = evaluate_condition(model, x_swap, y_true, labels, mode)
        gray_drop_pp = round((res_orig["accuracy"] - res_gray["accuracy"]) * 100, 2)
        swap_drop_pp = round((res_orig["accuracy"] - res_swap["accuracy"]) * 100, 2)
        print(
            f"  {name:12s} | RGB={res_orig['accuracy']:.4f} | Gray={res_gray['accuracy']:.4f} "
            f"(-{gray_drop_pp:.2f} pp) | R<->B={res_swap['accuracy']:.4f} (-{swap_drop_pp:.2f} pp)",
            flush=True,
        )
        model_results.append({
            "name": name,
            "checkpoint": ckpt.name,
            "rgb_orig": {k: v for k, v in res_orig.items() if k != "per_class"},
            "grayscale": {k: v for k, v in res_gray.items() if k != "per_class"},
            "rb_swap": {k: v for k, v in res_swap.items() if k != "per_class"},
            "grayscale_drop_pp": gray_drop_pp,
            "rb_swap_drop_pp": swap_drop_pp,
        })
        if name == "MobileNetV2":
            for label in labels:
                o = res_orig["per_class"][label]
                g = res_gray["per_class"][label]
                s = res_swap["per_class"][label]
                mnv2_per_class.append({
                    "class_name": label,
                    "rgb_orig": o,
                    "grayscale": g,
                    "rb_swap": s,
                    "grayscale_drop_pp": round((o - g) * 100, 2),
                    "rb_swap_drop_pp": round((o - s) * 100, 2),
                })
        tf.keras.backend.clear_session()

    summary: dict[str, Any] = {
        "n_test": int(len(y_true)),
        "num_classes": len(labels),
        "split": "test",
        "conditions": [
            "rgb_orig (ảnh màu RGB gốc 224x224)",
            "grayscale (ảnh xám 3 kênh độ chói ITU-R BT.601 — loại bỏ màu sắc, giữ biên & độ sáng)",
            "rb_swap (hoán đổi kênh R<->B — làm sai màu sân/trang phục, giữ nguyên độ tương phản & hình dạng)",
        ],
        "models": model_results,
        "per_class_mobilenet_v2": mnv2_per_class,
        "chart_image": args.output_chart.name,
    }

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    render_chart(summary, args.output_chart)
    print(f"Saved JSON -> {args.output_json}")
    print(f"Saved Chart -> {args.output_chart}")


if __name__ == "__main__":
    main()
