"""Disk-backed bulk jobs; only a single inference batch is held in memory."""

import csv
import logging
import re
import shutil
import tempfile
import unicodedata
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event, Lock
from time import monotonic
from typing import BinaryIO
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

import numpy as np
from starlette.datastructures import UploadFile

from app.core.config import Settings
from app.core.errors import APIError
from app.schemas import BulkItem, BulkStatus, ClassConfidence
from app.services.inference import Classifier, SUPPORTED_CONTENT_TYPES, preprocess_image


logger = logging.getLogger(__name__)
TERMINAL = {"done", "error", "cancelled"}


def safe_filename(name: str, used: set[str]) -> str:
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "_", name).strip().rstrip(". ")
    name = name.encode("utf-8")[:180].decode("utf-8", errors="ignore").rstrip(". ")
    if not name or name in {".", ".."}:
        name = "file"
    if re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])", name.split(".")[0]):
        name = "_" + name
    path = Path(name)
    candidate, index = name, 2
    while candidate.casefold() in used:
        candidate = f"{path.stem}_{index}{path.suffix}"
        index += 1
    used.add(candidate.casefold())
    return candidate


def label_folder(label: str) -> str:
    normal = unicodedata.normalize("NFKD", label.lower().replace("đ", "d"))
    normal = "".join(char for char in normal if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_]", "", re.sub(r"\s+", "_", normal)) or "sport"


def csv_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


@dataclass
class InputImage:
    filename: str
    path: Path
    error: str | None = None


@dataclass
class BulkJob:
    job_id: str
    directory: Path
    status: str = "queued"
    inputs: list[InputImage] = field(default_factory=list)
    items: list[BulkItem] = field(default_factory=list)
    error: str | None = None
    finished_at: float | None = None
    cancel: Event = field(default_factory=Event)
    io_lock: Lock = field(default_factory=Lock)
    future: Future[None] | None = None
    downloads: int = 0


class BulkJobStore:
    def __init__(
        self, config: Settings, model: Classifier | None, labels: list[str], model_lock: Lock,
    ) -> None:
        self.config = config
        self.model = model
        self.labels = labels
        self.model_lock = model_lock
        self.lock = Lock()
        self.jobs: dict[str, BulkJob] = {}
        self.expired: set[str] = set()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sportsnap-bulk")

    def reserve(self) -> BulkJob:
        with self.lock:
            if sum(job.status not in TERMINAL for job in self.jobs.values()) >= self.config.BULK_MAX_ACTIVE_JOBS:
                raise APIError(409, "job_not_ready", "Đã đủ lượt phân loại đang chờ hoặc chạy. Vui lòng đợi.")
            self.config.BULK_TEMP_DIR.mkdir(parents=True, exist_ok=True)
            directory = Path(tempfile.mkdtemp(prefix="job-", dir=self.config.BULK_TEMP_DIR))
            job = BulkJob(uuid4().hex, directory)
            self.jobs[job.job_id] = job
            return job

    def discard(self, job: BulkJob) -> None:
        with self.lock:
            self.jobs.pop(job.job_id, None)
        self._remove_files(job)

    def _remove_files(self, job: BulkJob) -> None:
        with job.io_lock:
            if job.downloads == 0 and job.directory.exists():
                shutil.rmtree(job.directory)

    def stage(self, job: BulkJob, files: list[UploadFile]) -> None:
        used: set[str] = set()
        limit = self.config.MAX_UPLOAD_MB * 1024 * 1024
        source_dir = job.directory / "input"
        source_dir.mkdir()

        def save(source: BinaryIO, name: str, supported: bool, size: int | None) -> None:
            if len(job.inputs) >= self.config.MAX_BULK_FILES:
                raise APIError(413, "too_many_files", f"Chỉ được gửi tối đa {self.config.MAX_BULK_FILES} tệp mỗi lượt.")
            filename = safe_filename(name, used)
            path = source_dir / filename
            actual = 0
            error = None
            try:
                with path.open("wb") as target:
                    while chunk := source.read(1024 * 1024):
                        actual += len(chunk)
                        target.write(chunk)
            except (BadZipFile, RuntimeError, NotImplementedError):
                error = "corrupt"
            if actual > limit or (size is not None and size > limit):
                error = "too_large"
            if error is None and not supported:
                error = "unsupported_format"
            job.inputs.append(InputImage(filename, path, error))

        archive = len(files) == 1 and (files[0].filename or "").lower().endswith(".zip")
        if archive:
            try:
                with ZipFile(files[0].file) as zipped:
                    entries = [entry for entry in zipped.infolist() if not entry.is_dir()]
                    if len(entries) > self.config.MAX_BULK_FILES:
                        raise APIError(413, "too_many_files", f"ZIP vượt giới hạn {self.config.MAX_BULK_FILES} tệp.")
                    for entry in entries:
                        try:
                            with zipped.open(entry) as source:
                                save(source, entry.filename, Path(entry.filename).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}, entry.file_size)
                        except (BadZipFile, RuntimeError, NotImplementedError):
                            # Unreadable members still receive an individual error row.
                            filename = safe_filename(entry.filename, used)
                            path = source_dir / filename
                            path.touch()
                            job.inputs.append(InputImage(filename, path, "corrupt"))
            except BadZipFile as exc:
                raise APIError(422, "invalid_image", "Không đọc được tệp ZIP. Vui lòng chọn tệp khác.") from exc
        else:
            for upload in files:
                save(upload.file, upload.filename or "file", upload.content_type in SUPPORTED_CONTENT_TYPES, upload.size)
        if not job.inputs:
            raise APIError(400, "bad_request", "Vui lòng chọn ảnh hoặc ZIP chứa ảnh.")

    def submit(self, job: BulkJob) -> None:
        job.future = self.executor.submit(self._run, job)

    def _run(self, job: BulkJob) -> None:
        try:
            with self.lock:
                if job.cancel.is_set():
                    return
                job.status = "running"
            for offset in range(0, len(job.inputs), self.config.BULK_BATCH_SIZE):
                if job.cancel.is_set():
                    return
                inputs = job.inputs[offset:offset + self.config.BULK_BATCH_SIZE]
                items = [BulkItem(filename=image.filename, error=image.error) for image in inputs]
                valid: list[int] = []
                arrays: list[np.ndarray] = []
                for index, image in enumerate(inputs):
                    if job.cancel.is_set():
                        return
                    if image.error:
                        continue
                    try:
                        arrays.append(preprocess_image(image.path.read_bytes()))
                        valid.append(index)
                    except APIError as exc:
                        items[index].error = "unsupported_format" if exc.body.error.code == "unsupported_format" else "corrupt"
                    except OSError:
                        items[index].error = "corrupt"
                if valid:
                    batch = np.concatenate(arrays, axis=0)
                    del arrays
                    with self.model_lock:
                        if job.cancel.is_set():
                            return
                        if self.model is None:
                            raise RuntimeError("Model is not available")
                        outputs = np.asarray(self.model.predict(batch, verbose=0))
                    del batch
                    if (outputs.shape != (len(valid), len(self.labels)) or not self.labels
                            or not np.isfinite(outputs).all() or (outputs < 0).any() or (outputs > 1).any()):
                        raise ValueError("Invalid model output")
                    for index, probabilities in zip(valid, outputs):
                        top3 = [ClassConfidence(label=self.labels[int(i)], confidence=float(probabilities[i]))
                                for i in np.argsort(-probabilities, kind="stable")[:3]]
                        uncertain = top3[0].confidence < self.config.CONFIDENCE_THRESHOLD
                        items[index] = BulkItem(
                            filename=inputs[index].filename, label=top3[0].label,
                            confidence=top3[0].confidence, is_uncertain=uncertain, top3=top3,
                            folder="chua_chac_chan" if uncertain else label_folder(top3[0].label),
                        )
                with self.lock:
                    if job.cancel.is_set():
                        return
                    job.items.extend(items)
            with job.io_lock:
                if job.cancel.is_set():
                    return
                self._build_zip(job)
            with self.lock:
                if not job.cancel.is_set():
                    job.status = "done"
                    job.finished_at = monotonic()
        except Exception:
            if not job.cancel.is_set():
                logger.exception("Bulk inference failed.")
                with self.lock:
                    if not job.cancel.is_set():
                        job.status = "error"
                        job.error = "Không thể hoàn tất phân loại. Vui lòng thử lại."
                        job.finished_at = monotonic()
        finally:
            if job.cancel.is_set():
                self._remove_files(job)

    def _build_zip(self, job: BulkJob) -> None:
        report = job.directory / "report.csv"
        with report.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["filename", "predicted", "confidence", "top2", "top2_confidence", "folder", "error"])
            for item in job.items:
                second = item.top3[1] if len(item.top3) > 1 else None
                writer.writerow([csv_cell(value) for value in (
                    item.filename, item.label, item.confidence, second.label if second else None,
                    second.confidence if second else None, item.folder, item.error,
                )])
        with ZipFile(job.directory / "result.zip", "w") as archive:
            for image, item in zip(job.inputs, job.items):
                if job.cancel.is_set():
                    return
                archive.write(image.path, f"{item.folder}/{item.filename}")
            archive.write(report, "report.csv")

    def _get(self, job_id: str) -> BulkJob:
        if job_id in self.expired:
            raise APIError(410, "job_expired", "Lượt phân loại đã hết hạn. Vui lòng gửi lại ảnh.")
        job = self.jobs.get(job_id)
        if job is None:
            raise APIError(404, "job_not_found", "Không tìm thấy lượt phân loại.")
        return job

    def snapshot(self, job_id: str) -> BulkStatus:
        self.cleanup()
        with self.lock:
            job = self._get(job_id)
            counts: dict[str, int] = {}
            for item in job.items:
                if item.label:
                    counts[item.label] = counts.get(item.label, 0) + 1
            return BulkStatus(
                status=job.status, processed=len(job.items), total=len(job.inputs),
                uncertain=sum(item.is_uncertain for item in job.items),
                errors=sum(item.error is not None for item in job.items), counts=counts,
                items=[item.model_copy(deep=True) for item in job.items[:50]], error=job.error,
            )

    def cancel_job(self, job_id: str) -> BulkStatus:
        self.cleanup()
        with self.lock:
            job = self._get(job_id)
            job.cancel.set()
            job.status = "cancelled"
            job.finished_at = monotonic()
            if job.future:
                job.future.cancel()
        self._remove_files(job)
        return self.snapshot(job_id)

    def download(self, job_id: str) -> tuple[Iterator[bytes], Callable[[], None]]:
        self.cleanup()
        # Open before responding, and keep a lease until streaming finishes.
        with self.lock:
            job = self._get(job_id)
            if job.status != "done":
                raise APIError(409, "job_not_ready", "Chỉ có thể tải ZIP khi phân loại đã hoàn tất.")
            with job.io_lock:
                stream = (job.directory / "result.zip").open("rb")
                job.downloads += 1

        def release() -> None:
            with job.io_lock:
                if not stream.closed:
                    stream.close()
                    job.downloads -= 1
            if job.cancel.is_set() or job.job_id in self.expired:
                self._remove_files(job)

        def chunks() -> Iterator[bytes]:
            try:
                while chunk := stream.read(1024 * 1024):
                    yield chunk
            finally:
                release()

        return chunks(), release

    def cleanup(self) -> None:
        now = monotonic()
        with self.lock:
            old = [job for job in self.jobs.values() if job.finished_at is not None
                   and now >= job.finished_at + self.config.BULK_TTL_SECONDS]
            for job in old:
                self.expired.add(job.job_id)
                del self.jobs[job.job_id]
        for job in old:
            self._remove_files(job)

    def close(self) -> None:
        with self.lock:
            jobs = list(self.jobs.values())
            for job in jobs:
                job.cancel.set()
        self.executor.shutdown(wait=True, cancel_futures=True)
        for job in jobs:
            self._remove_files(job)
