"""API routes for Smart Photo Library: CLIP semantic search, dedup, and MLOps retraining."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import sys
from threading import Lock
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.api.scan import read_image  # noqa: E402
from app.core.errors import APIError  # noqa: E402
from sportsnap_lib.config import LibrarySettings  # noqa: E402
from sportsnap_lib.db import init_db, set_image_label, utc_now_iso  # noqa: E402
from sportsnap_lib.dedup import list_dup_groups, run_dedup, set_group_decision  # noqa: E402
from sportsnap_lib.embedder import FastEmbedClipEmbedder  # noqa: E402
from sportsnap_lib.ingest import ingest_directory, ingest_paths, update_job  # noqa: E402
from sportsnap_lib.paths import resolve_stored_path  # noqa: E402
from sportsnap_lib.registry import (  # noqa: E402
    ModelVersionRecord,
    ensure_initial_version,
    list_versions,
    promote_version,
)
from sportsnap_lib.retrain import retrain_from_corrections  # noqa: E402
from sportsnap_lib.search import browse_images, search_by_text, search_similar_images  # noqa: E402
from sportsnap_lib.vector_index import NumpyVectorIndex  # noqa: E402


router = APIRouter(prefix="/library")


class IngestFolderRequest(BaseModel):
    folder: str = Field(min_length=1)


class DedupDecisionRequest(BaseModel):
    best_image_id: int | None = None
    keep_all: bool = False


class SetLabelRequest(BaseModel):
    label: str = Field(min_length=1)


class RetrainRequest(BaseModel):
    epochs: int = Field(default=3, ge=1, le=10)
    activate: bool = True
    in_place: bool = True


class LibraryRuntime:
    """Lazy-initialized runtime container for SQLite, CLIP embedder, and vector index."""

    def __init__(self, base_dir: Path) -> None:
        data_dir = base_dir / "data"
        self.settings = LibrarySettings(
            project_root=base_dir,
            data_dir=data_dir,
            db_path=data_dir / "library.db",
            index_dir=data_dir / "index",
            thumbs_dir=data_dir / "thumbs",
            registry_dir=data_dir / "models_registry",
            source_model_path=base_dir / "models" / "ResNet50_finetune_best.keras",
            source_labels_path=base_dir / "models" / "labels.json",
            train_dir=base_dir / "datasets" / "sports-classification" / "train",
            valid_dir=base_dir / "datasets" / "sports-classification" / "valid",
            test_dir=base_dir / "datasets" / "sports-classification" / "test",
            external_dir=base_dir / "datasets" / "anh-ngoai",
        )
        self.settings.ensure_dirs()
        self.conn: sqlite3.Connection = init_db(self.settings.db_path)
        self.db_lock = Lock()
        self.embedder = FastEmbedClipEmbedder()
        self.index = NumpyVectorIndex.load(self.settings.index_dir)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sportsnap-lib")

    def close(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.conn.close()


def _get_runtime(request: Request) -> LibraryRuntime:
    runtime = getattr(request.app.state, "library_runtime", None)
    if runtime is None:
        init_lock = getattr(request.app.state, "library_init_lock", None)
        if init_lock is None:
            init_lock = Lock()
            request.app.state.library_init_lock = init_lock
        with init_lock:
            runtime = getattr(request.app.state, "library_runtime", None)
            if runtime is None:
                runtime = LibraryRuntime(request.app.state.settings.BASE_DIR)
                request.app.state.library_runtime = runtime
    return runtime


def _version_to_dict(rec: ModelVersionRecord) -> dict[str, Any]:
    return {
        "version": rec.version,
        "parent": rec.parent,
        "created_at": rec.created_at,
        "train_set_hash": rec.train_set_hash,
        "n_corrections_used": rec.n_corrections_used,
        "metrics": rec.metrics,
        "temperature": rec.temperature,
        "tau_high": rec.tau_high,
        "tau_low": rec.tau_low,
        "preprocess": rec.preprocess,
        "backbone": rec.backbone,
        "is_active": rec.is_active,
    }


def _search_item_to_dict(item: Any) -> dict[str, Any]:
    return {
        "image_id": item.image_id,
        "filename": Path(item.path).name,
        "path": item.path,
        "thumb_url": f"/api/library/images/{item.image_id}/thumb",
        "file_url": f"/api/library/images/{item.image_id}/file",
        "width": item.width,
        "height": item.height,
        "taken_at": item.taken_at,
        "label": item.label,
        "label_source": item.label_source,
        "top1_label": item.top1_label,
        "top1_prob": item.top1_prob,
        "calibrated_prob": item.calibrated_prob,
        "status": item.status,
        "sharpness": item.sharpness,
        "exposure": item.exposure,
        "similarity": item.similarity,
    }


@router.get("/stats")
def library_stats(request: Request) -> dict[str, Any]:
    rt = _get_runtime(request)
    with rt.db_lock:
        total_images = int(rt.conn.execute("SELECT COUNT(*) FROM images").fetchone()[0])
        total_dup_groups = int(rt.conn.execute("SELECT COUNT(*) FROM dup_groups").fetchone()[0])
        human_labels = int(
            rt.conn.execute("SELECT COUNT(*) FROM labels WHERE source = 'human'").fetchone()[0]
        )
        status_rows = rt.conn.execute(
            "SELECT status, COUNT(*) AS cnt FROM predictions GROUP BY status"
        ).fetchall()
        label_rows = rt.conn.execute(
            "SELECT label, COUNT(*) AS cnt FROM labels GROUP BY label ORDER BY cnt DESC"
        ).fetchall()
    return {
        "total_images": total_images,
        "total_dup_groups": total_dup_groups,
        "human_labels": human_labels,
        "index_size": rt.index.size,
        "by_status": {str(r["status"]): int(r["cnt"]) for r in status_rows},
        "by_label": {str(r["label"]): int(r["cnt"]) for r in label_rows},
    }


@router.post("/ingest")
async def start_ingest_folder(request: Request, body: IngestFolderRequest) -> dict[str, str]:
    rt = _get_runtime(request)
    base_dir = request.app.state.settings.BASE_DIR.resolve()
    raw_folder = Path(body.folder)
    target = raw_folder.resolve() if raw_folder.is_absolute() else (base_dir / raw_folder).resolve()
    if base_dir not in target.parents and target != base_dir:
        raise APIError(400, "bad_request", "Thư mục phải nằm trong dự án.")
    if not target.is_dir():
        raise APIError(404, "folder_not_found", f"Không tìm thấy thư mục: {body.folder}")

    job_id = uuid4().hex
    with rt.db_lock:
        update_job(rt.conn, job_id, state="queued", progress=0.0, message="Đang chuẩn bị nạp ảnh...")

    def _run() -> None:
        with rt.db_lock:
            try:
                ingest_directory(
                    target,
                    rt.conn,
                    rt.settings,
                    embedder=rt.embedder,
                    index=rt.index,
                    job_id=job_id,
                )
            except Exception as exc:
                update_job(
                    rt.conn,
                    job_id,
                    state="error",
                    progress=1.0,
                    message="Nạp ảnh thất bại.",
                    error=str(exc),
                )

    rt.executor.submit(_run)
    return {"job_id": job_id}


@router.post("/ingest/upload")
async def start_ingest_upload(
    request: Request, files: Annotated[list[UploadFile], File(default_factory=list)]
) -> dict[str, str]:
    if not files:
        raise APIError(400, "bad_request", "Vui lòng chọn ít nhất một ảnh.")
    rt = _get_runtime(request)
    config = request.app.state.settings
    job_id = uuid4().hex
    upload_dir = rt.settings.data_dir / "uploads" / job_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: list[Path] = []
    try:
        for idx, file in enumerate(files):
            data = await read_image(file, config.MAX_UPLOAD_MB)
            safe_name = Path(file.filename or f"upload_{idx}.jpg").name
            dest = upload_dir / f"{idx:04d}_{safe_name}"
            dest.write_bytes(data)
            saved_paths.append(dest)
    finally:
        for file in files:
            await file.close()

    with rt.db_lock:
        update_job(rt.conn, job_id, state="queued", progress=0.0, message="Đang chuẩn bị nạp ảnh tải lên...")

    def _run() -> None:
        with rt.db_lock:
            try:
                ingest_paths(
                    saved_paths,
                    rt.conn,
                    rt.settings,
                    embedder=rt.embedder,
                    index=rt.index,
                    job_id=job_id,
                )
            except Exception as exc:
                update_job(
                    rt.conn,
                    job_id,
                    state="error",
                    progress=1.0,
                    message="Nạp ảnh thất bại.",
                    error=str(exc),
                )

    rt.executor.submit(_run)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def get_library_job(request: Request, job_id: str) -> dict[str, Any]:
    rt = _get_runtime(request)
    with rt.db_lock:
        row = rt.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        raise APIError(404, "job_not_found", "Không tìm thấy tiến trình.")
    return {
        "id": str(row["id"]),
        "type": str(row["type"]),
        "state": str(row["state"]),
        "progress": float(row["progress"]),
        "message": row["message"],
        "error": row["error"],
    }


@router.get("/search")
async def library_search(
    request: Request,
    q: str = "",
    label: str | None = None,
    status: str | None = None,
    source: str | None = None,
    min_conf: float | None = Query(default=None, ge=0.0, le=1.0),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    rt = _get_runtime(request)

    def _query() -> dict[str, Any]:
        with rt.db_lock:
            if not q.strip():
                items, total = browse_images(
                    rt.conn,
                    label=label or None,
                    status=status or None,
                    source=source or None,
                    min_conf=min_conf,
                    limit=limit,
                    offset=offset,
                )
                return {
                    "items": [_search_item_to_dict(i) for i in items],
                    "total": total,
                    "expanded_query": "",
                }
            items, expanded = search_by_text(
                rt.conn,
                rt.index,
                rt.embedder,
                q,
                k=limit,
                label=label or None,
                status=status or None,
                source=source or None,
                min_conf=min_conf,
            )
            return {
                "items": [_search_item_to_dict(i) for i in items],
                "total": len(items),
                "expanded_query": expanded,
            }

    return await run_in_threadpool(_query)


@router.post("/search/similar")
async def library_search_similar(
    request: Request,
    image_id: int | None = None,
    k: int = Query(default=24, ge=1, le=100),
    label: str | None = None,
    status: str | None = None,
    file: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    rt = _get_runtime(request)
    query_pil: Image.Image | None = None
    if file is not None:
        try:
            data = await read_image(file, request.app.state.settings.MAX_UPLOAD_MB)
            with Image.open(BytesIO(data)) as src:
                query_pil = src.convert("RGB")
        finally:
            await file.close()
    elif image_id is None:
        raise APIError(400, "bad_request", "Cần cung cấp image_id hoặc ảnh tải lên.")

    def _run() -> dict[str, Any]:
        with rt.db_lock:
            try:
                items = search_similar_images(
                    rt.conn,
                    rt.index,
                    rt.embedder,
                    image_id=image_id,
                    query_image=query_pil,
                    k=k,
                    label=label or None,
                    status=status or None,
                )
            except ValueError as exc:
                raise APIError(404, "image_not_found", str(exc)) from exc
        return {"items": [_search_item_to_dict(i) for i in items]}

    return await run_in_threadpool(_run)


@router.get("/images/{image_id}/thumb")
def library_image_thumb(request: Request, image_id: int) -> FileResponse:
    rt = _get_runtime(request)
    with rt.db_lock:
        row = rt.conn.execute(
            "SELECT thumb_path, path FROM images WHERE id = ?", (image_id,)
        ).fetchone()
    if row is None:
        raise APIError(404, "image_not_found", "Không tìm thấy ảnh.")
    root = rt.settings.project_root
    target = resolve_stored_path(
        str(row["thumb_path"]), root, (rt.settings.thumbs_dir,)
    ) or resolve_stored_path(str(row["path"]), root)
    if target is None:
        raise APIError(404, "image_not_found", "Không tìm thấy tệp ảnh.")
    return FileResponse(target)


@router.get("/images/{image_id}/file")
def library_image_file(request: Request, image_id: int) -> FileResponse:
    rt = _get_runtime(request)
    with rt.db_lock:
        row = rt.conn.execute("SELECT path FROM images WHERE id = ?", (image_id,)).fetchone()
    if row is None:
        raise APIError(404, "image_not_found", "Không tìm thấy ảnh.")
    target = resolve_stored_path(str(row["path"]), rt.settings.project_root)
    if target is None:
        raise APIError(404, "image_not_found", "Không tìm thấy tệp ảnh.")
    return FileResponse(target)


@router.post("/dedup/run")
async def library_dedup_run(
    request: Request,
    phash_threshold: int = Query(default=8, ge=0, le=32),
    clip_threshold: float = Query(default=0.92, ge=0.70, le=0.999),
) -> dict[str, Any]:
    rt = _get_runtime(request)

    def _run() -> dict[str, Any]:
        with rt.db_lock:
            summary = run_dedup(
                rt.conn,
                rt.index,
                phash_threshold=phash_threshold,
                clip_threshold=clip_threshold,
            )
        return {
            "total_images": summary.total_images,
            "num_groups": summary.num_groups,
            "duplicate_images": summary.duplicate_images,
            "archived_candidates": summary.archived_candidates,
            "reduction_rate": summary.reduction_rate,
        }

    return await run_in_threadpool(_run)


@router.get("/dedup/groups")
def library_dedup_groups(request: Request) -> dict[str, Any]:
    rt = _get_runtime(request)
    with rt.db_lock:
        groups = list_dup_groups(rt.conn)
    for g in groups:
        for m in g["members"]:
            m["filename"] = Path(m["path"]).name
            m["thumb_url"] = f"/api/library/images/{m['image_id']}/thumb"
    return {"groups": groups}


@router.post("/dedup/{group_id}/decision")
def library_dedup_decision(
    request: Request, group_id: int, body: DedupDecisionRequest
) -> dict[str, Any]:
    rt = _get_runtime(request)
    with rt.db_lock:
        try:
            group = set_group_decision(
                rt.conn, group_id, body.best_image_id, keep_all=body.keep_all
            )
        except ValueError as exc:
            raise APIError(400, "bad_request", str(exc)) from exc
    for m in group["members"]:
        m["filename"] = Path(m["path"]).name
        m["thumb_url"] = f"/api/library/images/{m['image_id']}/thumb"
    return group


@router.get("/review")
def library_review_queue(
    request: Request,
    include_all: bool = False,
    limit: int = Query(default=40, ge=1, le=200),
) -> dict[str, Any]:
    rt = _get_runtime(request)
    where_clause = "" if include_all else "WHERE p.status IN ('review', 'unknown') OR l.source = 'human'"
    with rt.db_lock:
        rows = rt.conn.execute(
            f"""
            SELECT
                i.id, i.path, i.width, i.height, i.taken_at, i.sharpness, i.exposure,
                p.top1_label, p.top1_prob, p.calibrated_prob, p.status,
                l.label AS effective_label, l.source AS label_source
            FROM images i
            JOIN predictions p ON p.image_id = i.id
            JOIN labels l ON l.image_id = i.id
            {where_clause}
            ORDER BY CASE WHEN p.status = 'unknown' THEN 0 WHEN p.status = 'review' THEN 1 ELSE 2 END,
                     COALESCE(p.calibrated_prob, p.top1_prob) ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    items = [
        {
            "image_id": int(r["id"]),
            "filename": Path(str(r["path"])).name,
            "thumb_url": f"/api/library/images/{int(r['id'])}/thumb",
            "label": str(r["effective_label"]),
            "label_source": str(r["label_source"]),
            "top1_label": str(r["top1_label"]),
            "top1_prob": float(r["top1_prob"]),
            "calibrated_prob": float(r["calibrated_prob"])
            if r["calibrated_prob"] is not None
            else None,
            "status": str(r["status"]),
        }
        for r in rows
    ]
    active_ver = ensure_initial_version(rt.conn, rt.settings)
    ver_labels = json.loads(active_ver.labels_path.read_text(encoding="utf-8"))
    return {"items": items, "labels": ver_labels}


@router.delete("/images/{image_id}")
def library_delete_image(request: Request, image_id: int) -> dict[str, Any]:
    rt = _get_runtime(request)
    with rt.db_lock:
        exists = rt.conn.execute("SELECT id FROM images WHERE id = ?", (image_id,)).fetchone()
        if exists is None:
            raise APIError(404, "image_not_found", "Không tìm thấy ảnh.")
        rt.conn.execute("DELETE FROM images WHERE id = ?", (image_id,))
        rt.conn.commit()
    return {"deleted": True, "image_id": image_id}


@router.post("/images/{image_id}/label")
def library_set_label(
    request: Request, image_id: int, body: SetLabelRequest
) -> dict[str, Any]:
    rt = _get_runtime(request)
    with rt.db_lock:
        exists = rt.conn.execute("SELECT id FROM images WHERE id = ?", (image_id,)).fetchone()
        if exists is None:
            raise APIError(404, "image_not_found", "Không tìm thấy ảnh.")
        set_image_label(rt.conn, image_id, body.label.strip(), "human")
    return {"image_id": image_id, "label": body.label.strip(), "source": "human"}


@router.post("/retrain")
def library_retrain(request: Request, body: RetrainRequest) -> dict[str, str]:
    rt = _get_runtime(request)
    with rt.db_lock:
        human_count = int(
            rt.conn.execute("SELECT COUNT(*) FROM labels WHERE source = 'human'").fetchone()[0]
        )
    if human_count == 0:
        raise APIError(
            400,
            "no_corrections",
            "Cần ít nhất 1 ảnh đã được sửa/xác nhận nhãn trước khi huấn luyện lại.",
        )
    job_id = uuid4().hex
    with rt.db_lock:
        update_job(rt.conn, job_id, state="queued", progress=0.0, message="Đang chờ huấn luyện lại...")

    def _run() -> None:
        with rt.db_lock:
            try:
                rec = retrain_from_corrections(
                    rt.conn,
                    rt.settings,
                    epochs=body.epochs,
                    activate=body.activate,
                    in_place=body.in_place,
                    job_id=job_id,
                )
                if body.activate or body.in_place:
                    _apply_version_to_app(request, rec)
            except Exception as exc:
                update_job(
                    rt.conn,
                    job_id,
                    state="error",
                    progress=1.0,
                    message="Huấn luyện lại thất bại.",
                    error=str(exc),
                )

    rt.executor.submit(_run)
    return {"job_id": job_id}


def _apply_version_to_app(request: Request, rec: ModelVersionRecord) -> None:
    from app.main import load_keras_model

    labels = json.loads(rec.labels_path.read_text(encoding="utf-8"))
    model = load_keras_model(rec.checkpoint_path)
    with request.app.state.model_lock:
        request.app.state.model = model
        request.app.state.labels = labels
        request.app.state.preprocess = rec.preprocess
        request.app.state.model_reason = None
        cache = getattr(request.app.state, "loaded_models", None)
        if isinstance(cache, dict):
            cache["resnet50_finetune"] = (model, labels)
        request.app.state.bulk_jobs.set_active_model(model, labels, rec.preprocess)


@router.get("/models/versions")
def library_model_versions(request: Request) -> dict[str, Any]:
    rt = _get_runtime(request)
    with rt.db_lock:
        ensure_initial_version(rt.conn, rt.settings)
        versions = list_versions(rt.conn)
    return {"versions": [_version_to_dict(v) for v in versions]}


@router.post("/models/{version}/promote")
@router.post("/models/{version}/rollback")
async def library_promote_version(request: Request, version: str) -> dict[str, Any]:
    rt = _get_runtime(request)

    def _promote() -> dict[str, Any]:
        with rt.db_lock:
            try:
                rec = promote_version(rt.conn, version)
            except ValueError as exc:
                raise APIError(404, "version_not_found", str(exc)) from exc
            versions = list_versions(rt.conn)
        _apply_version_to_app(request, rec)
        return {
            "active_version": rec.version,
            "versions": [_version_to_dict(v) for v in versions],
        }

    return await run_in_threadpool(_promote)
