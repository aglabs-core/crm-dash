// Shared Recharts styling. Axis/grid use a neutral slate that reads on both
// light and dark cards; the tooltip is an HTML element so it can use tokens.
import type { CSSProperties } from 'react';

export const CHART_AXIS_TICK = { fill: '#a1a1aa', fontSize: 12 } as const;
export const CHART_GRID = 'rgba(161,161,170,0.18)';

export const chartTooltipStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--fg)',
  boxShadow: '0 8px 24px -8px rgba(0,0,0,0.25)',
  fontSize: 12,
  padding: '8px 12px',
};

export const chartTooltipItemStyle: CSSProperties = { color: 'var(--fg)' };
export const chartTooltipLabelStyle: CSSProperties = {
  color: 'var(--muted)',
  fontWeight: 600,
  marginBottom: 4,
};
