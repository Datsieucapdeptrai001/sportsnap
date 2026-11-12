from pathlib import Path

from app.core.config import Settings


def test_dotenv_paths_and_limits_are_independent_of_working_directory(
    tmp_path: Path,
) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        f"BASE_DIR={tmp_path.as_posix()}\nMODEL_PATH=models/custom.keras\n"
        "LABELS_PATH=models/custom.json\nFRONTEND_DIST=web/dist\n"
        "PREPROCESS=mobilenet_v2\nCONFIDENCE_THRESHOLD=0.7\n"
        "MAX_UPLOAD_MB=8\nMAX_BULK_FILES=100\n"
        "DEBUG_SAVE_FRAMES=1\nDEBUG_FRAMES_DIR=diagnostics/frames\n",
        encoding="utf-8",
    )
    config = Settings(_env_file=dotenv)
    assert config.MODEL_PATH == tmp_path / "models/custom.keras"
    assert config.LABELS_PATH == tmp_path / "models/custom.json"
    assert config.FRONTEND_DIST == tmp_path / "web/dist"
    assert config.CONFIDENCE_THRESHOLD == 0.7
    assert config.MAX_UPLOAD_MB == 8
    assert config.MAX_BULK_FILES == 100
    assert config.DEBUG_SAVE_FRAMES is True
    assert config.DEBUG_FRAMES_DIR == tmp_path / "diagnostics/frames"


def test_dotenv_accepts_resnet50_preprocess(tmp_path: Path) -> None:
    dotenv = tmp_path / ".env"
    dotenv.write_text("PREPROCESS=resnet50\n", encoding="utf-8")
    config = Settings(_env_file=dotenv)
    assert config.PREPROCESS == "resnet50"
