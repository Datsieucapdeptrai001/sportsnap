"""Configuration paths and defaults for sportsnap_lib."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class LibrarySettings:
    """Resolved filesystem paths and model defaults for the Smart Photo Library."""

    project_root: Path = PROJECT_ROOT
    data_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data")
    db_path: Path = field(default_factory=lambda: PROJECT_ROOT / "data" / "library.db")
    index_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data" / "index")
    thumbs_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data" / "thumbs")
    registry_dir: Path = field(
        default_factory=lambda: PROJECT_ROOT / "data" / "models_registry"
    )

    # Read-only source models & datasets (never modified by any code)
    source_model_path: Path = field(
        default_factory=lambda: PROJECT_ROOT / "models" / "ResNet50_finetune_best.keras"
    )
    source_labels_path: Path = field(
        default_factory=lambda: PROJECT_ROOT / "models" / "labels.json"
    )
    source_preprocess: str = "resnet50"
    source_backbone: str = "resnet50"

    train_dir: Path = field(
        default_factory=lambda: PROJECT_ROOT / "datasets" / "sports-classification" / "train"
    )
    valid_dir: Path = field(
        default_factory=lambda: PROJECT_ROOT / "datasets" / "sports-classification" / "valid"
    )
    test_dir: Path = field(
        default_factory=lambda: PROJECT_ROOT / "datasets" / "sports-classification" / "test"
    )
    external_dir: Path = field(
        default_factory=lambda: PROJECT_ROOT / "datasets" / "anh-ngoai"
    )

    clip_backend: str = "fastembed"
    clip_model_name: str = "Qdrant/clip-ViT-B-32"
    thumb_max_side: int = 512

    def ensure_dirs(self) -> None:
        """Create writable runtime directories under data/ without touching models/ or datasets/."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.thumbs_dir.mkdir(parents=True, exist_ok=True)
        self.registry_dir.mkdir(parents=True, exist_ok=True)
