"""API routes for user corrections and undo support."""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request
from starlette.concurrency import run_in_threadpool

from app.api.library import _get_runtime
from app.core.errors import APIError
from app.schemas import (
    CorrectionResponse,
    CreateCorrectionRequest,
    ErrorResponse,
    UndoCorrectionRequest,
    UndoCorrectionResponse,
)
from sportsnap_lib.db import list_corrections, record_correction, undo_correction

router = APIRouter(prefix="/corrections")
logger = logging.getLogger(__name__)


@router.post(
    "",
    response_model=CorrectionResponse,
    status_code=201,
    responses={status: {"model": ErrorResponse} for status in (400, 422, 500)},
)
async def create_correction(
    request: Request, body: CreateCorrectionRequest
) -> CorrectionResponse:
    """Records a user label correction, saving image bytes if provided."""
    runtime = _get_runtime(request)
    corrections_dir = runtime.settings.data_dir / "corrections"
    corrections_dir.mkdir(parents=True, exist_ok=True)
    image_file = corrections_dir / f"{body.image_sha1}.jpg"

    if body.image_base64:
        try:
            # Strip data URL prefix if present
            raw_b64 = body.image_base64
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            image_bytes = base64.b64decode(raw_b64)
            image_file.write_bytes(image_bytes)
        except Exception as exc:
            logger.warning("Could not persist correction image: %s", exc)

    rel_image_path = str(image_file.relative_to(runtime.settings.project_root)).replace("\\", "/")

    def _insert() -> int:
        with runtime.db_lock:
            return record_correction(
                conn=runtime.conn,
                image_sha1=body.image_sha1,
                image_path=rel_image_path,
                previous_label=body.previous_label,
                predicted_label=body.predicted_label,
                corrected_label=body.corrected_label,
                confidence=body.confidence,
                model_id=body.model_id,
                batch_id=body.batch_id,
            )

    try:
        corr_id = await run_in_threadpool(_insert)
    except Exception as exc:
        raise APIError(500, "internal_error", "Không thể lưu nhãn sửa đổi.") from exc

    with runtime.db_lock:
        row = runtime.conn.execute("SELECT * FROM corrections WHERE id = ?", (corr_id,)).fetchone()

    return CorrectionResponse(
        id=int(row["id"]),
        batch_id=row["batch_id"],
        image_sha1=row["image_sha1"],
        previous_label=row["previous_label"],
        predicted_label=row["predicted_label"],
        corrected_label=row["corrected_label"],
        confidence=row["confidence"],
        model_id=row["model_id"],
        created_at=row["created_at"],
        undone_at=row["undone_at"],
    )


@router.post(
    "/undo",
    response_model=UndoCorrectionResponse,
    responses={status: {"model": ErrorResponse} for status in (400, 404, 500)},
)
async def undo_user_correction(
    request: Request, body: UndoCorrectionRequest
) -> UndoCorrectionResponse:
    """Reverts a previously submitted correction."""
    if body.correction_id is None and body.image_sha1 is None and body.batch_id is None:
        raise APIError(400, "bad_request", "Vui lòng cung cấp correction_id, image_sha1 hoặc batch_id để hoàn tác.")

    runtime = _get_runtime(request)

    def _undo() -> tuple[int, str | None]:
        with runtime.db_lock:
            return undo_correction(
                conn=runtime.conn,
                correction_id=body.correction_id,
                image_sha1=body.image_sha1,
                batch_id=body.batch_id,
            )

    try:
        count, restored_label = await run_in_threadpool(_undo)
    except Exception as exc:
        raise APIError(500, "internal_error", "Không thể hoàn tác nhãn lúc này.") from exc

    if count == 0:
        return UndoCorrectionResponse(
            undone=False,
            undone_count=0,
            restored_label=None,
            message="Không tìm thấy thao tác sửa nào cần hoàn tác hoặc đã được hoàn tác trước đó.",
        )

    return UndoCorrectionResponse(
        undone=True,
        undone_count=count,
        restored_label=restored_label,
        message=f"Đã hoàn tác thành công {count} nhãn sửa.",
    )


@router.get(
    "",
    response_model=list[CorrectionResponse],
)
async def get_corrections(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    include_undone: Annotated[bool, Query()] = False,
) -> list[CorrectionResponse]:
    """Lists recent corrections."""
    runtime = _get_runtime(request)

    def _fetch() -> list[CorrectionResponse]:
        with runtime.db_lock:
            rows = list_corrections(runtime.conn, limit=limit, include_undone=include_undone)
            return [
                CorrectionResponse(
                    id=int(r["id"]),
                    batch_id=r["batch_id"],
                    image_sha1=r["image_sha1"],
                    previous_label=r["previous_label"],
                    predicted_label=r["predicted_label"],
                    corrected_label=r["corrected_label"],
                    confidence=r["confidence"],
                    model_id=r["model_id"],
                    created_at=r["created_at"],
                    undone_at=r["undone_at"],
                )
                for r in rows
            ]

    return await run_in_threadpool(_fetch)
