"""Catalog and lazy cache for switchable Keras classification models."""

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Callable, Literal

from pydantic import TypeAdapter

from app.core.config import Settings
from app.schemas import ModelInfo


PreprocessMode = Literal["mobilenet_v2", "resnet50", "none"]


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    description: str
    model_rel_path: str
    labels_rel_path: str
    preprocess: PreprocessMode


MODEL_CATALOG: tuple[ModelSpec, ...] = (
    ModelSpec(
        id="resnet50_finetune",
        name="ResNet50 (Fine-tune · 20 môn mới)",
        description="Tinh chỉnh ResNet50 trên bộ 20 môn mới (có archery, boxing, tennis, volleyball)",
        model_rel_path="models/ResNet50_finetune_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="resnet50",
    ),
    ModelSpec(
        id="resnet50_head",
        name="ResNet50 (Head · 20 môn mới)",
        description="Huấn luyện phần đầu ResNet50 với backbone đóng băng",
        model_rel_path="models/ResNet50_head_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="resnet50",
    ),
    ModelSpec(
        id="mobilenet_v2_finetune",
        name="MobileNetV2 (Fine-tune · 20 môn mới)",
        description="Tinh chỉnh MobileNetV2 nhẹ trên bộ 20 môn mới",
        model_rel_path="models/MobileNetV2_finetune_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="mobilenet_v2",
    ),
    ModelSpec(
        id="mobilenet_v2_head",
        name="MobileNetV2 (Head · 20 môn mới)",
        description="Huấn luyện phần đầu MobileNetV2 trên bộ 20 môn mới",
        model_rel_path="models/MobileNetV2_head_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="mobilenet_v2",
    ),
    ModelSpec(
        id="cnn_scratch",
        name="CNN Scratch (Tự xây dựng · 20 môn mới)",
        description="Mạng CNN tự xây dựng từ đầu (tích hợp Rescaling 1/255)",
        model_rel_path="models/cnn_scratch_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="none",
    ),
    ModelSpec(
        id="legacy_mobilenet_v2",
        name="MobileNetV2 (20 môn cũ · Golden)",
        description="Mô hình 20 môn gốc (figure skating pairs, nascar racing, rings, rugby)",
        model_rel_path="backend/models/best_model.keras",
        labels_rel_path="backend/models/labels.json",
        preprocess="mobilenet_v2",
    ),
)


def resolve_spec_paths(config: Settings, spec: ModelSpec) -> tuple[Path, Path]:
    return (
        (config.BASE_DIR / spec.model_rel_path).resolve(),
        (config.BASE_DIR / spec.labels_rel_path).resolve(),
    )


def find_spec_by_paths(config: Settings, model_path: Path, labels_path: Path) -> ModelSpec | None:
    resolved_model = model_path.resolve()
    resolved_labels = labels_path.resolve()
    for spec in MODEL_CATALOG:
        spec_model, spec_labels = resolve_spec_paths(config, spec)
        if spec_model == resolved_model and spec_labels == resolved_labels:
            return spec
    return None


def find_spec_by_id(model_id: str) -> ModelSpec | None:
    for spec in MODEL_CATALOG:
        if spec.id == model_id:
            return spec
    return None


def read_labels(labels_path: Path) -> list[str]:
    labels = TypeAdapter(list[str]).validate_python(
        json.loads(labels_path.read_text(encoding="utf-8")), strict=True
    )
    if not labels or any(not label.strip() for label in labels):
        raise ValueError("Labels must be a non-empty list of non-empty strings.")
    return labels


def list_available_models(config: Settings, active_model_id: str | None) -> list[ModelInfo]:
    items: list[ModelInfo] = []
    for spec in MODEL_CATALOG:
        model_path, labels_path = resolve_spec_paths(config, spec)
        if not model_path.is_file() or not labels_path.is_file():
            continue
        try:
            labels = read_labels(labels_path)
        except Exception:
            continue
        items.append(
            ModelInfo(
                id=spec.id,
                name=spec.name,
                description=spec.description,
                preprocess=spec.preprocess,
                num_classes=len(labels),
                size_mb=round(model_path.stat().st_size / (1024 * 1024), 1),
                active=spec.id == active_model_id,
            )
        )
    return items


def load_or_get_cached(
    cache: dict[str, tuple[Any, list[str]]],
    config: Settings,
    spec: ModelSpec,
    loader: Callable[[Path], Any],
) -> tuple[Any, list[str]]:
    if spec.id in cache:
        return cache[spec.id]
    model_path, labels_path = resolve_spec_paths(config, spec)
    if not model_path.is_file() or not labels_path.is_file():
        raise FileNotFoundError(f"Model files not found for {spec.id}")
    labels = read_labels(labels_path)
    model = loader(model_path)
    if model.output_shape[-1] != len(labels):
        raise ValueError("Model output size does not match the labels file.")
    cache[spec.id] = (model, labels)
    return model, labels
