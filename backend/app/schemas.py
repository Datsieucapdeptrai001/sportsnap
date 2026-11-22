from typing import Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    model_loaded: bool
    num_classes: int = Field(ge=0)
    preprocess: Literal["mobilenet_v2", "resnet50", "none"]
    reason: Literal["model_missing", "model_load_failed"] | None = None


class ModelInfo(BaseModel):
    id: str
    name: str
    description: str
    preprocess: Literal["mobilenet_v2", "resnet50", "none"]
    num_classes: int = Field(ge=0)
    size_mb: float = Field(ge=0)
    active: bool


class ModelsListResponse(BaseModel):
    active_model_id: str | None = None
    models: list[ModelInfo]


class SelectModelRequest(BaseModel):
    model_id: str


class SelectModelResponse(BaseModel):
    active_model_id: str
    model: ModelInfo


class ClassConfidence(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)


class Prediction(ClassConfidence):
    top3: list[ClassConfidence] = Field(min_length=1, max_length=3)
    is_uncertain: bool
    threshold: float = Field(ge=0, le=1)
    latency_ms: int = Field(ge=0)


class ModelComparisonItem(BaseModel):
    id: str
    name: str
    preprocess: Literal["mobilenet_v2", "resnet50", "none"]
    prediction: Prediction


class ModelComparisonResponse(BaseModel):
    results: list[ModelComparisonItem]


class FramePrediction(ClassConfidence):
    pass


class ScanResult(Prediction):
    per_frame: list[FramePrediction] = Field(min_length=2, max_length=6)
    agreement: float = Field(ge=0, le=1)


class Explanation(Prediction):
    overlay_png_base64: str


class ExperimentModel(BaseModel):
    name: str
    strategy: str
    accuracy: float | None = Field(ge=0, le=1)
    macro_f1: float | None = Field(ge=0, le=1)
    params_m: float | None = Field(ge=0)
    size_mb: float | None = Field(ge=0)
    latency_ms: float | None = Field(ge=0)
    val_accuracy: float | None = Field(default=None, ge=0, le=1)


class ConfusionPair(BaseModel):
    true: str
    pred: str
    count: int = Field(gt=0)


class SplitExperiment(BaseModel):
    split: str
    count: int = Field(gt=0)
    accuracy: float = Field(ge=0, le=1)
    macro_f1: float = Field(ge=0, le=1)
    labels: list[str]
    confusion_matrix: list[list[int]]
    top_confusions: list[ConfusionPair]


class GradcamExample(BaseModel):
    image: str
    true: str
    pred: str
    note: str


class AblationExperiment(BaseModel):
    name: str
    accuracy: float | None
    delta: float | None


class InsightsResponse(BaseModel):
    models: list[ExperimentModel]
    confusion_matrix_image: str | None
    gradcam_gallery: list[GradcamExample]
    ablation: list[AblationExperiment] | None = None
    selected_model: str
    splits: list[SplitExperiment]
    sources: dict[str, str]
    notes: list[str]


class ClassesResponse(BaseModel):
    classes: list[str]


class BulkCreated(BaseModel):
    job_id: str


class BulkItem(BaseModel):
    filename: str
    label: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    is_uncertain: bool = False
    top3: list[ClassConfidence] = Field(default_factory=list)
    folder: str = "loi"
    error: str | None = None


class BulkStatus(BaseModel):
    status: Literal["queued", "running", "done", "error", "cancelled"]
    processed: int = Field(ge=0)
    total: int = Field(ge=0)
    uncertain: int = Field(ge=0)
    errors: int = Field(ge=0)
    counts: dict[str, int] = Field(default_factory=dict)
    items: list[BulkItem] = Field(default_factory=list)
    error: str | None = None
    files_removed: bool = False


BulkSort = Literal["confidence_asc", "confidence_desc", "filename"]


class BulkResultsQuery(BaseModel):
    label: str = ""
    uncertain: bool = False
    sort: BulkSort = "confidence_desc"
    offset: int = Field(default=0, ge=0)
    limit: int | None = Field(default=None, ge=1, le=100)

    @field_validator("uncertain", "sort", "offset", "limit", mode="before")
    @classmethod
    def empty_query_defaults(cls, value: object, info: ValidationInfo) -> object:
        if value != "":
            return value
        return {"uncertain": False, "sort": "confidence_desc", "offset": 0, "limit": None}[info.field_name]


class BulkResultItem(BulkItem):
    index: int = Field(ge=0)


class BulkSummary(BaseModel):
    total: int = Field(ge=0)
    processed: int = Field(ge=0)
    uncertain: int = Field(ge=0)
    errors: int = Field(ge=0)
    counts: dict[str, int]


class BulkResults(BaseModel):
    items: list[BulkResultItem]
    total: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    summary: BulkSummary


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class CreateCorrectionRequest(BaseModel):
    batch_id: str | None = None
    image_sha1: str = Field(min_length=1)
    image_base64: str | None = None
    previous_label: str = Field(min_length=1)
    predicted_label: str = Field(min_length=1)
    corrected_label: str = Field(min_length=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    model_id: str = "legacy_mobilenet_v2"


class CorrectionResponse(BaseModel):
    id: int
    batch_id: str | None = None
    image_sha1: str
    previous_label: str
    predicted_label: str
    corrected_label: str
    confidence: float | None = None
    model_id: str
    created_at: str
    undone_at: str | None = None


class UndoCorrectionRequest(BaseModel):
    correction_id: int | None = None
    image_sha1: str | None = None
    batch_id: str | None = None


class UndoCorrectionResponse(BaseModel):
    undone: bool
    undone_count: int
    restored_label: str | None = None
    message: str


class ExtendedMainModel(BaseModel):
    name: str
    val_acc: float | None = Field(default=None, ge=0, le=1)
    val_loss: float | None = Field(default=None, ge=0)
    best_epoch: int | None = Field(default=None, ge=1)
    head_test_acc: float | None = Field(default=None, ge=0, le=1)
    test_acc: float = Field(ge=0, le=1)
    test_tta_acc: float | None = Field(default=None, ge=0, le=1)
    test_macro_f1: float | None = Field(default=None, ge=0, le=1)
    size_mb: float | None = Field(default=None, ge=0)
    cpu_ms: float | None = Field(default=None, ge=0)


class KFoldSummary(BaseModel):
    n_total: int = Field(gt=0)
    folds: list[float]
    mean: float = Field(ge=0, le=1)
    std: float = Field(ge=0)
    oof_macro_f1: float = Field(ge=0, le=1)


class MultiSeedMetric(BaseModel):
    model: str
    acc_mean: float = Field(ge=0, le=1)
    acc_std: float = Field(ge=0)
    f1_mean: float = Field(ge=0, le=1)
    f1_std: float = Field(ge=0)
    runs: list[list[float]]


class ExtendedTestMetric(BaseModel):
    n: int = Field(gt=0)
    acc: float = Field(ge=0, le=1)
    macro_f1: float = Field(ge=0, le=1)
    wilson_95_ci: list[float]


class PhashCheckMetric(BaseModel):
    near_pairs_le_5: int = Field(ge=0)
    bad_test_removed: int = Field(ge=0)
    clean_test_n: int = Field(gt=0)
    clean_acc: float = Field(ge=0, le=1)
    clean_macro_f1: float = Field(ge=0, le=1)


class ExternalEvalMetric(BaseModel):
    model: str
    n: int = Field(gt=0)
    top1: float = Field(ge=0, le=1)
    top1_correct: int = Field(ge=0)
    top5: float = Field(ge=0, le=1)
    top5_correct: int = Field(ge=0)
    per_class: dict[str, str] = Field(default_factory=dict)


class AblationSummaryMetric(BaseModel):
    model: str
    n: int = Field(gt=0)
    acc_orig: float = Field(ge=0, le=1)
    acc_bg_only: float = Field(ge=0, le=1)
    acc_person_only: float = Field(ge=0, le=1)
    gradcam_in_person_mean: float = Field(ge=0, le=1)


class AblationClassRow(BaseModel):
    label: str
    orig_ok: float = Field(ge=0, le=1)
    bg_ok: float = Field(ge=0, le=1)
    person_ok: float = Field(ge=0, le=1)
    gradcam_in_person: float = Field(ge=0, le=1)


class ColorAblationConditionMetric(BaseModel):
    accuracy: float = Field(ge=0, le=1)
    macro_f1: float = Field(ge=0, le=1)
    correct: int = Field(ge=0)
    total: int = Field(gt=0)


class ColorAblationModelMetric(BaseModel):
    name: str
    checkpoint: str
    rgb_orig: ColorAblationConditionMetric
    grayscale: ColorAblationConditionMetric
    rb_swap: ColorAblationConditionMetric
    grayscale_drop_pp: float
    rb_swap_drop_pp: float


class ColorAblationClassRow(BaseModel):
    class_name: str
    rgb_orig: float = Field(ge=0, le=1)
    grayscale: float = Field(ge=0, le=1)
    rb_swap: float = Field(ge=0, le=1)
    grayscale_drop_pp: float
    rb_swap_drop_pp: float


class ColorAblationSummary(BaseModel):
    n_test: int = Field(gt=0)
    num_classes: int = Field(gt=0)
    split: str
    conditions: list[str] = Field(default_factory=list)
    models: list[ColorAblationModelMetric] = Field(default_factory=list)
    per_class_mobilenet_v2: list[ColorAblationClassRow] = Field(default_factory=list)
    chart_image: str | None = None


class ExtendedInsightsResponse(BaseModel):
    dataset: str
    class_names: list[str]
    models: list[ExtendedMainModel]
    ensemble_test_acc: float | None = Field(default=None, ge=0, le=1)
    kfold: KFoldSummary | None = None
    multi_seed: list[MultiSeedMetric] = Field(default_factory=list)
    extended_test_20pct: ExtendedTestMetric | None = None
    phash_check: PhashCheckMetric | None = None
    external_eval: list[ExternalEvalMetric] = Field(default_factory=list)
    ablation_deeplabv3: AblationSummaryMetric | None = None
    ablation_per_class: list[AblationClassRow] = Field(default_factory=list)
    gradcam_comparison_image: str | None = None
    color_ablation: ColorAblationSummary | None = None
