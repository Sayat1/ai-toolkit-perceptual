'use client';

import CurveLibrary from '@/components/CurveLibrary';

export default function TimestepDistributionsPage() {
  return (
    <CurveLibrary
      config={{
        kind: 'distribution',
        apiBase: '/api/timestep-distributions',
        pageTitle: 'Timestep Distributions',
        pageBlurb:
          'Shape the *probability distribution* of timesteps the trainer samples each step. The curve is treated as an unnormalized PDF — only the ratios between points matter. The trainer renormalizes to a 1000-bin PMF and draws timesteps via inverse-CDF sampling. This is different from a weighting curve: where weighting samples uniformly and scales the loss, a distribution actually changes which timesteps the model sees. Drag anchors to shape, click empty space to add, double-click to remove.',
        showNormalizeToggle: false,
        presets: [
          {
            name: 'sigmoid-like',
            description: 'Bell centered at mid-t (mimics the built-in "sigmoid" distribution)',
            points: [
              { x: 0, y: 0.05 },
              { x: 0.5, y: 1.0 },
              { x: 1, y: 0.05 },
            ],
          },
          {
            name: 'low-t-heavy',
            description: 'Spend most steps near the clean end',
            points: [
              { x: 0, y: 0.05 },
              { x: 0.7, y: 0.5 },
              { x: 1, y: 1.5 },
            ],
          },
          {
            name: 'high-t-heavy',
            description: 'Spend most steps near the noisy end',
            points: [
              { x: 0, y: 1.5 },
              { x: 0.3, y: 0.5 },
              { x: 1, y: 0.05 },
            ],
          },
          {
            name: 'bimodal',
            description: 'Concentrate sampling on the two extremes',
            points: [
              { x: 0, y: 1.5 },
              { x: 0.25, y: 0.4 },
              { x: 0.5, y: 0.1 },
              { x: 0.75, y: 0.4 },
              { x: 1, y: 1.5 },
            ],
          },
        ],
        statsLabel: s => {
          // Distributions don't have a meaningful "weight"; show concentration
          // instead — how many bins (out of 100) carry 50%+ of the mass.
          const samples = [s.min, s.mean, s.max];
          return `peak ${s.max.toFixed(2)} · trough ${s.min.toFixed(2)} · peak/trough ${(samples[2] / Math.max(samples[0], 1e-6)).toFixed(1)}×`;
        },
      }}
    />
  );
}
