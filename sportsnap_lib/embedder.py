"""CLIP image/text embedding interface and CPU implementations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Sequence

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from sportsnap_lib.vector_index import l2_normalize


class Embedder(ABC):
    """Abstract interface for multimodal image/text embeddings."""

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Identifier of the underlying embedding model."""

    @property
    @abstractmethod
    def dim(self) -> int:
        """Embedding vector dimensionality."""

    @abstractmethod
    def embed_images(
        self, images: Sequence[Path | str | Image.Image]
    ) -> NDArray[np.float32]:
        """Return L2-normalized float32 embeddings of shape (N, dim)."""

    @abstractmethod
    def embed_texts(self, texts: Sequence[str]) -> NDArray[np.float32]:
        """Return L2-normalized float32 embeddings of shape (M, dim)."""


class FastEmbedClipEmbedder(Embedder):
    """CPU-friendly CLIP ViT-B/32 embedder powered by fastembed (ONNX Runtime)."""

    def __init__(
        self,
        vision_model: str = "Qdrant/clip-ViT-B-32-vision",
        text_model: str = "Qdrant/clip-ViT-B-32-text",
        cache_dir: str | None = None,
    ) -> None:
        self._vision_name = vision_model
        self._text_name = text_model
        self._cache_dir = cache_dir
        self._vision_model = None
        self._text_model = None
        self._dim = 512

    @property
    def model_name(self) -> str:
        return "Qdrant/clip-ViT-B-32"

    @property
    def dim(self) -> int:
        return self._dim

    def _ensure_vision(self):
        if self._vision_model is None:
            from fastembed import ImageEmbedding

            kwargs = {"model_name": self._vision_name}
            if self._cache_dir is not None:
                kwargs["cache_dir"] = self._cache_dir
            self._vision_model = ImageEmbedding(**kwargs)
        return self._vision_model

    def _ensure_text(self):
        if self._text_model is None:
            from fastembed import TextEmbedding

            kwargs = {"model_name": self._text_name}
            if self._cache_dir is not None:
                kwargs["cache_dir"] = self._cache_dir
            self._text_model = TextEmbedding(**kwargs)
        return self._text_model

    def embed_images(
        self, images: Sequence[Path | str | Image.Image]
    ) -> NDArray[np.float32]:
        if not images:
            return np.empty((0, self._dim), dtype=np.float32)
        model = self._ensure_vision()
        inputs = [str(item) if isinstance(item, Path) else item for item in images]
        vecs = np.asarray(list(model.embed(inputs)), dtype=np.float32)
        self._dim = int(vecs.shape[1])
        return l2_normalize(vecs)

    def embed_texts(self, texts: Sequence[str]) -> NDArray[np.float32]:
        if not texts:
            return np.empty((0, self._dim), dtype=np.float32)
        model = self._ensure_text()
        vecs = np.asarray(list(model.embed(list(texts))), dtype=np.float32)
        self._dim = int(vecs.shape[1])
        return l2_normalize(vecs)
