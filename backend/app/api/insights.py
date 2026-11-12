from typing import Annotated

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.api.scan import locked_prediction, read_image
from app.core.errors import APIError
from app.schemas import ErrorResponse, Explanation, InsightsResponse
from app.services.gradcam import explain_image


router = APIRouter()


@router.post("/gradcam", response_model=Explanation, include_in_schema=False)
@router.post(
    "/explain", response_model=Explanation,
    responses={status: {"model": ErrorResponse} for status in (400, 413, 415, 422, 500, 501, 503)},
)
async def explain(request: Request, file: Annotated[UploadFile, File()]) -> Explanation:
    try:
        model = request.app.state.model
        if model is None:
            raise APIError(503, "model_not_loaded", "Mô hình chưa sẵn sàng. Vui lòng thử lại sau.")
        config = request.app.state.settings
        data = await read_image(file, config.MAX_UPLOAD_MB)
        return await run_in_threadpool(
            locked_prediction, request,
            lambda: explain_image(
                data,
                model,
                request.app.state.labels,
                config.CONFIDENCE_THRESHOLD,
                getattr(request.app.state, "preprocess", config.PREPROCESS),
            ).explanation,
        )
    finally:
        await file.close()


@router.get("/insights", response_model=InsightsResponse, response_model_exclude_unset=True)
def insights(request: Request) -> InsightsResponse:
    try:
        return InsightsResponse.model_validate_json(
            request.app.state.settings.EXPERIMENTS_PATH.read_text(encoding="utf-8")
        )
    except (OSError, ValueError, ValidationError) as exc:
        raise APIError(500, "internal_error", "Chưa thể tải dữ liệu thí nghiệm. Vui lòng thử lại sau.") from exc


@router.get("/insights/files/{name:path}")
def insight_file(request: Request, name: str) -> FileResponse:
    directory = request.app.state.settings.INSIGHTS_DIR
    path = (directory / name).resolve()
    if path.parent != directory or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"} or not path.is_file():
        raise APIError(404, "image_not_found", "Không tìm thấy ảnh phân tích.")
    return FileResponse(path)
