from typing import Annotated

from fastapi import APIRouter, File, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.errors import APIError
from app.schemas import ClassesResponse, ErrorResponse, Prediction, ScanResult
from app.services.inference import SUPPORTED_CONTENT_TYPES, predict_frames, predict_image


router = APIRouter()


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
    responses={status: {"model": ErrorResponse} for status in (400, 413, 415, 422, 500, 503)},
)
async def predict(request: Request, file: Annotated[UploadFile, File()]) -> Prediction:
    try:
        model = request.app.state.model
        if model is None:
            raise APIError(
                503, "model_not_loaded", "Mô hình chưa sẵn sàng. Vui lòng thử lại sau."
            )
        config = request.app.state.settings
        data = await read_image(file, config.MAX_UPLOAD_MB)
        return await run_in_threadpool(
            predict_image, data, model, request.app.state.labels, config.CONFIDENCE_THRESHOLD
        )
    finally:
        await file.close()


@router.post(
    "/scan",
    response_model=ScanResult,
    responses={status: {"model": ErrorResponse} for status in (400, 413, 415, 422, 500, 503)},
)
async def scan(
    request: Request, files: Annotated[list[UploadFile], File(default_factory=list)],
) -> ScanResult:
    try:
        if not 2 <= len(files) <= 6:
            raise APIError(
                400, "bad_request", "Vui lòng gửi từ 2 đến 6 khung hình để quét."
            )
        model = request.app.state.model
        if model is None:
            raise APIError(
                503, "model_not_loaded", "Mô hình chưa sẵn sàng. Vui lòng thử lại sau."
            )
        config = request.app.state.settings
        frames = [await read_image(file, config.MAX_UPLOAD_MB) for file in files]
        return await run_in_threadpool(
            predict_frames, frames, model, request.app.state.labels, config.CONFIDENCE_THRESHOLD
        )
    finally:
        for file in files:
            await file.close()
