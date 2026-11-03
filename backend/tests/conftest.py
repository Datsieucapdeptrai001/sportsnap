from collections.abc import Iterator
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def image_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (360, 180), (20, 110, 230)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def classifier() -> Mock:
    return Mock(predict=Mock(return_value=np.array([[0.15, 0.55, 0.25, 0.05]])))


@pytest.fixture
def inference_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, classifier: Mock
) -> Iterator[TestClient]:
    config = Settings(BASE_DIR=tmp_path, _env_file=None)
    config.MODEL_PATH.parent.mkdir(parents=True)
    config.MODEL_PATH.touch()
    config.LABELS_PATH.write_text('["class_a", "class_b", "class_c", "class_d"]', encoding="utf-8")
    classifier.output_shape = (None, 4)
    monkeypatch.setattr("app.main.load_keras_model", Mock(return_value=classifier))
    with TestClient(create_app(config), raise_server_exceptions=False) as client:
        yield client
