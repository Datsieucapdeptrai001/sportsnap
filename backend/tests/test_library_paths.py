"""Library paths stored on another machine must still resolve inside this project."""

from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sportsnap_lib.paths import resolve_stored_path  # noqa: E402


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    return path


def test_existing_path_is_returned_unchanged(tmp_path: Path) -> None:
    f = _touch(tmp_path / "a.jpg")
    assert resolve_stored_path(str(f), tmp_path) == f


def test_windows_path_from_other_machine_is_rerooted(tmp_path: Path) -> None:
    f = _touch(tmp_path / "datasets" / "anh-ngoai" / "tennis" / "1.jpg")
    stored = r"Z:\other\tgmt\datasets\anh-ngoai\tennis\1.jpg"
    assert resolve_stored_path(stored, tmp_path) == f


def test_thumb_falls_back_to_thumbs_dir_by_name(tmp_path: Path) -> None:
    thumbs = tmp_path / "store" / "thumbs"
    f = _touch(thumbs / "abc.jpg")
    stored = r"Z:\elsewhere\cache\abc.jpg"
    assert resolve_stored_path(stored, tmp_path, (thumbs,)) == f


def test_missing_file_returns_none(tmp_path: Path) -> None:
    assert resolve_stored_path(r"Z:\nope\datasets\x.jpg", tmp_path) is None
    assert resolve_stored_path("", tmp_path) is None
