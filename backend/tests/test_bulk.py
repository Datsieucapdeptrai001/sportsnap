import csv
import json
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO, StringIO
from pathlib import Path
from threading import Event
from time import monotonic, sleep
from unittest.mock import Mock
from typing import Any
from zipfile import ZipFile

import numpy as np
import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile

from app.core.config import Settings
from app.main import create_app
from app.services.bulk_job import BulkJob, csv_cell, label_folder
from app.api.scan import locked_prediction
from app.schemas import Prediction
from app.services.inference import preprocess_image
from tests.test_predict import assert_error


@pytest.fixture
def bulk_client(inference_client: TestClient, classifier: Mock) -> Iterator[TestClient]:
    classifier.predict.side_effect = lambda batch, verbose=0: np.tile([0.7, 0.1, 0.1, 0.1], (len(batch), 1))
    yield inference_client


def upload(client: TestClient, images: list[tuple[str, bytes, str]]) -> str:
    response = client.post("/api/bulk", files=[("files", image) for image in images])
    assert response.status_code == 202, response.text
    assert set(response.json()) == {"job_id"}
    return response.json()["job_id"]


def wait_done(client: TestClient, job_id: str) -> dict[str, Any]:
    deadline = monotonic() + 20
    while monotonic() < deadline:
        response = client.get(f"/api/bulk/{job_id}")
        assert response.status_code == 200, response.text
        result = response.json()
        if result["status"] in {"done", "error", "cancelled"}:
            return result
        sleep(0.01)
    pytest.fail("Bulk job did not finish")


def test_70_images_make_three_batches_and_reuse_preprocessing(
    bulk_client: TestClient, classifier: Mock, image_bytes: bytes,
) -> None:
    job_id = upload(bulk_client, [(f"photo-{i}.png", image_bytes, "image/png") for i in range(70)])
    result = wait_done(bulk_client, job_id)
    assert result["status"] == "done"
    assert result["processed"] == result["total"] == 70
    assert result["counts"] == {"class_a": 70}
    assert result["uncertain"] == result["errors"] == 0
    assert len(result["items"]) == 50
    assert [len(call.args[0]) for call in classifier.predict.call_args_list] == [32, 32, 6]
    for call in classifier.predict.call_args_list:
        assert call.kwargs == {"verbose": 0}
        assert call.args[0].dtype == np.float32
        np.testing.assert_array_equal(call.args[0][0], preprocess_image(image_bytes)[0])
    stored = bulk_client.app.state.bulk_jobs.jobs[job_id]
    assert stored.inputs[0].path.read_bytes() == image_bytes
    assert not isinstance(stored.inputs[0], bytes)


def test_300_mixed_files_zip_layout_report_and_uncertainty(
    bulk_client: TestClient, classifier: Mock, image_bytes: bytes,
) -> None:
    classifier.predict.side_effect = lambda batch, verbose=0: np.tile([0.1, 0.55, 0.25, 0.1], (len(batch), 1))
    images = [(f"image-{i}.png", image_bytes, "image/png") for i in range(296)]
    images += [(f"broken-{i}.png", b"broken", "image/png") for i in range(3)]
    images += [("notes.txt", b"text", "text/plain")]
    job_id = upload(bulk_client, images)
    result = wait_done(bulk_client, job_id)
    assert result["status"] == "done"
    assert result["processed"] == result["total"] == 300
    assert result["errors"] == 4
    assert result["uncertain"] == 296
    assert result["items"][0]["is_uncertain"] is True
    assert len(result["items"][0]["top3"]) == 3
    response = bulk_client.get(f"/api/bulk/{job_id}/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with ZipFile(BytesIO(response.content)) as archive:
        assert len(archive.namelist()) == 301
        assert archive.read("chua_chac_chan/image-0.png") == image_bytes
        assert archive.read("loi/notes.txt") == b"text"
        rows = list(csv.DictReader(StringIO(archive.read("report.csv").decode("utf-8-sig"))))
        assert list(rows[0]) == ["filename", "predicted", "confidence", "top2", "top2_confidence", "folder", "error"]
        assert len(rows) == 300
        assert rows[0]["predicted"] == "class_b"
        assert rows[0]["folder"] == "chua_chac_chan"
        assert rows[0]["top2"] == "class_c"
        assert {row["error"] for row in rows[-4:]} == {"corrupt", "unsupported_format"}
        assert all(row["predicted"] == row["confidence"] == "" and row["folder"] == "loi" for row in rows[-4:])


def test_zip_flatten_duplicates_path_traversal_and_csv_injection(bulk_client: TestClient, image_bytes: bytes) -> None:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name in ["../../photo.png", "a/photo.png", "b/photo_2.png", r"C:\private\photo.png", "=formula.png", "+cmd.png", "-cmd.png", "@cmd.png"]:
            archive.writestr(name, image_bytes)
        archive.writestr("nested/readme.txt", "text")
    job_id = upload(bulk_client, [("photos.zip", buffer.getvalue(), "application/zip")])
    assert wait_done(bulk_client, job_id)["status"] == "done"
    with ZipFile(BytesIO(bulk_client.get(f"/api/bulk/{job_id}/download").content)) as archive:
        names = archive.namelist()
        assert {"class_a/photo.png", "class_a/photo_2.png", "class_a/photo_2_2.png", "class_a/photo_3.png"} <= set(names)
        assert all(".." not in name and "\\" not in name and not name.startswith("/") for name in names)
        rows = list(csv.DictReader(StringIO(archive.read("report.csv").decode("utf-8-sig"))))
        assert [row["filename"] for row in rows[4:8]] == ["'=formula.png", "'+cmd.png", "'-cmd.png", "'@cmd.png"]
        assert archive.read("loi/readme.txt") == b"text"


@pytest.mark.parametrize("value", ["=1+1", "+SUM(A1)", "-1", "@cmd", " \t=cmd"])
def test_csv_injection_in_every_text_column(value: str) -> None:
    assert csv_cell(value) == "'" + value


def test_oversized_and_spoofed_files_are_individual_errors(bulk_client: TestClient, image_bytes: bytes) -> None:
    bulk_client.app.state.settings.MAX_UPLOAD_MB = 1
    buffer = BytesIO()
    from PIL import Image
    Image.new("RGB", (10, 10)).save(buffer, "GIF")
    job_id = upload(bulk_client, [
        ("large.png", b"x" * (1024 * 1024 + 1), "image/png"),
        ("spoof.png", buffer.getvalue(), "image/png"),
        ("valid.png", image_bytes, "image/png"),
    ])
    result = wait_done(bulk_client, job_id)
    assert result["status"] == "done"
    assert [item["error"] for item in result["items"]] == ["too_large", "unsupported_format", None]
    with ZipFile(BytesIO(bulk_client.get(f"/api/bulk/{job_id}/download").content)) as archive:
        assert len(archive.read("loi/large.png")) == 1024 * 1024 + 1


@pytest.mark.parametrize("zipped", [False, True])
def test_file_limit_rejects_whole_job_and_cleans_staging(bulk_client: TestClient, zipped: bool) -> None:
    bulk_client.app.state.settings.MAX_BULK_FILES = 2
    if zipped:
        buffer = BytesIO()
        with ZipFile(buffer, "w") as archive:
            for i in range(3):
                archive.writestr(f"{i}.txt", "text")
        files = [("files", ("photos.zip", buffer.getvalue(), "application/zip"))]
    else:
        files = [("files", (f"{i}.png", b"data", "image/png")) for i in range(3)]
    assert_error(bulk_client.post("/api/bulk", files=files), 413, "too_many_files")
    assert not bulk_client.app.state.bulk_jobs.jobs
    assert not list(bulk_client.app.state.settings.BULK_TEMP_DIR.iterdir())


def test_multipart_supports_more_than_starlette_default_1000_files(bulk_client: TestClient) -> None:
    job_id = upload(bulk_client, [(f"{i}.txt", b"text", "text/plain") for i in range(1001)])
    result = wait_done(bulk_client, job_id)
    assert result["status"] == "done"
    assert result["total"] == result["errors"] == 1001


def test_cancellation_capacity_and_download_not_ready(
    bulk_client: TestClient, classifier: Mock, image_bytes: bytes,
) -> None:
    entered, release = Event(), Event()

    def predict(batch: np.ndarray, verbose: int = 0) -> np.ndarray:
        entered.set()
        assert release.wait(10)
        return np.tile([0.7, 0.1, 0.1, 0.1], (len(batch), 1))

    classifier.predict.side_effect = predict
    try:
        first = upload(bulk_client, [("1.png", image_bytes, "image/png")])
        assert entered.wait(10)
        second = upload(bulk_client, [("2.png", image_bytes, "image/png")])
        assert bulk_client.get(f"/api/bulk/{second}").json()["status"] == "queued"
        assert_error(bulk_client.get(f"/api/bulk/{first}/download"), 409, "job_not_ready")
        response = bulk_client.post("/api/bulk", files={"files": ("3.png", image_bytes, "image/png")})
        assert_error(response, 409, "job_not_ready")
        # Health remains responsive while inference is blocked in its own thread.
        assert bulk_client.get("/api/health").status_code == 200
        for job_id in [second, first]:
            directory = bulk_client.app.state.bulk_jobs.jobs[job_id].directory
            response = bulk_client.delete(f"/api/bulk/{job_id}")
            assert response.json()["status"] == "cancelled"
            assert not directory.exists()
            assert_error(bulk_client.get(f"/api/bulk/{job_id}/download"), 409, "job_not_ready")
        assert classifier.predict.call_count == 1
    finally:
        release.set()


def test_ttl_cleanup_never_expires_running_jobs(bulk_client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    store = bulk_client.app.state.bulk_jobs
    job_id = upload(bulk_client, [("photo.png", image_bytes, "image/png")])
    assert wait_done(bulk_client, job_id)["status"] == "done"
    job = store.jobs[job_id]
    now = job.finished_at
    pending = store.reserve()
    pending.status = "running"
    monkeypatch.setattr("app.services.bulk_job.monotonic", lambda: now + store.config.BULK_TTL_SECONDS - 1)
    assert bulk_client.get(f"/api/bulk/{job_id}").status_code == 200
    monkeypatch.setattr("app.services.bulk_job.monotonic", lambda: now + store.config.BULK_TTL_SECONDS)
    store.cleanup()
    assert not job.directory.exists()
    assert pending.directory.exists()
    assert bulk_client.get(f"/api/bulk/{pending.job_id}").status_code == 200
    for method, suffix in [("get", ""), ("get", "/download"), ("delete", "")]:
        assert_error(getattr(bulk_client, method)(f"/api/bulk/{job_id}{suffix}"), 410, "job_expired")


def test_failed_model_is_sanitized_and_expires(bulk_client: TestClient, classifier: Mock, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    classifier.predict.side_effect = RuntimeError("private failure")
    job_id = upload(bulk_client, [("photo.png", image_bytes, "image/png")])
    result = wait_done(bulk_client, job_id)
    assert result["status"] == "error"
    assert "private" not in str(result)
    assert result["error"]
    store = bulk_client.app.state.bulk_jobs
    job = store.jobs[job_id]
    monkeypatch.setattr("app.services.bulk_job.monotonic", lambda: job.finished_at + store.config.BULK_TTL_SECONDS)
    assert_error(bulk_client.get(f"/api/bulk/{job_id}"), 410, "job_expired")
    assert not job.directory.exists()


def test_bulk_missing_model_and_unknown_id(tmp_path: Path, image_bytes: bytes) -> None:
    with TestClient(create_app(Settings(BASE_DIR=tmp_path, _env_file=None))) as client:
        assert_error(client.post("/api/bulk", files={"files": ("a.png", image_bytes, "image/png")}), 503, "model_not_loaded")
        assert_error(client.get("/api/bulk/unknown"), 404, "job_not_found")
        assert_error(client.delete("/api/bulk/unknown"), 404, "job_not_found")


@pytest.mark.parametrize("case", ["missing", "wrong_field", "invalid_zip", "empty_zip", "malformed"])
def test_bad_requests_clean_staging(bulk_client: TestClient, case: str) -> None:
    if case == "missing":
        response = bulk_client.post("/api/bulk")
    elif case == "wrong_field":
        response = bulk_client.post("/api/bulk", files={"file": ("a.png", b"x", "image/png")})
    elif case == "invalid_zip":
        response = bulk_client.post("/api/bulk", files={"files": ("a.zip", b"invalid", "application/zip")})
    elif case == "empty_zip":
        buffer = BytesIO()
        with ZipFile(buffer, "w"):
            pass
        response = bulk_client.post("/api/bulk", files={"files": ("a.zip", buffer.getvalue(), "application/zip")})
    else:
        response = bulk_client.post("/api/bulk", content=b"broken", headers={"Content-Type": "multipart/form-data"})
    assert_error(response, 422 if case == "invalid_zip" else 400, "invalid_image" if case == "invalid_zip" else "bad_request")
    assert not bulk_client.app.state.bulk_jobs.jobs


def test_label_folder_slug() -> None:
    assert label_folder("Bóng Đá / Test!") == "bong_da__test"


def test_bulk_settings_defaults_and_paths(tmp_path: Path) -> None:
    settings = Settings(BASE_DIR=tmp_path, _env_file=None)
    assert settings.MAX_BULK_FILES == 2000
    assert settings.BULK_BATCH_SIZE == 32
    assert settings.BULK_TTL_SECONDS == 1800
    assert settings.BULK_MAX_ACTIVE_JOBS == 2
    assert settings.CONFIDENCE_THRESHOLD == 0.60
    assert settings.BULK_TEMP_DIR == tmp_path / "backend/tmp/bulk"


@pytest.mark.parametrize("confidence,uncertain", [(0.59, True), (0.60, False)])
def test_uncertain_boundary_stays_at_060(
    bulk_client: TestClient, classifier: Mock, image_bytes: bytes, confidence: float, uncertain: bool,
) -> None:
    classifier.predict.side_effect = lambda batch, verbose=0: np.tile([confidence, 0.2, 0.1, 0.1], (len(batch), 1))
    job_id = upload(bulk_client, [("a.png", image_bytes, "image/png")])
    item = wait_done(bulk_client, job_id)["items"][0]
    assert item["is_uncertain"] is uncertain
    assert item["folder"] == ("chua_chac_chan" if uncertain else "class_a")


def test_single_oversized_file_is_not_a_job_failure(bulk_client: TestClient) -> None:
    config = bulk_client.app.state.settings
    config.MAX_BULK_FILES = 1
    config.MAX_UPLOAD_MB = 1
    job_id = upload(bulk_client, [("large.png", b"x" * (2 * 1024 * 1024), "image/png")])
    result = wait_done(bulk_client, job_id)
    assert result["status"] == "done"
    assert result["items"][0]["error"] == "too_large"


def test_uploads_are_spooled_to_disk_before_staging(
    bulk_client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = bulk_client.app.state.bulk_jobs
    stage = store.stage

    def check_stage(job: BulkJob, files: list[UploadFile]) -> None:
        assert all(file.file._rolled for file in files)
        stage(job, files)

    monkeypatch.setattr(store, "stage", check_stage)
    response = bulk_client.post("/api/bulk", files=[("files[]", ("small.png", image_bytes, "image/png"))])
    assert response.status_code == 202
    assert wait_done(bulk_client, response.json()["job_id"])["status"] == "done"


@pytest.mark.parametrize("action", ["cancel", "expire"])
def test_download_lease_defers_cleanup_until_stream_closes(
    bulk_client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch, action: str,
) -> None:
    job_id = upload(bulk_client, [("a.png", image_bytes, "image/png")])
    assert wait_done(bulk_client, job_id)["status"] == "done"
    store = bulk_client.app.state.bulk_jobs
    job = store.jobs[job_id]
    chunks, release = store.download(job_id)
    if action == "cancel":
        store.cancel_job(job_id)
    else:
        monkeypatch.setattr("app.services.bulk_job.monotonic", lambda: job.finished_at + store.config.BULK_TTL_SECONDS)
        store.cleanup()
    assert job.directory.exists()
    data = b"".join(chunks)
    release()  # Background release is idempotent.
    with ZipFile(BytesIO(data)) as archive:
        assert archive.read("class_a/a.png") == image_bytes
    assert not job.directory.exists()
    assert job.downloads == 0


def test_periodic_cleanup_runs_without_polling(tmp_path: Path) -> None:
    config = Settings(BASE_DIR=tmp_path, BULK_CLEANUP_INTERVAL_SECONDS=1, BULK_TTL_SECONDS=1, _env_file=None)
    with TestClient(create_app(config)) as client:
        store = client.app.state.bulk_jobs
        job = store.reserve()
        job.status = "done"
        job.finished_at = monotonic() - 2
        deadline = monotonic() + 5
        while job.directory.exists() and monotonic() < deadline:
            sleep(0.02)
        assert not job.directory.exists()
        assert job.job_id in store.expired


def test_bulk_and_predict_share_model_lock(
    bulk_client: TestClient, classifier: Mock, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered, release, single_entered = Event(), Event(), Event()

    def predict(batch: np.ndarray, verbose: int = 0) -> np.ndarray:
        if not entered.is_set():
            entered.set()
            assert release.wait(10)
        return np.tile([0.7, 0.1, 0.1, 0.1], (len(batch), 1))

    def observed_lock(request: Request, operation: Callable[[], Prediction]) -> Prediction:
        single_entered.set()
        return locked_prediction(request, operation)

    classifier.predict.side_effect = predict
    monkeypatch.setattr("app.api.scan.locked_prediction", observed_lock)
    with ThreadPoolExecutor(max_workers=1) as executor:
        try:
            job_id = upload(bulk_client, [("bulk.png", image_bytes, "image/png")])
            assert entered.wait(5)
            future = executor.submit(bulk_client.post, "/api/predict", files={"file": ("one.png", image_bytes, "image/png")})
            assert single_entered.wait(5)
            assert classifier.predict.call_count == 1
        finally:
            release.set()
        assert future.result(timeout=10).status_code == 200
    assert wait_done(bulk_client, job_id)["status"] == "done"
    assert classifier.predict.call_count == 2


def test_real_model_bulk_matches_unchanged_golden_expectations() -> None:
    golden_dir = Path(__file__).parent / "golden"
    expected = json.loads((golden_dir / "expected.json").read_text(encoding="utf-8"))
    with TestClient(create_app(Settings())) as client:
        images = [(entry["file"], (golden_dir / entry["file"]).read_bytes(), "image/png") for entry in expected]
        job_id = upload(client, images)
        result = wait_done(client, job_id)
        assert result["status"] == "done"
        assert result["errors"] == 0
        assert result["processed"] == len(expected)
        for item, entry in zip(result["items"], expected):
            assert item["label"] == entry["label"]
            assert abs(item["confidence"] - entry["confidence"]) <= 0.01
