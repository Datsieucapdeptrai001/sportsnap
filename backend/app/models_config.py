"""Model manifests and configurations for SportSnap."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Literal

from app.core.config import PROJECT_ROOT


PreprocessMode = Literal["mobilenet_v2", "resnet50", "none"]


@dataclass(frozen=True)
class ModelManifest:
    id: str
    display_name: str
    description: str
    model_rel_path: str
    labels_rel_path: str
    preprocess: PreprocessMode
    input_size: tuple[int, int] = (224, 224)
    temperature: float = 1.0
    tau_high: float = 0.75
    tau_low: float = 0.40

    def resolve_model_path(self, base_dir: Path | None = None) -> Path:
        root = base_dir or PROJECT_ROOT
        return (root / self.model_rel_path).resolve()

    def resolve_labels_path(self, base_dir: Path | None = None) -> Path:
        root = base_dir or PROJECT_ROOT
        return (root / self.labels_rel_path).resolve()

    def load_class_names(self, base_dir: Path | None = None) -> list[str]:
        path = self.resolve_labels_path(base_dir)
        content = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(content, list) or not content:
            raise ValueError(f"Invalid labels file at {path}")
        return [str(item) for item in content]


MODEL_MANIFESTS: tuple[ModelManifest, ...] = (
    ModelManifest(
        id="legacy_mobilenet_v2",
        display_name="MobileNetV2 (SportSnap · 20 môn chuẩn)",
        description="Mô hình chính thức của đề tài SportSnap (20 môn chuẩn theo báo cáo, tối ưu cho CPU)",
        model_rel_path="backend/models/best_model.keras",
        labels_rel_path="backend/models/labels.json",
        preprocess="mobilenet_v2",
        temperature=1.0,
        tau_high=0.75,
        tau_low=0.40,
    ),
    ModelManifest(
        id="mobilenet_v2_finetune",
        display_name="MobileNetV2 Fine-tune (20 môn mới)",
        description="Tinh chỉnh MobileNetV2 nhẹ trên bộ 20 môn mới",
        model_rel_path="models/MobileNetV2_finetune_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="mobilenet_v2",
        temperature=1.0,
        tau_high=0.75,
        tau_low=0.40,
    ),
    ModelManifest(
        id="mobilenet_v2_head",
        display_name="MobileNetV2 Head (20 môn mới)",
        description="Huấn luyện phần đầu MobileNetV2 trên bộ 20 môn mới",
        model_rel_path="models/MobileNetV2_head_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="mobilenet_v2",
        temperature=1.0,
        tau_high=0.75,
        tau_low=0.40,
    ),
    ModelManifest(
        id="resnet50_finetune",
        display_name="ResNet50 Fine-tune (20 môn mới)",
        description="Tinh chỉnh ResNet50 chuẩn (276.9 MB / 264.1 MiB) với tiền xử lý resnet50",
        model_rel_path="models/ResNet50_finetune_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="resnet50",
        temperature=1.0,
        tau_high=0.75,
        tau_low=0.40,
    ),
    ModelManifest(
        id="resnet50_head",
        display_name="ResNet50 Head (20 môn mới)",
        description="Huấn luyện phần đầu ResNet50 với backbone đóng băng",
        model_rel_path="models/ResNet50_head_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="resnet50",
        temperature=1.0,
        tau_high=0.75,
        tau_low=0.40,
    ),
    ModelManifest(
        id="cnn_scratch",
        display_name="CNN Scratch (Tự xây dựng · 20 môn mới)",
        description="Mạng CNN tự xây dựng từ đầu (tích hợp Rescaling 1/255)",
        model_rel_path="models/cnn_scratch_best.keras",
        labels_rel_path="models/labels.json",
        preprocess="none",
        temperature=1.0,
        tau_high=0.75,
        tau_low=0.40,
    ),
)


def get_manifest_by_id(model_id: str) -> ModelManifest | None:
    for m in MODEL_MANIFESTS:
        if m.id == model_id:
            return m
    return None
