from typing import Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    model_loaded: bool
    num_classes: int = Field(ge=0)
    preprocess: Literal["mobilenet_v2", "resnet50"]
    reason: Literal["model_missing", "model_load_failed"] | None = None


class ClassConfidence(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)


class Prediction(ClassConfidence):
    top3: list[ClassConfidence] = Field(min_length=1, max_length=3)
    is_uncertain: bool
    threshold: float = Field(ge=0, le=1)
    latency_ms: int = Field(ge=0)


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
