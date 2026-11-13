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
    PREPROCESS: Literal["mobilenet_v2", "resnet50", "none"] = "mobilenet_v2"
    CONFIDENCE_THRESHOLD: float = Field(default=0.60, ge=0, le=1)
    MAX_UPLOAD_MB: int = Field(default=12, gt=0)
    MAX_BULK_FILES: int = Field(default=2000, gt=0)
    BULK_BATCH_SIZE: int = Field(default=32, gt=0, le=32)
    BULK_TTL_SECONDS: int = Field(default=1800, gt=0)
    BULK_MAX_ACTIVE_JOBS: int = Field(default=2, gt=0)
    BULK_CLEANUP_INTERVAL_SECONDS: int = Field(default=60, gt=0)
    BULK_TEMP_DIR: Path = Path("backend/tmp/bulk")
    BULK_RESULTS_PAGE_SIZE: int = Field(default=24, gt=0, le=100)
    BULK_RESULTS_MAX_LIMIT: int = Field(default=100, gt=0, le=100)
    BULK_THUMB_MAX_SIDE: int = Field(default=256, gt=0, le=256)
    BULK_IMAGE_MAX_SIDE: int = Field(default=2048, gt=0, le=4096)
    BULK_PREVIEW_JPEG_QUALITY: int = Field(default=85, ge=1, le=95)
    FRONTEND_DIST: Path = Path("frontend/dist")
    EXPERIMENTS_PATH: Path = Path("backend/data/experiments.json")
    INSIGHTS_DIR: Path = Path("backend/data/insights")
    DEBUG_SAVE_FRAMES: bool = False
    DEBUG_FRAMES_DIR: Path = Path("backend/debug_frames")
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    DEV_TOKEN: str | None = None

    @model_validator(mode="after")
    def resolve_paths(self) -> Self:
        if self.BULK_RESULTS_PAGE_SIZE > self.BULK_RESULTS_MAX_LIMIT:
            raise ValueError("Bulk page size cannot exceed the maximum page limit.")
        if not self.BASE_DIR.is_absolute():
            self.BASE_DIR = PROJECT_ROOT / self.BASE_DIR
        self.BASE_DIR = self.BASE_DIR.resolve()
        for name in ("MODEL_PATH", "LABELS_PATH", "FRONTEND_DIST", "DEBUG_FRAMES_DIR", "BULK_TEMP_DIR", "EXPERIMENTS_PATH", "INSIGHTS_DIR"):
            path: Path = getattr(self, name)
            setattr(self, name, (self.BASE_DIR / path).resolve())
        return self
