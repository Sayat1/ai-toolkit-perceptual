// Shared types + filesystem helpers for timestep curve libraries. Two
// libraries share this implementation:
//
//   - "weighting" curves   (loss is multiplied by curve(t) per-step)
//   - "distribution" curves (timesteps are *sampled* with probability ∝
//                            curve(t); no loss change)
//
// They have identical schema and identical disk shape — one JSON file per
// curve, one library per disk directory. Callers pass in the root getter.

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getTimestepCurvesRoot, getTimestepDistributionsRoot } from '@/server/settings';

export interface CurvePoint {
  /** Step progress in [0, 1]. x=0 is the noisy end of the schedule
   *  (step index 0 = t=1000); x=1 is the clean end (step index N-1). */
  x: number;
  /** y axis. For weighting curves: per-step loss weight (≈1 = neutral).
   *  For distribution curves: relative sampling density (unnormalized;
   *  ratios are what matter). */
  y: number;
}

export interface Curve {
  name: string;
  description?: string;
  points: CurvePoint[];
  /** Weighting curves: mean-normalize the resolved 1000-step weight vector
   *  to 1.0 so the global loss scale is unchanged. Distribution curves
   *  ignore this — densities are always renormalized to a PMF on use. */
  normalize?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type CurveKind = 'weighting' | 'distribution';

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function sanitizeCurveName(raw: string): string | null {
  const base = path.basename(raw);
  if (base !== raw) return null;
  if (!NAME_RE.test(base)) return null;
  return base;
}

function curvePath(root: string, name: string): string {
  return path.join(root, `${name}.json`);
}

export function validateCurve(input: any): { ok: true; curve: Curve } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Body must be an object' };
  const name = sanitizeCurveName(input.name);
  if (!name) return { ok: false, error: 'Invalid name (use 1-64 chars: A-Z a-z 0-9 . _ -)' };
  if (!Array.isArray(input.points) || input.points.length < 2) {
    return { ok: false, error: 'A curve needs at least two points' };
  }
  const points: CurvePoint[] = [];
  for (const raw of input.points) {
    if (typeof raw?.x !== 'number' || typeof raw?.y !== 'number') {
      return { ok: false, error: 'Each point must have numeric x and y' };
    }
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
      return { ok: false, error: 'Points must be finite' };
    }
    if (raw.x < 0 || raw.x > 1) return { ok: false, error: 'x must be in [0, 1]' };
    if (raw.y < 0) return { ok: false, error: 'y must be >= 0' };
    points.push({ x: raw.x, y: raw.y });
  }
  points.sort((a, b) => a.x - b.x);
  // Dedupe near-equal x values. Anchors that ended up on top of each other
  // (e.g. from an old UI bug that double-added on click) confuse PCHIP and
  // serve no purpose. Keep the first instance and drop the rest.
  const TOL = 1e-3;
  const deduped: CurvePoint[] = [];
  for (const p of points) {
    if (deduped.length === 0 || Math.abs(deduped[deduped.length - 1].x - p.x) > TOL) {
      deduped.push(p);
    }
  }
  if (deduped.length < 2) {
    return { ok: false, error: 'A curve needs at least two distinct x positions' };
  }
  return {
    ok: true,
    curve: {
      name,
      description: typeof input.description === 'string' ? input.description : undefined,
      points: deduped,
      // Default to false so y=1 means literally "1× = neutral" and a peak at
      // y=2 means "2× boost on those samples", which matches what users
      // intuit when they draw the curve. Opt-in mean-normalization is the
      // built-in `weighted` type's convention and still available via the
      // editor's toggle.
      normalize: input.normalize === true,
    },
  };
}

async function rootFor(kind: CurveKind): Promise<string> {
  return kind === 'weighting' ? await getTimestepCurvesRoot() : await getTimestepDistributionsRoot();
}

export async function listCurves(kind: CurveKind): Promise<Curve[]> {
  const root = await rootFor(kind);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root);
  const out: Curve[] = [];
  for (const f of entries) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await readFile(path.join(root, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.name && Array.isArray(parsed.points)) out.push(parsed as Curve);
    } catch {
      // skip unreadable / malformed entries silently — the page can still
      // function if one file is bad.
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function loadCurve(kind: CurveKind, name: string): Promise<Curve | null> {
  const safe = sanitizeCurveName(name);
  if (!safe) return null;
  const root = await rootFor(kind);
  try {
    const raw = await readFile(curvePath(root, safe), 'utf8');
    return JSON.parse(raw) as Curve;
  } catch {
    return null;
  }
}

export async function saveCurve(kind: CurveKind, curve: Curve): Promise<Curve> {
  const root = await rootFor(kind);
  await mkdir(root, { recursive: true });
  const target = curvePath(root, curve.name);
  const now = new Date().toISOString();
  let createdAt = curve.createdAt;
  if (!createdAt) {
    try {
      const existing = JSON.parse(await readFile(target, 'utf8')) as Curve;
      createdAt = existing.createdAt ?? now;
    } catch {
      createdAt = now;
    }
  }
  const out: Curve = { ...curve, createdAt, updatedAt: now };
  await writeFile(target, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

export async function deleteCurve(kind: CurveKind, name: string): Promise<boolean> {
  const safe = sanitizeCurveName(name);
  if (!safe) return false;
  const root = await rootFor(kind);
  try {
    await unlink(curvePath(root, safe));
    return true;
  } catch {
    return false;
  }
}
