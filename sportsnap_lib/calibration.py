"""Temperature scaling calibration and uncertainty threshold selection."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from sportsnap_lib.ingest import apply_temperature_scaling


@dataclass(frozen=True)
class CalibrationReport:
    temperature: float
    nll_before: float
    nll_after: float
    ece_before: float
    ece_after: float
    tau_high: float
    tau_low: float


def compute_nll(probs: NDArray[np.floating], y_true: NDArray[np.integer]) -> float:
    """Compute mean negative log-likelihood over true class indices."""
    if len(y_true) == 0:
        return 0.0
    p = np.clip(np.asarray(probs, dtype=np.float64), 1e-12, 1.0)
    idx = np.arange(len(y_true))
    return float(-np.mean(np.log(p[idx, y_true])))


def compute_ece(
    probs: NDArray[np.floating],
    y_true: NDArray[np.integer],
    n_bins: int = 15,
) -> float:
    """Compute Expected Calibration Error across uniform confidence bins."""
    if len(y_true) == 0:
        return 0.0
    p = np.asarray(probs, dtype=np.float64)
    confs = np.max(p, axis=1)
    preds = np.argmax(p, axis=1)
    accs = (preds == y_true).astype(np.float64)
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    total = len(y_true)
    for b_idx in range(n_bins):
        lo, hi = bins[b_idx], bins[b_idx + 1]
        mask = (confs >= lo) & (confs <= hi if b_idx == n_bins - 1 else confs < hi)
        count = int(np.sum(mask))
        if count == 0:
            continue
        ece += (count / total) * abs(float(np.mean(accs[mask])) - float(np.mean(confs[mask])))
    return float(ece)


def suggest_thresholds(
    probs: NDArray[np.floating],
    y_true: NDArray[np.integer],
) -> tuple[float, float]:
    """Select tau_high (auto) and tau_low (review) from calibrated confidence distribution."""
    if len(y_true) == 0:
        return 0.60, 0.35
    p = np.asarray(probs, dtype=np.float64)
    confs = np.max(p, axis=1)
    preds = np.argmax(p, axis=1)
    correct = preds == y_true

    tau_high = 0.60
    for candidate in np.linspace(0.55, 0.90, 8):
        mask = confs >= candidate
        if int(np.sum(mask)) >= 5 and float(np.mean(correct[mask])) >= 0.90:
            tau_high = float(round(candidate, 2))
            break
    tau_low = float(round(min(0.40, tau_high - 0.15), 2))
    return tau_high, max(0.20, tau_low)


def fit_temperature(
    probs: NDArray[np.floating],
    y_true: NDArray[np.integer],
) -> CalibrationReport:
    """Fit scalar temperature T minimizing validation NLL via coarse-to-fine search."""
    raw = np.asarray(probs, dtype=np.float64)
    y = np.asarray(y_true, dtype=np.int64)
    nll_before = compute_nll(raw, y)
    ece_before = compute_ece(raw, y)

    if len(y) == 0:
        return CalibrationReport(1.0, 0.0, 0.0, 0.0, 0.0, 0.60, 0.35)

    best_t = 1.0
    best_nll = nll_before
    for t in np.linspace(0.3, 4.0, 75):
        scaled = apply_temperature_scaling(raw, float(t))
        nll = compute_nll(scaled, y)
        if nll < best_nll:
            best_nll = nll
            best_t = float(t)

    # Fine pass around best_t
    for t in np.linspace(max(0.2, best_t - 0.15), min(5.0, best_t + 0.15), 31):
        scaled = apply_temperature_scaling(raw, float(t))
        nll = compute_nll(scaled, y)
        if nll < best_nll:
            best_nll = nll
            best_t = float(t)

    cal = apply_temperature_scaling(raw, best_t)
    ece_after = compute_ece(cal, y)
    tau_high, tau_low = suggest_thresholds(cal, y)
    return CalibrationReport(
        temperature=round(best_t, 4),
        nll_before=round(nll_before, 4),
        nll_after=round(best_nll, 4),
        ece_before=round(ece_before, 4),
        ece_after=round(ece_after, 4),
        tau_high=tau_high,
        tau_low=tau_low,
    )
