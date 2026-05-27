'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/utils/api';
import CurveEditor, { type CurvePoint } from '@/components/CurveEditor';

interface SavedCurve {
  name: string;
  description?: string;
  points: CurvePoint[];
  normalize?: boolean;
}

export interface InlineCurve {
  points: CurvePoint[];
  normalize?: boolean;
  /** Name of the saved curve this was copied from, if any. Surfaced as the
   *  selected entry in the dropdown so the user remembers what they picked. */
  sourceName?: string;
}

interface Props {
  /** Currently inlined curve on the job's config (`null` when the user just
   *  switched modes and hasn't picked one yet). */
  value: InlineCurve | null | undefined;
  onChange: (next: InlineCurve | null) => void;
  /** API base path to load curves from (no trailing slash). */
  apiBase: string;
  /** Sidebar route to "Manage curves →" link. */
  manageHref: string;
  /** Label above the dropdown. */
  label: string;
}

const inputCls = 'bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-200';
const labelCls = 'block text-xs mb-1 mt-2 text-gray-300';

export default function CustomTimestepCurvePicker({ value, onChange, apiBase, manageHref, label }: Props) {
  const [curves, setCurves] = useState<SavedCurve[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    setStatus('loading');
    apiClient
      .get(apiBase)
      .then(res => {
        setCurves(res.data.curves ?? []);
        setStatus('success');
      })
      .catch(() => setStatus('error'));
  }, [apiBase]);

  const handleSelect = async (name: string) => {
    if (!name) {
      onChange(null);
      return;
    }
    // Always fetch the curve by name when the user picks it — the curves
    // list was loaded once on mount, so if the user edited the curve in
    // another tab (or before opening this page from a stale tab) the
    // cached entry is out of date. The job snapshot needs the latest
    // content, not whatever was in memory when the page was first opened.
    try {
      const res = await apiClient.get(`${apiBase}/${encodeURIComponent(name)}`);
      const c = res.data?.curve;
      if (!c) return;
      onChange({ points: c.points, normalize: c.normalize, sourceName: c.name });
    } catch {
      // Fallback to the cached list if the lookup fails for any reason —
      // better than silently doing nothing.
      const c = curves.find(c => c.name === name);
      if (c) onChange({ points: c.points, normalize: c.normalize, sourceName: c.name });
    }
  };

  const selected = value?.sourceName ?? '';
  const previewPoints: CurvePoint[] = value?.points ?? [];

  return (
    <div className="mt-2 p-3 rounded-md bg-gray-900/50 border border-gray-800">
      <div className="flex items-center justify-between">
        <label className={labelCls}>{label}</label>
        <Link href={manageHref} className="text-xs text-blue-400 hover:text-blue-300">
          Manage →
        </Link>
      </div>
      <select
        value={selected}
        onChange={e => handleSelect(e.target.value)}
        className={`${inputCls} w-full`}
        disabled={status === 'loading'}
      >
        <option value="">
          {status === 'loading' ? 'Loading…' : curves.length === 0 ? 'Nothing saved yet' : 'Pick…'}
        </option>
        {curves.map(c => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      {status === 'success' && curves.length === 0 && (
        <div className="text-xs text-gray-500 mt-2">
          None yet. Open the{' '}
          <Link href={manageHref} className="text-blue-400 hover:text-blue-300">
            {label.toLowerCase()}
          </Link>{' '}
          page to create one.
        </div>
      )}
      {previewPoints.length >= 2 && (
        <div className="mt-2">
          <CurveEditor points={previewPoints} width={300} height={120} yMax={3} readOnly showAxes={false} />
        </div>
      )}
    </div>
  );
}
