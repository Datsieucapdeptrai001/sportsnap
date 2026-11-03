from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    model_loaded: bool
    num_classes: int = Field(ge=0)
    preprocess: Literal["mobilenet_v2"]
    reason: Literal["model_missing", "model_load_failed"] | None = None


class ClassConfidence(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)


class Prediction(ClassConfidence):
    top3: list[ClassConfidence] = Field(min_length=1, max_length=3)
    is_uncertain: bool
    threshold: float = Field(ge=0, le=1)
    latency_ms: int = Field(ge=0)


class ClassesResponse(BaseModel):
    classes: list[str]


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
