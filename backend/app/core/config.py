from pathlib import Path
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    BASE_DIR: Path = PROJECT_ROOT
    MODEL_PATH: Path = Path("backend/models/best_model.keras")
    LABELS_PATH: Path = Path("backend/models/labels.json")
    PREPROCESS: Literal["mobilenet_v2"] = "mobilenet_v2"
    CONFIDENCE_THRESHOLD: float = Field(default=0.60, ge=0, le=1)
    MAX_UPLOAD_MB: int = Field(default=12, gt=0)
    MAX_BULK_FILES: int = Field(default=2000, gt=0)
    FRONTEND_DIST: Path = Path("frontend/dist")
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @model_validator(mode="after")
    def resolve_paths(self) -> Self:
        if not self.BASE_DIR.is_absolute():
            self.BASE_DIR = PROJECT_ROOT / self.BASE_DIR
        self.BASE_DIR = self.BASE_DIR.resolve()
        for name in ("MODEL_PATH", "LABELS_PATH", "FRONTEND_DIST"):
            path: Path = getattr(self, name)
            setattr(self, name, (self.BASE_DIR / path).resolve())
        return self
