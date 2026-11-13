import logging
from pathlib import Path
from collections.abc import Callable
from typing import Annotated, TypeVar
from uuid import uuid4

from fastapi import APIRouter, File, Query, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.auth import is_dev_request
from app.core.errors import APIError
from app.schemas import ClassesResponse, ErrorResponse, Prediction, ScanResult
from app.services.inference import SUPPORTED_CONTENT_TYPES, predict_frames, predict_image
from app.services.model_registry import find_spec_by_id, load_or_get_cached


router = APIRouter()
logger = logging.getLogger(__name__)


PredictionType = TypeVar("PredictionType", bound=Prediction)


def locked_prediction(request: Request, operation: Callable[[], PredictionType]) -> PredictionType:
    # Share the model lock with the bulk worker; acquire it off the event loop.
    with request.app.state.model_lock:
        return operation()


def save_debug_frames(frames: list[bytes], content_types: list[str | None], directory: Path) -> None:
    """Save original upload bytes only when explicitly enabled for development."""
    scan_id = uuid4().hex
    suffixes = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    try:
        directory.mkdir(parents=True, exist_ok=True)
        for index, (data, content_type) in enumerate(zip(frames, content_types), start=1):
            suffix = suffixes.get(content_type or "", ".bin")
            (directory / f"{scan_id}-{index}{suffix}").write_bytes(data)
    except OSError:
        # Optional diagnostics must not prevent classification.
        logger.warning("Could not save scan debug frames.", exc_info=True)


async def read_image(file: UploadFile, max_upload_mb: int) -> bytes:
    limit = max_upload_mb * 1024 * 1024
    # Read at most one byte beyond the limit, including when size is unknown.
    if file.size is not None and file.size > limit:
        raise APIError(
            413, "file_too_large", f"Ảnh vượt quá giới hạn {max_upload_mb} MB."
        )
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise APIError(
            413, "file_too_large", f"Ảnh vượt quá giới hạn {max_upload_mb} MB."
        )
    if file.content_type not in SUPPORTED_CONTENT_TYPES:
        raise APIError(
            415, "unsupported_format", "Chỉ hỗ trợ ảnh JPG, JPEG, PNG hoặc WebP."
        )
    return data


@router.get("/classes", response_model=ClassesResponse)
def classes(request: Request) -> ClassesResponse:
    return ClassesResponse(classes=request.app.state.labels)


@router.post(
    "/predict",
    response_model=Prediction,
    responses={status: {"model": ErrorResponse} for status in (400, 403, 404, 413, 415, 422, 500, 503)},
)
async def predict(
    request: Request,
    file: Annotated[UploadFile, File()],
    model_id: Annotated[str | None, Query()] = None,
) -> Prediction:
    try:
        config = request.app.state.settings
        model = request.app.state.model
        labels = request.app.state.labels
        preprocess = getattr(request.app.state, "preprocess", config.PREPROCESS)

        if model_id is not None:
            if not is_dev_request(request):
                raise APIError(403, "forbidden", "Chỉ nhà phát triển mới được chỉ định mô hình qua model_id.")
            active_id = getattr(request.app.state, "active_model_id", None)
            if model_id != active_id:
                spec = find_spec_by_id(model_id)
                if spec is None:
                    raise APIError(404, "model_not_found", "Không tìm thấy mô hình được yêu cầu.")
                from app.main import load_keras_model

                cache = getattr(request.app.state, "loaded_models", {})
                model, labels = load_or_get_cached(cache, config, spec, load_keras_model)
                preprocess = spec.preprocess

        if model is None:
            raise APIError(
                503, "model_not_loaded", "Mô hình chưa sẵn sàng. Vui lòng thử lại sau."
            )
        data = await read_image(file, config.MAX_UPLOAD_MB)
        return await run_in_threadpool(
            locked_prediction, request,
            lambda: predict_image(
                data,
                model,
                labels,
                config.CONFIDENCE_THRESHOLD,
                preprocess,
            ),
        )
    finally:
        await file.close()


@router.post(
    "/scan",
    response_model=ScanResult,
    responses={status: {"model": ErrorResponse} for status in (400, 403, 404, 413, 415, 422, 500, 503)},
)
async def scan(
    request: Request,
    files: Annotated[list[UploadFile], File(default_factory=list)],
    model_id: Annotated[str | None, Query()] = None,
) -> ScanResult:
    try:
        if not 2 <= len(files) <= 6:
            raise APIError(
                400, "bad_request", "Vui lòng gửi từ 2 đến 6 khung hình để quét."
            )
        config = request.app.state.settings
        model = request.app.state.model
        labels = request.app.state.labels
        preprocess = getattr(request.app.state, "preprocess", config.PREPROCESS)

        if model_id is not None:
            if not is_dev_request(request):
                raise APIError(403, "forbidden", "Chỉ nhà phát triển mới được chỉ định mô hình qua model_id.")
            active_id = getattr(request.app.state, "active_model_id", None)
            if model_id != active_id:
                spec = find_spec_by_id(model_id)
                if spec is None:
                    raise APIError(404, "model_not_found", "Không tìm thấy mô hình được yêu cầu.")
                from app.main import load_keras_model

                cache = getattr(request.app.state, "loaded_models", {})
                model, labels = load_or_get_cached(cache, config, spec, load_keras_model)
                preprocess = spec.preprocess

        if model is None:
            raise APIError(
                503, "model_not_loaded", "Mô hình chưa sẵn sàng. Vui lòng thử lại sau."
            )
        frames = [await read_image(file, config.MAX_UPLOAD_MB) for file in files]
        if config.DEBUG_SAVE_FRAMES:
            await run_in_threadpool(
                save_debug_frames, frames, [file.content_type for file in files], config.DEBUG_FRAMES_DIR
            )
        return await run_in_threadpool(
            locked_prediction, request,
            lambda: predict_frames(
                frames,
                model,
                labels,
                config.CONFIDENCE_THRESHOLD,
                preprocess,
            ),
        )
    finally:
        for file in files:
            await file.close()
