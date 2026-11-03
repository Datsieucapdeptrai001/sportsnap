from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    model_loaded: bool
    num_classes: int = Field(ge=0)
    preprocess: Literal["mobilenet_v2"]
    reason: Literal["model_missing", "model_load_failed"] | None = None
