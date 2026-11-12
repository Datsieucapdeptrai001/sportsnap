import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter
from starlette.exceptions import HTTPException
from starlette.concurrency import run_in_threadpool

from app.api.scan import router as inference_router
from app.api.bulk import router as bulk_router
from app.api.insights import router as insights_router
from app.api.library import router as library_router
from app.api.models import router as models_router
from app.core.config import Settings
from app.core.errors import APIError
from app.schemas import ErrorDetail, ErrorResponse, HealthResponse
from app.services.bulk_job import BulkJobStore
from app.services.model_registry import find_spec_by_paths


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
        application.state.preprocess = config.PREPROCESS
        application.state.active_model_id = None
        application.state.loaded_models = {}
        application.state.model_reason = None
        application.state.model_lock = Lock()
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
                spec = find_spec_by_paths(config, config.MODEL_PATH, config.LABELS_PATH)
                if spec is not None:
                    application.state.active_model_id = spec.id
                    application.state.preprocess = spec.preprocess
                    application.state.loaded_models[spec.id] = (model, labels)
        except Exception:
            # Failed imports, unreadable files and invalid models must not prevent startup.
            application.state.model_reason = "model_load_failed"
            logger.exception("Model loading failed; health endpoint remains available.")
        application.state.bulk_jobs = BulkJobStore(
            config, application.state.model, application.state.labels, application.state.model_lock,
        )
        application.state.bulk_jobs.set_active_model(
            application.state.model, application.state.labels, application.state.preprocess
        )

        async def cleanup_bulk_jobs() -> None:
            while True:
                await asyncio.sleep(config.BULK_CLEANUP_INTERVAL_SECONDS)
                await run_in_threadpool(application.state.bulk_jobs.cleanup)

        cleanup_task = asyncio.create_task(cleanup_bulk_jobs())
        try:
            yield
        finally:
            cleanup_task.cancel()
            try:
                await cleanup_task
            except asyncio.CancelledError:
                pass
            await run_in_threadpool(application.state.bulk_jobs.close)
            library_runtime = getattr(application.state, "library_runtime", None)
            if library_runtime is not None:
                await run_in_threadpool(library_runtime.close)
                application.state.library_runtime = None
            application.state.model = None
            application.state.labels = []
            application.state.loaded_models = {}

    application = FastAPI(title="SportSnap", lifespan=lifespan)
    application.state.settings = config
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )

    @application.exception_handler(APIError)
    async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.body.model_dump())

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        body = ErrorResponse(error=ErrorDetail(
            code="bad_request", message="Yêu cầu không hợp lệ. Vui lòng gửi ảnh trong trường file."
        ))
        return JSONResponse(status_code=400, content=body.model_dump())

    @application.exception_handler(HTTPException)
    async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
        body = ErrorResponse(error=ErrorDetail(
            code="bad_request" if exc.status_code < 500 else "internal_error",
            message="Yêu cầu không hợp lệ." if exc.status_code < 500 else "Đã xảy ra lỗi máy chủ.",
        ))
        return JSONResponse(
            status_code=exc.status_code, content=body.model_dump(), headers=exc.headers
        )

    @application.exception_handler(Exception)
    async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Request failed.", exc_info=exc)
        body = ErrorResponse(error=ErrorDetail(
            code="internal_error", message="Không thể nhận diện ảnh lúc này. Vui lòng thử lại sau."
        ))
        return JSONResponse(status_code=500, content=body.model_dump())

    @application.get(
        "/api/health", response_model=HealthResponse, response_model_exclude_none=True
    )
    async def health(request: Request) -> HealthResponse:
        return HealthResponse(
            model_loaded=request.app.state.model is not None,
            num_classes=len(request.app.state.labels),
            preprocess=getattr(request.app.state, "preprocess", config.PREPROCESS),
            reason=request.app.state.model_reason,
        )

    # Register API routes first so static serving cannot shadow them.
    application.include_router(inference_router, prefix="/api")
    application.include_router(models_router, prefix="/api")
    application.include_router(library_router, prefix="/api")
    application.include_router(bulk_router, prefix="/api")
    application.include_router(insights_router, prefix="/api")
    if (config.FRONTEND_DIST / "index.html").is_file():
        application.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")

    return application


app = create_app()
