import json
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from pydantic import BaseModel, Field, TypeAdapter

from app.core.config import Settings
from app.main import create_app


GOLDEN_DIR = Path(__file__).resolve().parent


class GoldenExpectation(BaseModel):
    file: str
    label: str
    confidence: float = Field(ge=0, le=1)


def test_real_model_golden_regression_and_exif() -> None:
    manifest = GOLDEN_DIR / "expected.json"
    assert manifest.is_file(), "Golden gate requires expected.json and 224x224 reference images."
    expected = TypeAdapter(list[GoldenExpectation]).validate_python(
        json.loads(manifest.read_text(encoding="utf-8")), strict=True
    )
    assert expected, "An empty golden manifest cannot pass the regression gate."
    assert len({item.file for item in expected}) == len(expected)
    config = Settings()
    assert config.MODEL_PATH.is_file() and config.LABELS_PATH.is_file(), "Golden gate requires the unchanged model and labels."

    with TestClient(create_app(config)) as client:
        assert client.get("/api/health").json()["model_loaded"] is True
        labels = client.get("/api/classes").json()["classes"]
        for entry in expected:
            assert Path(entry.file).name == entry.file
            path = GOLDEN_DIR / entry.file
            with Image.open(path) as image:
                assert image.size == (224, 224), entry.file
            assert entry.label in labels
            response = client.post("/api/predict", files={"file": (entry.file, path.read_bytes(), "image/png")})
            assert response.status_code == 200, response.text
            actual = response.json()
            assert actual["label"] == entry.label, entry.file
            assert abs(actual["confidence"] - entry.confidence) <= 0.01, entry.file
            assert actual["is_uncertain"] == (actual["confidence"] < config.CONFIDENCE_THRESHOLD)
            assert len(actual["top3"]) == 3

        # A phone rotation represented losslessly: require identical real predictions.
        with Image.open(GOLDEN_DIR / expected[0].file) as image:
            exif = Image.Exif()
            exif[274] = 6
            rotated = BytesIO()
            image.transpose(Image.Transpose.ROTATE_90).save(rotated, format="PNG", exif=exif)
        response = client.post("/api/predict", files={"file": ("rotated.png", rotated.getvalue(), "image/png")})
        assert response.status_code == 200
        assert response.json()["label"] == expected[0].label
        assert abs(response.json()["confidence"] - expected[0].confidence) <= 0.01


def test_non_sport_image_is_uncertain() -> None:
    config = Settings()
    assert config.MODEL_PATH.is_file() and config.LABELS_PATH.is_file(), "Acceptance check requires the unchanged model and labels."
    buffer = BytesIO()
    Image.new("RGB", (224, 224), (128, 128, 128)).save(buffer, format="PNG")
    with TestClient(create_app(config)) as client:
        response = client.post("/api/predict", files={"file": ("blank.png", buffer.getvalue(), "image/png")})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["confidence"] < config.CONFIDENCE_THRESHOLD
        assert result["is_uncertain"] is True
