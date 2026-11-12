"""API routes for listing, switching, and comparing available models."""

from typing import Annotated

from fastapi import APIRouter, File, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.scan import read_image
from app.core.errors import APIError
from app.schemas import (
    ErrorResponse,
    ModelComparisonItem,
    ModelComparisonResponse,
    ModelInfo,
    ModelsListResponse,
    SelectModelRequest,
    SelectModelResponse,
)
from app.services.inference import predict_image
from app.services.model_registry import (
    find_spec_by_id,
    list_available_models,
    load_or_get_cached,
    resolve_spec_paths,
)


router = APIRouter()


def _load_keras_model(path):
    from app.main import load_keras_model

    return load_keras_model(path)


@router.get("/models", response_model=ModelsListResponse)
def list_models(request: Request) -> ModelsListResponse:
    config = request.app.state.settings
    active_id = getattr(request.app.state, "active_model_id", None)
    return ModelsListResponse(
        active_model_id=active_id,
        models=list_available_models(config, active_id),
    )


@router.post(
    "/models/select",
    response_model=SelectModelResponse,
    responses={status: {"model": ErrorResponse} for status in (400, 404, 500, 503)},
)
async def select_model(request: Request, body: SelectModelRequest) -> SelectModelResponse:
    spec = find_spec_by_id(body.model_id)
    if spec is None:
        raise APIError(404, "model_not_found", "Không tìm thấy mô hình được chọn.")
    config = request.app.state.settings
    model_path, labels_path = resolve_spec_paths(config, spec)
    if not model_path.is_file() or not labels_path.is_file():
        raise APIError(404, "model_not_found", "Tệp mô hình này không có sẵn trên máy chủ.")

    def _switch() -> ModelInfo:
        with request.app.state.model_lock:
            cache = getattr(request.app.state, "loaded_models", {})
            model, labels = load_or_get_cached(cache, config, spec, _load_keras_model)
            request.app.state.loaded_models = cache
            request.app.state.model = model
            request.app.state.labels = labels
            request.app.state.preprocess = spec.preprocess
            request.app.state.active_model_id = spec.id
            request.app.state.model_reason = None
            request.app.state.bulk_jobs.set_active_model(model, labels, spec.preprocess)
            return ModelInfo(
                id=spec.id,
                name=spec.name,
                description=spec.description,
                preprocess=spec.preprocess,
                num_classes=len(labels),
                size_mb=round(model_path.stat().st_size / (1024 * 1024), 1),
                active=True,
            )

    try:
        info = await run_in_threadpool(_switch)
    except APIError:
        raise
    except Exception as exc:
        raise APIError(500, "internal_error", "Không thể nạp mô hình đã chọn. Vui lòng thử lại.") from exc

    return SelectModelResponse(active_model_id=spec.id, model=info)


@router.post(
    "/models/compare",
    response_model=ModelComparisonResponse,
    responses={status: {"model": ErrorResponse} for status in (400, 413, 415, 422, 500, 503)},
)
async def compare_models(
    request: Request, file: Annotated[UploadFile, File()]
) -> ModelComparisonResponse:
    try:
        config = request.app.state.settings
        data = await read_image(file, config.MAX_UPLOAD_MB)
        available = list_available_models(config, getattr(request.app.state, "active_model_id", None))
        if not available:
            raise APIError(503, "model_not_loaded", "Không có mô hình nào sẵn sàng để so sánh.")

        def _compare() -> list[ModelComparisonItem]:
            results: list[ModelComparisonItem] = []
            with request.app.state.model_lock:
                cache = getattr(request.app.state, "loaded_models", {})
                request.app.state.loaded_models = cache
                for info in available:
                    spec = find_spec_by_id(info.id)
                    if spec is None:
                        continue
                    model, labels = load_or_get_cached(cache, config, spec, _load_keras_model)
                    prediction = predict_image(
                        data,
                        model,
                        labels,
                        config.CONFIDENCE_THRESHOLD,
                        preprocess=spec.preprocess,
                    )
                    results.append(
                        ModelComparisonItem(
                            id=spec.id,
                            name=spec.name,
                            preprocess=spec.preprocess,
                            prediction=prediction,
                        )
                    )
            return results

        items = await run_in_threadpool(_compare)
        return ModelComparisonResponse(results=items)
    finally:
        await file.close()
