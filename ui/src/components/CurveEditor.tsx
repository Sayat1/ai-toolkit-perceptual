'use client';

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface CurvePoint {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// PCHIP (Fritsch–Carlson monotonic cubic Hermite) interpolation. Anchors stay
// exactly where the user dragged them and the curve never overshoots between
// neighboring anchors — important when one anchor is at 0 and an adjacent one
// is positive (we don't want the weight curve dipping below zero).
// ---------------------------------------------------------------------------
function pchipDerivatives(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  if (n < 2) return [0];
  if (n === 2) {
    const s = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    return [s, s];
  }
  const h: number[] = [];
  const m: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(xs[k + 1] - xs[k]);
    m.push((ys[k + 1] - ys[k]) / h[k]);
  }
  const d: number[] = new Array(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    if (Math.sign(m[k - 1]) !== Math.sign(m[k]) || m[k - 1] === 0 || m[k] === 0) {
      d[k] = 0;
    } else {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      d[k] = (w1 + w2) / (w1 / m[k - 1] + w2 / m[k]);
    }
  }
  // Endpoints: 3-point one-sided estimate, clamped to keep monotonicity.
  d[0] = ((2 * h[0] + h[1]) * m[0] - h[0] * m[1]) / (h[0] + h[1]);
  if (Math.sign(d[0]) !== Math.sign(m[0])) d[0] = 0;
  else if (Math.sign(m[0]) !== Math.sign(m[1]) && Math.abs(d[0]) > 3 * Math.abs(m[0])) d[0] = 3 * m[0];
  d[n - 1] = ((2 * h[n - 2] + h[n - 3]) * m[n - 2] - h[n - 2] * m[n - 3]) / (h[n - 2] + h[n - 3]);
  if (Math.sign(d[n - 1]) !== Math.sign(m[n - 2])) d[n - 1] = 0;
  else if (Math.sign(m[n - 2]) !== Math.sign(m[n - 3]) && Math.abs(d[n - 1]) > 3 * Math.abs(m[n - 2])) d[n - 1] = 3 * m[n - 2];
  return d;
}

export function pchipEvaluate(xs: number[], ys: number[], d: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[xs.length - 1];
  let k = 0;
  while (k < xs.length - 2 && x > xs[k + 1]) k++;
  const h = xs[k + 1] - xs[k];
  const t = (x - xs[k]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * ys[k] + h10 * h * d[k] + h01 * ys[k + 1] + h11 * h * d[k + 1];
}

/** Resolves a curve to `samples` weight values uniformly spaced along x in
 *  [0, 1]. Used both by the live editor preview and by the read-only thumbnail.
 *
 *  Anchors at identical-or-near-identical x are deduped first — PCHIP
 *  computes secant slopes via division by (x_{k+1} - x_k), which blows up to
 *  NaN/Infinity at a zero gap and silently collapses every derivative to 0,
 *  turning the curve into a piecewise-linear triangle. The trainer's
 *  Python-side curve loader does the same dedupe, so both stay in sync. */
export function evaluateCurve(points: CurvePoint[], samples: number): number[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of sorted) {
    if (xs.length === 0 || Math.abs(xs[xs.length - 1] - p.x) > 1e-6) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length < 2) {
    const v = ys[0] ?? 1;
    return new Array(samples).fill(Math.max(0, v));
  }
  const d = pchipDerivatives(xs, ys);
  const out: number[] = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    out[i] = Math.max(0, pchipEvaluate(xs, ys, d, x));
  }
  return out;
}

// ---------------------------------------------------------------------------

interface Props {
  points: CurvePoint[];
  onChange?: (points: CurvePoint[]) => void;
  width?: number;
  height?: number;
  /** Display max for the y-axis. Anchors are clamped here on drag. */
  yMax?: number;
  readOnly?: boolean;
  /** Show grid + axis labels. Off by default for thumbnails. */
  showAxes?: boolean;
}

const PAD = { l: 8, r: 4, t: 4, b: 8 };
const VIEW = { w: 100, h: 50 };

export default function CurveEditor({
  points,
  onChange,
  width = 640,
  height = 320,
  yMax = 3,
  readOnly = false,
  showAxes = true,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const plotW = VIEW.w - PAD.l - PAD.r;
  const plotH = VIEW.h - PAD.t - PAD.b;

  const toSvg = (p: CurvePoint) => ({
    sx: PAD.l + p.x * plotW,
    sy: PAD.t + plotH - Math.max(0, Math.min(p.y, yMax)) / yMax * plotH,
  });

  // PCHIP-sampled path. 240 samples is plenty for a 100-unit-wide viewbox.
  const samples = useMemo(() => evaluateCurve(points, 240), [points]);
  const pathD = useMemo(() => {
    let s = '';
    for (let i = 0; i < samples.length; i++) {
      const x = i / (samples.length - 1);
      const { sx, sy } = toSvg({ x, y: samples[i] });
      s += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(3)} ${sy.toFixed(3)} `;
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, plotW, plotH, yMax]);

  const eventToData = (e: { clientX: number; clientY: number }): CurvePoint | null => {
    if (!svgRef.current) return null;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return null;
    const svgPt = pt.matrixTransform(ctm.inverse());
    return {
      x: (svgPt.x - PAD.l) / plotW,
      y: yMax * (1 - (svgPt.y - PAD.t) / plotH),
    };
  };

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const clampY = (v: number) => Math.max(0, Math.min(yMax, v));

  const handlePointerDownOnAnchor = (e: ReactPointerEvent<SVGCircleElement>, idx: number) => {
    if (readOnly) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraggingIdx(idx);
  };

  const handleClickOnAnchor = (e: { stopPropagation: () => void }) => {
    // The SVG's onClick handler adds a new anchor at the click position.
    // Without stopping here, clicking an existing anchor would *also* add a
    // duplicate at the same x (which we saw on disk as a doubled point).
    e.stopPropagation();
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || draggingIdx == null) return;
    const data = eventToData(e);
    if (!data) return;
    const next = [...points];
    // Clamp x within the neighboring anchors so the array stays sorted by x.
    // First and last points are pinned at x=0 / x=1 to keep the curve domain
    // fixed.
    const lo = draggingIdx === 0 ? 0 : next[draggingIdx - 1].x + 1e-4;
    const hi = draggingIdx === next.length - 1 ? 1 : next[draggingIdx + 1].x - 1e-4;
    const fixedEdgeX = (draggingIdx === 0 || draggingIdx === next.length - 1) ? next[draggingIdx].x : Math.max(lo, Math.min(hi, data.x));
    next[draggingIdx] = { x: clamp01(fixedEdgeX), y: clampY(data.y) };
    onChange?.(next);
  };

  const handlePointerUp = () => {
    if (draggingIdx != null) setDraggingIdx(null);
  };

  const handleSvgClick = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    if (draggingIdx != null) return;
    // Only adds when clicking empty plot area — not when releasing a drag.
    const data = eventToData(e);
    if (!data) return;
    if (data.x <= 0 || data.x >= 1) return;
    const next = [...points, { x: clamp01(data.x), y: clampY(data.y) }].sort((a, b) => a.x - b.x);
    onChange?.(next);
  };

  const handleAnchorDoubleClick = (idx: number) => {
    if (readOnly) return;
    if (points.length <= 2) return; // keep at least the two endpoints
    if (idx === 0 || idx === points.length - 1) return; // don't delete endpoints
    const next = points.filter((_, i) => i !== idx);
    onChange?.(next);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      width={width}
      height={height}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleSvgClick}
      className="bg-gray-950 border border-gray-800 rounded-md touch-none select-none"
      style={{ cursor: readOnly ? 'default' : draggingIdx != null ? 'grabbing' : 'crosshair' }}
    >
      {/* Plot background */}
      <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} fill="#0c1320" />
      {/* Grid */}
      {showAxes && (
        <g stroke="#1f2937" strokeWidth={0.15}>
          {[0.25, 0.5, 0.75].map(v => (
            <line key={`vx-${v}`} x1={PAD.l + v * plotW} y1={PAD.t} x2={PAD.l + v * plotW} y2={PAD.t + plotH} />
          ))}
          {[1 / 3, 2 / 3].map(v => (
            <line key={`hy-${v}`} x1={PAD.l} y1={PAD.t + (1 - v) * plotH} x2={PAD.l + plotW} y2={PAD.t + (1 - v) * plotH} />
          ))}
        </g>
      )}
      {/* y=1 reference */}
      <line
        x1={PAD.l}
        y1={PAD.t + plotH - (1 / yMax) * plotH}
        x2={PAD.l + plotW}
        y2={PAD.t + plotH - (1 / yMax) * plotH}
        stroke="#3b82f6"
        strokeWidth={0.18}
        strokeDasharray="0.6 0.6"
      />
      {/* The curve */}
      <path d={pathD} fill="none" stroke="#60a5fa" strokeWidth={0.45} />
      {/* Anchors */}
      {!readOnly && points.map((p, i) => {
        const { sx, sy } = toSvg(p);
        const isEndpoint = i === 0 || i === points.length - 1;
        return (
          <g key={i}>
            <circle
              cx={sx}
              cy={sy}
              r={1.4}
              fill={isEndpoint ? '#a3a3a3' : '#fbbf24'}
              stroke="#0c1320"
              strokeWidth={0.35}
              onPointerDown={e => handlePointerDownOnAnchor(e, i)}
              onClick={handleClickOnAnchor}
              onDoubleClick={() => handleAnchorDoubleClick(i)}
              style={{ cursor: 'grab' }}
            />
          </g>
        );
      })}
      {/* Axis labels */}
      {showAxes && (
        <g fill="#9ca3af" fontSize={2.4} fontFamily="ui-sans-serif">
          <text x={PAD.l} y={VIEW.h - 0.5} textAnchor="start">noisy (t=1)</text>
          <text x={PAD.l + plotW} y={VIEW.h - 0.5} textAnchor="end">clean (t=0)</text>
          <text x={1} y={PAD.t + 2} textAnchor="start">{yMax.toFixed(1)}</text>
          <text x={1} y={PAD.t + plotH - (1 / yMax) * plotH + 0.8} textAnchor="start">1.0</text>
          <text x={1} y={PAD.t + plotH - 0.2} textAnchor="start">0</text>
        </g>
      )}
    </svg>
  );
}
