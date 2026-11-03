import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter

from app.core.config import Settings
from app.schemas import HealthResponse


logger = logging.getLogger(__name__)


def load_keras_model(path: Path) -> Any:
    # Import lazily so a clean checkout does not need to initialise TensorFlow.
    from tensorflow.keras.models import load_model

    return load_model(path, compile=False)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.model = None
        application.state.labels = []
        application.state.model_reason = None
        try:
            if not config.MODEL_PATH.is_file() or not config.LABELS_PATH.is_file():
                application.state.model_reason = "model_missing"
                logger.warning("Model or labels file is missing; health endpoint remains available.")
            else:
                labels = TypeAdapter(list[str]).validate_python(
                    json.loads(config.LABELS_PATH.read_text(encoding="utf-8")), strict=True
                )
                if not labels or any(not label.strip() for label in labels):
                    raise ValueError("Labels must be a non-empty list of non-empty strings.")
                model = load_keras_model(config.MODEL_PATH)
                if model.output_shape[-1] != len(labels):
                    raise ValueError("Model output size does not match the labels file.")
                application.state.model = model
                application.state.labels = labels
        except Exception:
            # Failed imports, unreadable files and invalid models must not prevent startup.
            application.state.model_reason = "model_load_failed"
            logger.exception("Model loading failed; health endpoint remains available.")
        try:
            yield
        finally:
            application.state.model = None
            application.state.labels = []

    application = FastAPI(title="SportSnap", lifespan=lifespan)
    application.state.settings = config
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    @application.get(
        "/api/health", response_model=HealthResponse, response_model_exclude_none=True
    )
    async def health(request: Request) -> HealthResponse:
        return HealthResponse(
            model_loaded=request.app.state.model is not None,
            num_classes=len(request.app.state.labels),
            preprocess=config.PREPROCESS,
            reason=request.app.state.model_reason,
        )

    # Register API routes first so static serving cannot shadow them.
    if (config.FRONTEND_DIST / "index.html").is_file():
        application.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")

    return application


app = create_app()
