"""Resolve UI-saved timestep weighing curves to a 1D weight tensor.

The UI saves curves as `{points: [{x, y}, ...], normalize: bool}` JSON where
`x` is step progress in [0, 1] (x=0 is the noisy / high-t end of the schedule,
x=1 is the clean / low-t end) and `y` is the per-step weight (conventionally
centered on 1.0).

At training time we evaluate the curve with PCHIP (monotonic cubic Hermite)
at `num_steps` uniformly-spaced points and optionally mean-normalize so the
overall loss scale matches the built-in `weighted` type. Matches the
interpolation the UI uses for its live preview so what the user sees is what
the trainer applies.
"""
from __future__ import annotations

import json
import os
from typing import Any, Mapping, Optional

import numpy as np
import torch
from scipy.interpolate import PchipInterpolator


# Resolve the toolkit root from this file's location: <root>/toolkit/timestep_weighing/custom_curve.py
_TOOLKIT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def resolve_live_curve(curve: Optional[Mapping[str, Any]], kind: str) -> Optional[Mapping[str, Any]]:
    """If `curve` was inlined from the UI's saved library, re-read the
    library file from disk and return its current contents — otherwise the
    in-memory dict is the source of truth.

    The job config stores a *snapshot* of the curve at job-create time.
    That snapshot is sometimes stale (the user recreates a job and the
    picker pre-fills with the old inlined curve, or the user edits the
    curve in another tab after queueing the job). Reading by `sourceName`
    at run-start gives the user "edit the curve, re-queue the job, get the
    edit" semantics, which matches their mental model.

    `kind` is 'weighting' or 'distribution', selecting the disk directory.
    Returns the inlined dict unchanged if there is no sourceName or the
    disk file is missing / unreadable.
    """
    if not isinstance(curve, Mapping):
        return curve
    src = curve.get('sourceName')
    if not isinstance(src, str) or not src:
        return curve
    sub = 'timestep_curves' if kind == 'weighting' else 'timestep_distributions'
    path = os.path.join(_TOOLKIT_ROOT, sub, f'{src}.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            disk = json.load(f)
        if isinstance(disk, dict) and isinstance(disk.get('points'), list):
            # Carry the sourceName forward so downstream code can still
            # report it (and so a future re-resolve still triggers).
            return {**disk, 'sourceName': src}
    except (OSError, json.JSONDecodeError):
        pass
    return curve


def _build_interpolator(curve: Optional[Mapping[str, Any]]):
    """Return a PchipInterpolator for `curve`, or None if the curve is empty
    or has fewer than two distinct x values."""
    if not curve or 'points' not in curve:
        return None
    pts = sorted(curve['points'], key=lambda p: float(p['x']))
    seen_x: set[float] = set()
    xs_list, ys_list = [], []
    for p in pts:
        x = float(p['x'])
        if x in seen_x:
            continue
        seen_x.add(x)
        xs_list.append(x)
        ys_list.append(max(0.0, float(p['y'])))
    if len(xs_list) < 2:
        return None
    xs = np.asarray(xs_list, dtype=np.float64)
    ys = np.asarray(ys_list, dtype=np.float64)
    return PchipInterpolator(xs, ys, extrapolate=True)


def evaluate_curve_at_xs(
    curve: Optional[Mapping[str, Any]],
    xs: Any,
) -> torch.Tensor:
    """Evaluate the curve at arbitrary x positions (one per timestep slot in
    a non-uniform schedule, typically). Negatives are clipped to 0.

    Accepts a torch tensor, numpy array, or python list. Returns a float32
    tensor on the caller's device of the same shape as `xs`.

    Use this — not `resolve_curve_weights` — when you need per-index sampling
    weights for a schedule that isn't uniform (e.g. sigmoid). `resolve_*`
    evaluates at uniform x and is only correct when the schedule IS uniform.
    """
    if isinstance(xs, torch.Tensor):
        device = xs.device
        xs_np = xs.detach().cpu().numpy().astype(np.float64)
    else:
        device = None
        xs_np = np.asarray(xs, dtype=np.float64)
    interp = _build_interpolator(curve)
    if interp is None:
        out = torch.ones(xs_np.shape, dtype=torch.float32)
    else:
        w = np.asarray(interp(xs_np), dtype=np.float64)
        w = np.clip(w, 0.0, None)
        out = torch.from_numpy(w.astype(np.float32))
    return out.to(device) if device is not None else out


def resolve_curve_weights(
    curve: Optional[Mapping[str, Any]],
    num_steps: int = 1000,
) -> torch.Tensor:
    """Return a `(num_steps,)` float32 tensor of weights for the given curve.

    Returns `ones(num_steps)` for an empty / malformed curve so callers can
    use the result unconditionally without a fallback branch.
    """
    if not curve or 'points' not in curve:
        return torch.ones(num_steps, dtype=torch.float32)
    pts = sorted(curve['points'], key=lambda p: float(p['x']))
    # Deduplicate by x — PchipInterpolator rejects repeated x values. Keeping
    # the *first* y for each unique x is arbitrary but rare in practice.
    seen_x: set[float] = set()
    xs_list, ys_list = [], []
    for p in pts:
        x = float(p['x'])
        if x in seen_x:
            continue
        seen_x.add(x)
        xs_list.append(x)
        ys_list.append(max(0.0, float(p['y'])))
    if len(xs_list) < 2:
        return torch.ones(num_steps, dtype=torch.float32)
    xs = np.asarray(xs_list, dtype=np.float64)
    ys = np.asarray(ys_list, dtype=np.float64)
    interp = PchipInterpolator(xs, ys, extrapolate=True)
    sample_xs = np.linspace(0.0, 1.0, num_steps, dtype=np.float64)
    w = np.asarray(interp(sample_xs), dtype=np.float64)
    w = np.clip(w, 0.0, None)
    if curve.get('normalize', False):
        s = w.sum()
        if s > 0:
            w = w * (num_steps / s)
    return torch.from_numpy(w.astype(np.float32))


def sample_timesteps_from_curve(
    curve: Optional[Mapping[str, Any]],
    num_samples: int,
    num_steps: int = 1000,
    device: Optional[torch.device] = None,
    generator: Optional[torch.Generator] = None,
) -> torch.Tensor:
    """Sample `num_samples` timesteps according to a curve treated as a PDF.

    Counterpart to `resolve_curve_weights`. Where that returns per-step *loss
    weights* (uniform sampling, weighted loss), this samples timesteps so
    that each appears with frequency proportional to `curve(t)`. The result
    is sorted descending to match the convention of `set_train_timesteps`
    (high t first → low t last) for any caller that scans the schedule
    in order.

    Returns a 1D float32 tensor of timestep values in [1, 1000].
    """
    # Reuse the same evaluation path as the weighting curve so the UI
    # preview matches; we ignore the curve's `normalize` flag here because
    # PDF normalization is always re-applied below.
    raw = resolve_curve_weights({**dict(curve or {}), 'normalize': False}, num_steps)
    weights_np = raw.cpu().numpy().astype(np.float64)
    total = weights_np.sum()
    if not np.isfinite(total) or total <= 0:
        # Degenerate curve (all zero): fall back to uniform.
        timesteps = np.linspace(1000.0, 1.0, num_samples, dtype=np.float32)
        out = torch.from_numpy(timesteps)
        return out.to(device) if device is not None else out
    pmf = weights_np / total
    # Build the CDF and use inverse-CDF (searchsorted) sampling. Doing the
    # draw with torch lets the caller pass an RNG for reproducibility.
    cdf = np.cumsum(pmf)
    cdf[-1] = 1.0  # guard against floating-point drift past 1.0
    if generator is None:
        u = torch.rand(num_samples)
    else:
        u = torch.rand(num_samples, generator=generator)
    u_np = u.cpu().numpy()
    bin_indices = np.searchsorted(cdf, u_np, side='right').clip(0, num_steps - 1)
    # Map bin index 0..N-1 onto timestep value [1000, 1] linearly. Index 0
    # (curve x=0 / noisy end) → t=1000; index N-1 (x=1 / clean) → t=1.
    timestep_grid = np.linspace(1000.0, 1.0, num_steps, dtype=np.float32)
    sampled = timestep_grid[bin_indices]
    sampled.sort()
    sampled = sampled[::-1].copy()  # descending, to match sigmoid path
    out = torch.from_numpy(sampled)
    return out.to(device) if device is not None else out
