import csv
import json
import logging
from typing import Annotated

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.api.scan import locked_prediction, read_image
from app.core.errors import APIError
from app.schemas import (
    AblationClassRow,
    ColorAblationSummary,
    ErrorResponse,
    Explanation,
    ExtendedInsightsResponse,
    ExtendedMainModel,
    ExternalEvalMetric,
    InsightsResponse,
    MultiSeedMetric,
)
from app.services.gradcam import explain_image


router = APIRouter()
logger = logging.getLogger(__name__)


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
        path = request.app.state.settings.EXPERIMENTS_PATH
        if not path.is_file():
            logger.error("Experiments file missing at path: %s", path)
            raise APIError(500, "internal_error", "Chưa thể tải dữ liệu thí nghiệm (tệp không tồn tại).")
        return InsightsResponse.model_validate_json(path.read_text(encoding="utf-8"))
    except APIError:
        raise
    except (OSError, ValueError, ValidationError) as exc:
        logger.exception("Failed to validate insights JSON: %s", exc)
        raise APIError(500, "internal_error", "Chưa thể tải dữ liệu thí nghiệm. Vui lòng thử lại sau.") from exc


@router.get("/insights/extended", response_model=ExtendedInsightsResponse)
def extended_insights(request: Request) -> ExtendedInsightsResponse:
    data_dir = request.app.state.settings.EXPERIMENTS_PATH.parent
    summary_path = data_dir / "kaggle_experiment_summary.json"
    if not summary_path.is_file():
        raise APIError(404, "extended_insights_missing", "Chưa có dữ liệu thực nghiệm mở rộng từ Kaggle.")
    try:
        raw = json.loads(summary_path.read_text(encoding="utf-8"))
        main_v3 = raw.get("main_v3_verified", {})
        cpu_bench = raw.get("cpu_benchmark", {})
        models: list[ExtendedMainModel] = []
        for name in ("ResNet50", "MobileNetV2", "CNN_Scratch"):
            entry = main_v3.get(name)
            if not isinstance(entry, dict):
                continue
            bench = cpu_bench.get(name, {}) if isinstance(cpu_bench, dict) else {}
            models.append(
                ExtendedMainModel(
                    name=name,
                    val_acc=entry.get("val_acc"),
                    val_loss=entry.get("val_loss"),
                    best_epoch=entry.get("best_epoch"),
                    head_test_acc=entry.get("head_test_acc"),
                    test_acc=entry["test_acc"],
                    test_tta_acc=entry.get("test_tta_acc"),
                    test_macro_f1=entry.get("test_macro_f1"),
                    size_mb=bench.get("size_mb", entry.get("deploy_mb")),
                    cpu_ms=bench.get("cpu_ms"),
                )
            )

        multi_seed_raw = raw.get("multi_seed", {})
        multi_seed = [
            MultiSeedMetric(model=model_name, **vals)
            for model_name, vals in multi_seed_raw.items()
            if isinstance(vals, dict)
        ]

        external_eval: list[ExternalEvalMetric] = []
        for key in ("anh_ngoai_resnet50", "anh_ngoai", "anh_ngoai_cnn_scratch"):
            entry = raw.get(key)
            if isinstance(entry, dict):
                external_eval.append(ExternalEvalMetric(**entry))

        ablation_rows: list[AblationClassRow] = []
        ablation_csv = data_dir / "ablation_per_class.csv"
        if ablation_csv.is_file():
            with ablation_csv.open("r", encoding="utf-8-sig", newline="") as fh:
                for row in csv.DictReader(fh):
                    ablation_rows.append(
                        AblationClassRow(
                            label=row["cls"],
                            orig_ok=float(row["orig_ok"]),
                            bg_ok=float(row["bg_ok"]),
                            person_ok=float(row["person_ok"]),
                            gradcam_in_person=float(row["gradcam_in_person"]),
                        )
                    )

        gradcam_img = "gradcam_compare_3models.png" if (request.app.state.settings.INSIGHTS_DIR / "gradcam_compare_3models.png").is_file() else None
        color_ablation: ColorAblationSummary | None = None
        color_path = data_dir / "color_ablation.json"
        if color_path.is_file():
            color_raw = json.loads(color_path.read_text(encoding="utf-8"))
            chart_name = color_raw.get("chart_image")
            if chart_name and not (request.app.state.settings.INSIGHTS_DIR / str(chart_name)).is_file():
                color_raw["chart_image"] = None
            color_ablation = ColorAblationSummary.model_validate(color_raw)
        ens = main_v3.get("Ensemble_MNV2_ResNet50", {})
        return ExtendedInsightsResponse(
            dataset=str(raw.get("dataset", "")),
            class_names=[str(c) for c in raw.get("class_names", [])],
            models=models,
            ensemble_test_acc=ens.get("test_acc") if isinstance(ens, dict) else None,
            kfold=main_v3.get("kfold_5_resnet50"),
            multi_seed=multi_seed,
            extended_test_20pct=raw.get("extended_test_20pct"),
            phash_check=raw.get("phash_check"),
            external_eval=external_eval,
            ablation_deeplabv3=raw.get("ablation_deeplabv3"),
            ablation_per_class=ablation_rows,
            gradcam_comparison_image=gradcam_img,
            color_ablation=color_ablation,
        )
    except (OSError, KeyError, ValueError, ValidationError) as exc:
        logger.exception("Failed to build extended insights: %s", exc)
        raise APIError(500, "internal_error", "Không thể đọc dữ liệu thực nghiệm mở rộng.") from exc


@router.get("/insights/files/{name:path}")
def insight_file(request: Request, name: str) -> FileResponse:
    directory = request.app.state.settings.INSIGHTS_DIR
    path = (directory / name).resolve()
    if path.parent != directory or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"} or not path.is_file():
        raise APIError(404, "image_not_found", "Không tìm thấy ảnh phân tích.")
    return FileResponse(path)
