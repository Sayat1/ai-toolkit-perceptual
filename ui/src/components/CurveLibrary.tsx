'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@headlessui/react';
import { FaRegTrashAlt, FaPlus } from 'react-icons/fa';
import { LuLoader } from 'react-icons/lu';
import { TopBar, MainContent } from '@/components/layout';
import { openConfirm } from '@/components/ConfirmModal';
import { apiClient } from '@/utils/api';
import CurveEditor, { type CurvePoint, evaluateCurve } from '@/components/CurveEditor';

interface Curve {
  name: string;
  description?: string;
  points: CurvePoint[];
  normalize?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface Preset {
  name: string;
  description: string;
  points: CurvePoint[];
}

interface Config {
  kind: 'weighting' | 'distribution';
  pageTitle: string;
  pageBlurb: string;
  /** API base path, no trailing slash. */
  apiBase: string;
  /** When true, the editor exposes a "mean-normalize" toggle (only useful
   *  for weighting curves). Distributions are renormalized at use time so
   *  the toggle is hidden. */
  showNormalizeToggle: boolean;
  presets: Preset[];
  /** Stats line shown above the editor. */
  statsLabel: (stats: { mean: number; min: number; max: number }) => string;
}

const inputCls = 'w-full text-sm px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-gray-200 focus:ring-1 focus:ring-gray-500 focus:outline-none';
const labelCls = 'block text-xs text-gray-400 uppercase tracking-wide mb-1';
const buttonPrimary = 'inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-sm font-medium text-white transition-colors';
const buttonGhost = 'inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 transition-colors';

const DEFAULT_POINTS: CurvePoint[] = [
  { x: 0, y: 1 },
  { x: 0.5, y: 1 },
  { x: 1, y: 1 },
];

export default function CurveLibrary({ config }: { config: Config }) {
  const [curves, setCurves] = useState<Curve[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [editing, setEditing] = useState<Curve | null>(null);
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setStatus('loading');
    apiClient
      .get(config.apiBase)
      .then(res => {
        setCurves(res.data.curves ?? []);
        setStatus('success');
      })
      .catch(() => setStatus('error'));
  }, [config.apiBase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startNew = () => {
    setEditing({ name: '', description: '', points: [...DEFAULT_POINTS], normalize: false });
    setOriginalName(null);
    setError(null);
  };

  const startEdit = (curve: Curve) => {
    setEditing({ ...curve, points: curve.points.map(p => ({ ...p })) });
    setOriginalName(curve.name);
    setError(null);
  };

  const applyPreset = (preset: Preset) => {
    if (!editing) return;
    setEditing({ ...editing, points: preset.points.map(p => ({ ...p })), description: editing.description || preset.description });
  };

  const save = () => {
    if (!editing || saving) return;
    setError(null);
    if (!editing.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    apiClient
      .post(config.apiBase, editing)
      .then(() => {
        setEditing(null);
        setOriginalName(null);
        refresh();
      })
      .catch(err => setError(err?.response?.data?.error ?? err?.message ?? 'Save failed'))
      .finally(() => setSaving(false));
  };

  const deleteOne = (name: string) => {
    openConfirm({
      title: `Delete ${config.kind === 'distribution' ? 'distribution' : 'curve'}`,
      message: `Delete "${name}"? Any jobs referencing it carry an inlined copy and won't be affected.`,
      type: 'warning',
      confirmText: 'Delete',
      onConfirm: () => {
        apiClient.delete(`${config.apiBase}/${encodeURIComponent(name)}`).finally(refresh);
      },
    });
  };

  return (
    <>
      <TopBar>
        <div>
          <h1 className="text-lg">{config.pageTitle}</h1>
        </div>
        <div className="flex-1" />
        {!editing && (
          <Button className={buttonPrimary} onClick={startNew}>
            <FaPlus /> New
          </Button>
        )}
      </TopBar>
      <MainContent className="pt-20 px-6 pb-6 space-y-6">
        <p className="text-xs text-gray-500 max-w-3xl">{config.pageBlurb}</p>

        {editing && (
          <EditorPanel
            curve={editing}
            onChange={setEditing}
            onSave={save}
            onCancel={() => {
              setEditing(null);
              setOriginalName(null);
              setError(null);
            }}
            onPreset={applyPreset}
            saving={saving}
            error={error}
            isNew={originalName == null}
            isRename={originalName != null && originalName !== editing.name}
            kind={config.kind}
            showNormalizeToggle={config.showNormalizeToggle}
            presets={config.presets}
            statsLabel={config.statsLabel}
          />
        )}

        <div>
          <h2 className="text-sm font-medium text-gray-300 mb-3">
            Saved {status === 'success' && `(${curves.length})`}
          </h2>
          {status === 'loading' && curves.length === 0 && (
            <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
          )}
          {status === 'success' && curves.length === 0 && (
            <div className="text-sm text-gray-500 py-8 text-center border border-dashed border-gray-800 rounded-lg">
              Nothing saved yet. Click "New" above to start.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {curves.map(c => (
              <CurveCard key={c.name} curve={c} onEdit={() => startEdit(c)} onDelete={() => deleteOne(c.name)} />
            ))}
          </div>
        </div>
      </MainContent>
    </>
  );
}

function EditorPanel({
  curve, onChange, onSave, onCancel, onPreset, saving, error, isNew, isRename,
  kind, showNormalizeToggle, presets, statsLabel,
}: {
  curve: Curve;
  onChange: (c: Curve) => void;
  onSave: () => void;
  onCancel: () => void;
  onPreset: (p: Preset) => void;
  saving: boolean;
  error: string | null;
  isNew: boolean;
  isRename: boolean;
  kind: 'weighting' | 'distribution';
  showNormalizeToggle: boolean;
  presets: Preset[];
  statsLabel: (stats: { mean: number; min: number; max: number }) => string;
}) {
  const stats = useMemo(() => {
    const samples = evaluateCurve(curve.points, 100);
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    return { mean, min, max };
  }, [curve.points]);

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-200">
          {isNew ? 'New' : `Editing "${curve.name}"`}
        </h2>
        <div className="text-xs text-gray-500 tabular-nums">{statsLabel(stats)}</div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4">
        <div>
          <CurveEditor points={curve.points} onChange={pts => onChange({ ...curve, points: pts })} width={620} height={310} yMax={3} showAxes />
          <div className="mt-2 text-xs text-gray-500">
            {curve.points.length} anchor{curve.points.length === 1 ? '' : 's'} ·
            click empty space to add · double-click to remove · drag to move ·
            endpoints pinned at x=0 / x=1
          </div>
          <div className="mt-3">
            <BandPreview points={curve.points} kind={kind} />
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Name</label>
            <input
              type="text"
              value={curve.name}
              onChange={e => onChange({ ...curve, name: e.target.value })}
              placeholder="my_curve"
              className={inputCls}
              autoFocus={isNew}
            />
            {isRename && (
              <div className="text-xs text-yellow-500 mt-1">
                Renaming. The original file will not be deleted automatically.
              </div>
            )}
          </div>
          <div>
            <label className={labelCls}>Description (optional)</label>
            <textarea
              value={curve.description ?? ''}
              onChange={e => onChange({ ...curve, description: e.target.value })}
              rows={2}
              className={inputCls}
            />
          </div>
          {showNormalizeToggle && (
            <div>
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={curve.normalize !== false}
                  onChange={e => onChange({ ...curve, normalize: e.target.checked })}
                />
                Mean-normalize at load (keep overall loss scale unchanged)
              </label>
            </div>
          )}
          <div>
            <label className={labelCls}>Presets</label>
            <div className="flex flex-wrap gap-1">
              {presets.map(p => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => onPreset(p)}
                  title={p.description}
                  className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2 pt-2 border-t border-gray-800">
            <Button className={buttonPrimary} onClick={onSave} disabled={saving}>
              {saving ? <LuLoader className="animate-spin" /> : null}
              {saving ? 'Saving' : 'Save'}
            </Button>
            <Button className={buttonGhost} onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Per-t-band summary of how the curve resolves. The two kinds report
// different things because they actually *do* different things at training
// time:
//
//   - Distribution: the curve is treated as an unnormalized PDF — bars
//     show the predicted sampling % per t-band, which is exactly what
//     `core/timestep` should produce in a real run. Min-subtracted to
//     match the trainer (otherwise the baseline area would dominate and
//     y=3 vs y=1 wouldn't shift much).
//
//   - Weighting: the curve is a per-step loss multiplier — bars show the
//     mean weight applied to samples in that band. If a sample lands in
//     t30, its loss is multiplied by ~that bar's value. No min-
//     subtraction, no normalization: the absolute weight is what matters.
//
// The trainer's bin convention is t in [N*0.1, (N+1)*0.1) → bin tNN. The
// editor maps x=0 to noisy/high-t, so leftmost bar — t90 — visually aligns
// with x=0 on the curve above.
function BandPreview({ points, kind }: { points: CurvePoint[]; kind: 'weighting' | 'distribution' }) {
  const bands = useMemo(() => {
    const N = 1000;
    const samples = evaluateCurve(points, N);

    if (kind === 'distribution') {
      let minS = Infinity;
      for (const v of samples) if (v < minS) minS = v;
      if (!Number.isFinite(minS)) minS = 0;
      const adjusted = samples.map(v => Math.max(0, v - minS));
      const sums: number[] = new Array(10).fill(0);
      for (let i = 0; i < N; i++) {
        const t = 1 - i / (N - 1);
        const b = Math.min(9, Math.floor(t * 10));
        sums[b] += adjusted[i];
      }
      const total = sums.reduce((s, v) => s + v, 0);
      if (total <= 0) {
        // Degenerate (flat) curve → trainer falls back to uniform sampling;
        // mirror that here so the bars render evenly.
        return sums.map((_, i) => ({ idx: i, val: 0.1, isPct: true as const }));
      }
      return sums.map((s, i) => ({ idx: i, val: s / total, isPct: true as const }));
    }

    // Weighting: mean per-sample weight per band (the actual multiplier).
    const sums: number[] = new Array(10).fill(0);
    const counts: number[] = new Array(10).fill(0);
    for (let i = 0; i < N; i++) {
      const t = 1 - i / (N - 1);
      const b = Math.min(9, Math.floor(t * 10));
      sums[b] += samples[i];
      counts[b] += 1;
    }
    return sums.map((s, i) => ({ idx: i, val: counts[i] > 0 ? s / counts[i] : 0, isPct: false as const }));
  }, [points, kind]);

  const ordered = useMemo(() => [...bands].reverse(), [bands]);
  const maxVal = useMemo(() => Math.max(...ordered.map(b => b.val), 1e-6), [ordered]);

  const title = kind === 'distribution' ? 'Predicted sampling % per t-band' : 'Mean loss weight per t-band';
  const barColor = kind === 'distribution' ? 'bg-blue-500' : 'bg-amber-500';

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
        <span>{title}</span>
        <span className="text-gray-500">noisy ←   → clean</span>
      </div>
      {/* h-24 on the outer row; each column is h-full + flex/items-end so
          the bar inside can use `height: X%` against a defined parent. The
          previous layout had `items-end` on the row with no explicit height
          on the columns, which made the percent-height resolve to 0 and the
          bars collapse to nothing. */}
      <div className="flex gap-px h-24 bg-gray-950 border border-gray-800 rounded p-1">
        {ordered.map(b => {
          const h = Math.max(2, (b.val / maxVal) * 100);
          const label = b.isPct ? `${(b.val * 100).toFixed(1)}%` : b.val.toFixed(2);
          return (
            <div key={b.idx} className="flex-1 h-full flex items-end relative group">
              <div className={`${barColor} w-full rounded-sm`} style={{ height: `${h}%` }} title={label} />
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {label}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-px mt-1">
        {ordered.map(b => (
          <div key={b.idx} className="flex-1 text-center text-[10px] text-gray-500 font-mono">
            t{(b.idx * 10).toString().padStart(2, '0')}
          </div>
        ))}
      </div>
    </div>
  );
}

function CurveCard({ curve, onEdit, onDelete }: { curve: Curve; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-gray-100 font-mono truncate">{curve.name}</div>
          {curve.description && <div className="text-xs text-gray-500 truncate">{curve.description}</div>}
        </div>
        <button className="text-gray-400 hover:bg-red-600 p-1.5 rounded" onClick={onDelete} title="Delete">
          <FaRegTrashAlt className="w-3.5 h-3.5" />
        </button>
      </div>
      <button onClick={onEdit} className="block">
        <CurveEditor points={curve.points} width={300} height={140} yMax={3} readOnly showAxes={false} />
      </button>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{curve.points.length} anchors</span>
        <span>{curve.normalize === false ? 'raw' : 'mean=1'}</span>
      </div>
    </div>
  );
}
