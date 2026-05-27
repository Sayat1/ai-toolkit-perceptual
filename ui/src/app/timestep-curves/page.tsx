'use client';

import CurveLibrary from '@/components/CurveLibrary';

export default function TimestepCurvesPage() {
  return (
    <CurveLibrary
      config={{
        kind: 'weighting',
        apiBase: '/api/timestep-curves',
        pageTitle: 'Timestep Weighting Curves',
        pageBlurb:
          'Per-step weights applied to the diffusion loss. The loss at each sampled timestep is multiplied by curve(t). y = 1.0 (dashed line) is neutral — by default the curve is used as-drawn so y=2 means "2× this sample\'s loss". Drag anchors to shape, click empty space to add, double-click to remove. Mean-normalize is opt-in (toggle below the editor): when on, the curve is rescaled so its mean across all timesteps is 1.0 — useful if you want to redistribute weighting without changing the overall loss magnitude, at the cost of making y=1.0 no longer mean "neutral".',
        showNormalizeToggle: true,
        presets: [
          {
            name: 'mid-boost',
            description: 'Peak at mid-t (matches the built-in "weighted" type)',
            points: [
              { x: 0, y: 0.2 },
              { x: 0.5, y: 1.6 },
              { x: 1, y: 0.2 },
            ],
          },
          {
            name: 'low-t-boost',
            description: 'Peak at the clean end',
            points: [
              { x: 0, y: 0.2 },
              { x: 0.6, y: 0.8 },
              { x: 1, y: 2.2 },
            ],
          },
          {
            name: 'high-t-boost',
            description: 'Peak at the noisy end',
            points: [
              { x: 0, y: 2.2 },
              { x: 0.4, y: 0.8 },
              { x: 1, y: 0.2 },
            ],
          },
        ],
        statsLabel: s => `mean ${s.mean.toFixed(2)} · min ${s.min.toFixed(2)} · max ${s.max.toFixed(2)}`,
      }}
    />
  );
}
