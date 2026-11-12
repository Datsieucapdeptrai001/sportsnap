"""Vector index interface and NumPy/FAISS implementations for cosine search."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np
from numpy.typing import NDArray


def l2_normalize(vectors: NDArray[np.floating]) -> NDArray[np.float32]:
    """Return L2-normalized float32 vectors with safe zero-norm handling."""
    arr = np.asarray(vectors, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr[np.newaxis, :]
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms = np.where(norms > 1e-12, norms, 1.0)
    return (arr / norms).astype(np.float32)


class VectorIndex(ABC):
    """Abstract interface for vector similarity search over L2-normalized embeddings."""

    @property
    @abstractmethod
    def size(self) -> int:
        """Number of indexed vectors."""

    @property
    @abstractmethod
    def dim(self) -> int | None:
        """Vector dimensionality, or None if empty."""

    @abstractmethod
    def add(self, ids: list[int], vectors: NDArray[np.floating]) -> None:
        """Add or append L2-normalized vectors mapped to integer image ids."""

    @abstractmethod
    def search(
        self,
        query: NDArray[np.floating],
        k: int = 24,
        allowed_ids: set[int] | None = None,
    ) -> list[tuple[int, float]]:
        """Return top-k (image_id, cosine_similarity) pairs sorted descending."""

    @abstractmethod
    def save(self, directory: Path) -> None:
        """Persist index state to directory."""

    @classmethod
    @abstractmethod
    def load(cls, directory: Path) -> VectorIndex:
        """Load index state from directory."""


class NumpyVectorIndex(VectorIndex):
    """Brute-force cosine similarity index backed by a contiguous float32 NumPy matrix."""

    def __init__(
        self,
        vectors: NDArray[np.float32] | None = None,
        ids: list[int] | None = None,
    ) -> None:
        if vectors is not None and len(vectors) > 0:
            self._vectors: NDArray[np.float32] | None = l2_normalize(vectors)
            self._ids: list[int] = [int(i) for i in (ids or [])]
            if len(self._ids) != len(self._vectors):
                raise ValueError("Length of ids must match number of vectors.")
        else:
            self._vectors = None
            self._ids = []

    @property
    def size(self) -> int:
        return len(self._ids)

    @property
    def dim(self) -> int | None:
        return None if self._vectors is None else int(self._vectors.shape[1])

    @property
    def vectors(self) -> NDArray[np.float32] | None:
        """Expose underlying normalized matrix (read-only view recommended)."""
        return self._vectors

    @property
    def ids(self) -> list[int]:
        """Expose ordered list of image ids aligned with matrix rows."""
        return list(self._ids)

    def get_vector(self, image_id: int) -> NDArray[np.float32] | None:
        """Look up stored embedding for a given image_id."""
        if self._vectors is None:
            return None
        try:
            pos = self._ids.index(int(image_id))
        except ValueError:
            return None
        return self._vectors[pos]

    def add(self, ids: list[int], vectors: NDArray[np.floating]) -> None:
        if not ids:
            return
        normed = l2_normalize(vectors)
        if len(ids) != len(normed):
            raise ValueError("Length of ids must match number of vectors.")
        if self._vectors is None:
            self._vectors = normed
        else:
            if normed.shape[1] != self._vectors.shape[1]:
                raise ValueError(
                    f"Dimension mismatch: expected {self._vectors.shape[1]}, got {normed.shape[1]}"
                )
            self._vectors = np.vstack([self._vectors, normed]).astype(np.float32)
        self._ids.extend(int(i) for i in ids)

    def search(
        self,
        query: NDArray[np.floating],
        k: int = 24,
        allowed_ids: set[int] | None = None,
    ) -> list[tuple[int, float]]:
        if self._vectors is None or self.size == 0 or k <= 0:
            return []
        q = l2_normalize(query)[0]
        if q.shape[0] != self._vectors.shape[1]:
            raise ValueError(
                f"Query dim {q.shape[0]} != index dim {self._vectors.shape[1]}"
            )
        scores = self._vectors @ q

        if allowed_ids is not None:
            mask = np.fromiter(
                (img_id in allowed_ids for img_id in self._ids),
                dtype=bool,
                count=len(self._ids),
            )
            valid_indices = np.flatnonzero(mask)
            if len(valid_indices) == 0:
                return []
            sub_scores = scores[valid_indices]
            top_n = min(k, len(valid_indices))
            order = np.argsort(-sub_scores, kind="stable")[:top_n]
            chosen = valid_indices[order]
            return [(self._ids[int(idx)], float(scores[int(idx)])) for idx in chosen]

        top_n = min(k, len(self._ids))
        order = np.argsort(-scores, kind="stable")[:top_n]
        return [(self._ids[int(idx)], float(scores[int(idx)])) for idx in order]

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        vec_path = directory / "embeddings.npy"
        ids_path = directory / "ids.json"
        if self._vectors is None:
            np.save(vec_path, np.empty((0, 0), dtype=np.float32))
        else:
            np.save(vec_path, self._vectors)
        ids_path.write_text(json.dumps(self._ids), encoding="utf-8")

    @classmethod
    def load(cls, directory: Path) -> NumpyVectorIndex:
        vec_path = directory / "embeddings.npy"
        ids_path = directory / "ids.json"
        if not vec_path.is_file() or not ids_path.is_file():
            return cls()
        vectors = np.load(vec_path)
        ids = json.loads(ids_path.read_text(encoding="utf-8"))
        if vectors.size == 0 or len(ids) == 0:
            return cls()
        return cls(vectors=vectors, ids=ids)


class FaissVectorIndex(VectorIndex):
    """Optional FAISS IndexFlatIP cosine index on L2-normalized float32 vectors."""

    def __init__(self, dim: int | None = None) -> None:
        import faiss  # noqa: F401

        self._dim: int | None = dim
        self._index = faiss.IndexFlatIP(dim) if dim is not None else None
        self._ids: list[int] = []

    @property
    def size(self) -> int:
        return len(self._ids)

    @property
    def dim(self) -> int | None:
        return self._dim

    def add(self, ids: list[int], vectors: NDArray[np.floating]) -> None:
        import faiss

        if not ids:
            return
        normed = np.ascontiguousarray(l2_normalize(vectors), dtype=np.float32)
        if len(ids) != len(normed):
            raise ValueError("Length of ids must match number of vectors.")
        if self._index is None:
            self._dim = int(normed.shape[1])
            self._index = faiss.IndexFlatIP(self._dim)
        elif normed.shape[1] != self._dim:
            raise ValueError(f"Dimension mismatch: expected {self._dim}, got {normed.shape[1]}")
        self._index.add(normed)
        self._ids.extend(int(i) for i in ids)

    def search(
        self,
        query: NDArray[np.floating],
        k: int = 24,
        allowed_ids: set[int] | None = None,
    ) -> list[tuple[int, float]]:
        if self._index is None or self.size == 0 or k <= 0:
            return []
        q = np.ascontiguousarray(l2_normalize(query), dtype=np.float32)
        if q.shape[1] != self._dim:
            raise ValueError(f"Query dim {q.shape[1]} != index dim {self._dim}")
        fetch_k = self.size if allowed_ids is not None else min(k, self.size)
        scores, indices = self._index.search(q, fetch_k)
        results: list[tuple[int, float]] = []
        for idx, score in zip(indices[0], scores[0]):
            if idx < 0:
                continue
            img_id = self._ids[int(idx)]
            if allowed_ids is not None and img_id not in allowed_ids:
                continue
            results.append((img_id, float(score)))
            if len(results) >= k:
                break
        return results

    def save(self, directory: Path) -> None:
        import faiss

        directory.mkdir(parents=True, exist_ok=True)
        ids_path = directory / "faiss_ids.json"
        idx_path = directory / "index.faiss"
        ids_path.write_text(json.dumps(self._ids), encoding="utf-8")
        if self._index is not None:
            faiss.write_index(self._index, str(idx_path))

    @classmethod
    def load(cls, directory: Path) -> FaissVectorIndex:
        import faiss

        ids_path = directory / "faiss_ids.json"
        idx_path = directory / "index.faiss"
        if not ids_path.is_file():
            return cls()
        ids = json.loads(ids_path.read_text(encoding="utf-8"))
        inst = cls()
        inst._ids = [int(i) for i in ids]
        if idx_path.is_file():
            inst._index = faiss.read_index(str(idx_path))
            inst._dim = int(inst._index.d)
        return inst
