from io import BytesIO
from unittest.mock import Mock
from zipfile import ZipFile

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from tests.test_bulk import bulk_client, upload, wait_done
from tests.test_predict import assert_error


@pytest.fixture
def hundred_results(bulk_client: TestClient, classifier: Mock, image_bytes: bytes) -> tuple[TestClient, str]:
    bulk_client.app.state.bulk_jobs.labels = ["football", "polo", "golf", "swimming"]
    processed = 0

    def predict(batch: np.ndarray, verbose: int = 0) -> np.ndarray:
        nonlocal processed
        rows: list[list[float]] = []
        for index in range(processed, processed + len(batch)):
            confidence = 0.55 if index == 10 else (0.59 if index == 90 else 0.7 if index < 75 else 0.65 + (index % 20) / 100)
            row = [(1 - confidence) / 3] * 4
            row[0 if index < 75 else 1] = confidence
            rows.append(row)
        processed += len(batch)
        return np.array(rows)

    classifier.predict.side_effect = predict
    job_id = upload(bulk_client, [(f"photo-{99-index:03}.png", image_bytes, "image/png") for index in range(100)])
    assert wait_done(bulk_client, job_id)["status"] == "done"
    return bulk_client, job_id


def test_label_filter_covers_polo_beyond_legacy_snapshot(hundred_results: tuple[TestClient, str]) -> None:
    client, job_id = hundred_results
    response = client.get(f"/api/bulk/{job_id}/results", params={"label": "polo", "limit": 100})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["total"] == 25
    assert {item["index"] for item in result["items"]} == set(range(75, 100))
    assert all(item["label"] == "polo" for item in result["items"])
    assert result["summary"] == {"total": 100, "processed": 100, "uncertain": 2, "errors": 0, "counts": {"football": 75, "polo": 25}}


def test_pagination_total_offset_default_and_last_page(hundred_results: tuple[TestClient, str]) -> None:
    client, job_id = hundred_results
    base = f"/api/bulk/{job_id}/results"
    first = client.get(base, params={"label": "polo"}).json()
    second = client.get(base, params={"label": "polo", "offset": 24}).json()
    assert first["limit"] == second["limit"] == 24
    assert first["offset"] == 0 and second["offset"] == 24
    assert first["total"] == second["total"] == 25
    assert len(first["items"]) == 24 and len(second["items"]) == 1
    assert {item["index"] for item in first["items"]}.isdisjoint(item["index"] for item in second["items"])
    assert client.get(base, params={"offset": 1000}).json()["items"] == []
    assert client.get(base, params={"label": "missing"}).json()["total"] == 0


def test_uncertain_combines_with_label_without_changing_summary(hundred_results: tuple[TestClient, str]) -> None:
    client, job_id = hundred_results
    result = client.get(f"/api/bulk/{job_id}/results", params={"label": "polo", "uncertain": "true"}).json()
    assert result["total"] == 1
    assert result["items"][0]["index"] == 90
    assert result["summary"]["uncertain"] == 2
    assert result["summary"]["counts"]["polo"] == 25


@pytest.mark.parametrize("sort", ["confidence_asc", "confidence_desc", "filename"])
def test_global_sort_before_paging(hundred_results: tuple[TestClient, str], sort: str) -> None:
    client, job_id = hundred_results
    all_rows = client.get(f"/api/bulk/{job_id}/results", params={"sort": sort, "limit": 100}).json()["items"]
    if sort == "filename":
        assert [item["filename"] for item in all_rows] == sorted(item["filename"] for item in all_rows)
    else:
        confidences = [item["confidence"] for item in all_rows]
        assert confidences == sorted(confidences, reverse=sort == "confidence_desc")
    page = client.get(f"/api/bulk/{job_id}/results", params={"sort": sort, "offset": 24, "limit": 24}).json()
    assert page["items"] == all_rows[24:48]


@pytest.mark.parametrize("params", [{"offset": -1}, {"limit": 0}, {"limit": 101}, {"sort": "random"}, {"uncertain": "invalid"}])
def test_invalid_results_query_uses_vietnamese_error(bulk_client: TestClient, params: dict[str, object]) -> None:
    assert_error(bulk_client.get("/api/bulk/unknown/results", params=params), 400, "bad_request")


def test_empty_query_values_use_defaults(bulk_client: TestClient, image_bytes: bytes) -> None:
    job_id = upload(bulk_client, [("a.png", image_bytes, "image/png")])
    wait_done(bulk_client, job_id)
    response = bulk_client.get(f"/api/bulk/{job_id}/results?label=&uncertain=&sort=&offset=&limit=")
    assert response.status_code == 200, response.text
    assert response.json()["limit"] == 24


def test_thumbnail_jpeg_size_cache_and_original_unchanged(bulk_client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    job_id = upload(bulk_client, [("a.png", image_bytes, "image/png")])
    wait_done(bulk_client, job_id)
    job = bulk_client.app.state.bulk_jobs.jobs[job_id]
    cache = job.directory / "thumbs/0.jpg"
    assert not cache.exists()
    response = bulk_client.get(f"/api/bulk/{job_id}/thumb/0")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"].startswith("private")
    with Image.open(BytesIO(response.content)) as image:
        assert image.format == "JPEG" and image.mode == "RGB"
        assert image.size == (256, 128)
    assert job.inputs[0].path.read_bytes() == image_bytes
    monkeypatch.setattr("app.services.bulk_job.Image.open", Mock(side_effect=AssertionError("cache miss")))
    assert bulk_client.get(f"/api/bulk/{job_id}/thumb/0").content == response.content


def test_display_exif_and_large_image_bounds(bulk_client: TestClient) -> None:
    buffer = BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (3000, 1500), "red").save(buffer, "PNG", exif=exif)
    job_id = upload(bulk_client, [("rotated.png", buffer.getvalue(), "image/png")])
    wait_done(bulk_client, job_id)
    for kind, expected in [("thumb", (128, 256)), ("image", (1024, 2048))]:
        response = bulk_client.get(f"/api/bulk/{job_id}/{kind}/0")
        assert response.status_code == 200
        with Image.open(BytesIO(response.content)) as image:
            assert image.size == expected
            assert image.format == "JPEG"


def test_zip_images_and_duplicate_names_are_addressed_by_index(bulk_client: TestClient) -> None:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for folder, color in [("one", "red"), ("two", "blue")]:
            data = BytesIO()
            Image.new("RGB", (24, 12), color).save(data, "PNG")
            archive.writestr(f"{folder}/same.png", data.getvalue())
    job_id = upload(bulk_client, [("photos.zip", buffer.getvalue(), "application/zip")])
    wait_done(bulk_client, job_id)
    for index, channel in [(0, 0), (1, 2)]:
        response = bulk_client.get(f"/api/bulk/{job_id}/thumb/{index}")
        with Image.open(BytesIO(response.content)) as image:
            assert image.getpixel((0, 0))[channel] > 240


@pytest.mark.parametrize("index,status", [("-1", 404), ("100", 404), ("abc", 400), ("..%2F..%2Flabels.json", 404)])
def test_image_index_rejects_invalid_and_traversal(bulk_client: TestClient, image_bytes: bytes, index: str, status: int) -> None:
    job_id = upload(bulk_client, [("a.png", image_bytes, "image/png")])
    wait_done(bulk_client, job_id)
    for kind in ("thumb", "image"):
        response = bulk_client.get(f"/api/bulk/{job_id}/{kind}/{index}")
        assert response.status_code == status
        assert isinstance(response.json()["error"]["message"], str)


def test_corrupt_and_non_images_return_404(bulk_client: TestClient) -> None:
    job_id = upload(bulk_client, [("broken.png", b"broken", "image/png"), ("notes.txt", b"notes", "text/plain")])
    wait_done(bulk_client, job_id)
    rows = bulk_client.get(f"/api/bulk/{job_id}/results", params={"sort": "confidence_asc"}).json()
    assert rows["summary"]["errors"] == rows["total"] == 2
    for index in (0, 1):
        for kind in ("thumb", "image"):
            assert_error(bulk_client.get(f"/api/bulk/{job_id}/{kind}/{index}"), 404, "image_not_found")


@pytest.mark.parametrize("action", ["delete", "ttl"])
def test_cached_images_deleted_with_job(bulk_client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch, action: str) -> None:
    job_id = upload(bulk_client, [("a.png", image_bytes, "image/png")])
    wait_done(bulk_client, job_id)
    store = bulk_client.app.state.bulk_jobs
    job = store.jobs[job_id]
    assert bulk_client.get(f"/api/bulk/{job_id}/thumb/0").status_code == 200
    assert bulk_client.get(f"/api/bulk/{job_id}/image/0").status_code == 200
    if action == "delete":
        response = bulk_client.delete(f"/api/bulk/{job_id}")
        assert response.json()["status"] == "done"
        assert response.json()["files_removed"] is True
        assert bulk_client.get(f"/api/bulk/{job_id}").json()["status"] == "done"
        assert_error(bulk_client.get(f"/api/bulk/{job_id}/download"), 409, "job_not_ready")
        assert_error(bulk_client.get(f"/api/bulk/{job_id}/thumb/0"), 404, "image_not_found")
        assert bulk_client.delete(f"/api/bulk/{job_id}").json()["status"] == "done"
    else:
        monkeypatch.setattr("app.services.bulk_job.monotonic", lambda: job.finished_at + store.config.BULK_TTL_SECONDS)
        assert_error(bulk_client.get(f"/api/bulk/{job_id}/thumb/0"), 410, "job_expired")
        assert_error(bulk_client.get(f"/api/bulk/{job_id}/results"), 410, "job_expired")
    assert not job.directory.exists()


def test_missing_job_endpoints(bulk_client: TestClient) -> None:
    for suffix in ("results", "thumb/0", "image/0"):
        assert_error(bulk_client.get(f"/api/bulk/unknown/{suffix}"), 404, "job_not_found")
