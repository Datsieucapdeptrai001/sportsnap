from typing import Annotated

from fastapi import APIRouter, Query, Request
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.responses import Response, StreamingResponse

from app.core.auth import is_dev_request
from app.core.errors import APIError
from app.schemas import BulkCreated, BulkResults, BulkResultsQuery, BulkStatus, ErrorResponse
from app.services.bulk_job import BulkJobStore


router = APIRouter(prefix="/bulk", responses={
    status: {"model": ErrorResponse} for status in (400, 403, 404, 409, 410, 413, 422, 500, 503)
})


class DiskMultipartParser(MultiPartParser):
    # Force even small files onto disk instead of retaining thousands in RAM.
    spool_max_size = 1

    def on_headers_finished(self) -> None:
        try:
            super().on_headers_finished()
        except MultiPartException as exc:
            if self._current_files > self.max_files:
                raise APIError(413, "too_many_files", f"Chỉ được gửi tối đa {int(self.max_files)} tệp mỗi lượt.") from exc
            raise


@router.post("", status_code=202, response_model=BulkCreated)
async def create_bulk(
    request: Request,
    model_id: Annotated[str | None, Query()] = None,
) -> BulkCreated:
    if model_id is not None:
        if not is_dev_request(request):
            raise APIError(403, "forbidden", "Chỉ nhà phát triển mới được chỉ định mô hình qua model_id.")
    store: BulkJobStore = request.app.state.bulk_jobs
    if request.app.state.model is None:
        raise APIError(503, "model_not_loaded", "Mô hình chưa sẵn sàng. Vui lòng thử lại sau.")
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise APIError(400, "bad_request", "Vui lòng gửi ảnh hoặc ZIP bằng trường files.")
    job = await run_in_threadpool(store.reserve)
    try:
        parser = DiskMultipartParser(
            request.headers, request.stream(), max_files=store.config.MAX_BULK_FILES, max_fields=0,
        )
        try:
            form = await parser.parse()
        except MultiPartException as exc:
            raise APIError(400, "bad_request", "Dữ liệu tải lên không hợp lệ. Vui lòng chọn lại tệp.") from exc
        try:
            files = [value for key, value in form.multi_items()
                     if key in {"files", "files[]"} and isinstance(value, UploadFile)]
            if not files or len(files) != len(form.multi_items()):
                raise APIError(400, "bad_request", "Vui lòng gửi ảnh hoặc một ZIP bằng trường files.")
            if any((file.filename or "").lower().endswith(".zip") for file in files) and len(files) != 1:
                raise APIError(400, "bad_request", "Vui lòng gửi nhiều ảnh hoặc một tệp ZIP riêng.")
            await run_in_threadpool(store.stage, job, files)
        finally:
            await form.close()
        store.submit(job)
        return BulkCreated(job_id=job.job_id)
    except BaseException:
        await run_in_threadpool(store.discard, job)
        raise


@router.get("/{job_id}", response_model=BulkStatus)
def get_bulk(request: Request, job_id: str) -> BulkStatus:
    return request.app.state.bulk_jobs.snapshot(job_id)


@router.get("/{job_id}/results", response_model=BulkResults)
def get_bulk_results(request: Request, job_id: str, query: Annotated[BulkResultsQuery, Query()]) -> BulkResults:
    return request.app.state.bulk_jobs.results(job_id, query)


def image_response(request: Request, job_id: str, index: int, thumbnail: bool) -> Response:
    return Response(
        request.app.state.bulk_jobs.image(job_id, index, thumbnail), media_type="image/jpeg",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{job_id}/thumb/{index}")
def get_bulk_thumbnail(request: Request, job_id: str, index: int) -> Response:
    return image_response(request, job_id, index, True)


@router.get("/{job_id}/image/{index}")
def get_bulk_image(request: Request, job_id: str, index: int) -> Response:
    return image_response(request, job_id, index, False)


@router.get("/{job_id}/download")
def download_bulk(request: Request, job_id: str) -> StreamingResponse:
    chunks, release = request.app.state.bulk_jobs.download(job_id)
    return StreamingResponse(
        chunks, media_type="application/zip", background=BackgroundTask(release),
        headers={"Content-Disposition": 'attachment; filename="sportsnap_result.zip"'},
    )


@router.delete("/{job_id}", response_model=BulkStatus)
def cancel_bulk(request: Request, job_id: str) -> BulkStatus:
    return request.app.state.bulk_jobs.cancel_job(job_id)
