"""Explicitly generate regression fixtures; never called by the test suite."""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from pydantic import TypeAdapter

from app.core.config import Settings
from app.main import load_keras_model


GOLDEN_DIR = Path(__file__).resolve().parent


def synthetic_images() -> list[tuple[str, Image.Image]]:
    """Deterministic non-sport patterns, used only when no dataset is supplied."""
    y, x = np.mgrid[:224, :224]
    gradient = np.broadcast_to(np.linspace(0, 255, 224, dtype=np.uint8), (224, 224))
    patterns: list[tuple[str, np.ndarray]] = [
        ("red_gradient", np.stack((gradient, gradient // 3, gradient // 5), axis=-1)),
        ("green_gradient", np.stack((gradient // 5, gradient, gradient // 3), axis=-1)),
        ("blue_gradient", np.stack((gradient // 3, gradient // 5, gradient), axis=-1)),
        ("checkerboard", (((x // 16 + y // 16) % 2) * 255).astype(np.uint8)),
        ("diagonal_stripes", (((x + y) // 12 % 2) * 255).astype(np.uint8)),
        ("radial_rings", ((np.hypot(x - 112, y - 112) // 10 % 2) * 255).astype(np.uint8)),
        ("noise", np.random.default_rng(17).integers(0, 256, (224, 224, 3), dtype=np.uint8)),
        ("neutral", np.full((224, 224, 3), 128, dtype=np.uint8)),
    ]
    return [(name, Image.fromarray(pixels).convert("RGB")) for name, pixels in patterns]


def dataset_images(source: Path, count: int) -> list[tuple[str, Image.Image]]:
    # Round-robin through parent folders to sample class directories when present.
    groups: dict[Path, list[Path]] = {}
    for path in sorted(source.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            groups.setdefault(path.parent, []).append(path)
    selected: list[Path] = []
    while groups and len(selected) < count:
        for parent in list(groups):
            selected.append(groups[parent].pop(0))
            if not groups[parent]:
                del groups[parent]
            if len(selected) == count:
                break
    if len(selected) < 5:
        raise ValueError("Provide at least five dataset images.")
    images: list[tuple[str, Image.Image]] = []
    for index, path in enumerate(selected, start=1):
        with Image.open(path) as image:
            images.append((f"sample_{index:02d}", ImageOps.exif_transpose(image).convert("RGB")))
    return images


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Optional dataset directory; sampled across subfolders.")
    parser.add_argument("--count", type=int, choices=range(5, 11), default=8)
    parser.add_argument("--output", type=Path, default=GOLDEN_DIR)
    args = parser.parse_args()
    output: Path = args.output.resolve()
    if (output / "expected.json").exists():
        parser.error("expected.json already exists; use a new --output directory for review.")
    config = Settings()
    labels = TypeAdapter(list[str]).validate_json(config.LABELS_PATH.read_text(encoding="utf-8"), strict=True)
    model = load_keras_model(config.MODEL_PATH)
    if model.output_shape[-1] != len(labels):
        raise ValueError("Model and labels do not match.")
    images = dataset_images(args.source, args.count) if args.source else synthetic_images()
    output.mkdir(parents=True, exist_ok=True)

    # Reference preprocessing deliberately does not call services.inference.
    from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

    expected: list[dict[str, str | float]] = []
    for name, source in images:
        image = ImageOps.exif_transpose(source).convert("RGB").resize((224, 224), Image.BILINEAR)
        filename = f"{name}.png"
        image.save(output / filename, format="PNG")
        pixels = np.asarray(image, dtype=np.float32)
        probabilities = np.asarray(model.predict(np.expand_dims(preprocess_input(pixels), 0), verbose=0))[0]
        top = int(np.argmax(probabilities))
        expected.append({"file": filename, "label": labels[top], "confidence": float(probabilities[top])})
    (output / "expected.json").write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(expected, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
