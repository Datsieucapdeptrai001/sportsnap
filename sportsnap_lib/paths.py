"""Resolve file paths stored in library.db when the project lives on another machine or folder."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path, PurePosixPath, PureWindowsPath

# Folders that sit directly under the project root and may appear inside stored absolute paths.
_PROJECT_ANCHORS = ("datasets", "data")


def _parts(stored: str) -> tuple[str, ...]:
    # Paths written on Windows use backslashes; read them correctly on any OS.
    pure = PureWindowsPath(stored) if "\\" in stored else PurePosixPath(stored)
    return pure.parts


def resolve_stored_path(
    stored: str, project_root: Path, fallback_dirs: Iterable[Path] = ()
) -> Path | None:
    """Return an existing file for a stored path, or None.

    Order: the stored path as-is; the same path re-rooted at this project from the last
    `datasets`/`data` segment (e.g. D:/tgmt/datasets/x.jpg -> <root>/datasets/x.jpg);
    then the bare file name inside each fallback directory.
    """
    if not stored:
        return None
    direct = Path(stored)
    if direct.is_file():
        return direct
    parts = _parts(stored)
    for anchor in _PROJECT_ANCHORS:
        lowered = [p.lower() for p in parts]
        if anchor in lowered:
            idx = len(lowered) - 1 - lowered[::-1].index(anchor)
            candidate = project_root.joinpath(*parts[idx:])
            if candidate.is_file():
                return candidate
    name = parts[-1] if parts else ""
    for folder in fallback_dirs:
        candidate = folder / name
        if name and candidate.is_file():
            return candidate
    return None
