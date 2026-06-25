// Formatting helpers — replaces the ~10 inline `Intl.NumberFormat('pt-BR')`
// copies and centralizes date handling on date-fns.

import { format, formatDistanceToNow, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const NUM = new Intl.NumberFormat('pt-BR');

export function formatCurrency(value: number | null | undefined): string {
  return BRL.format(Number(value) || 0);
}

/** Compact currency for axis ticks / tight spaces, e.g. "R$ 12,5 mil". */
export function formatCurrencyCompact(value: number | null | undefined): string {
  return BRL_COMPACT.format(Number(value) || 0);
}

export function formatNumber(value: number | null | undefined): string {
  return NUM.format(Number(value) || 0);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

function toDate(date: string | Date | null | undefined): Date | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(date: string | Date | null | undefined): string {
  const d = toDate(date);
  return d ? format(d, 'dd/MM/yyyy', { locale: ptBR }) : '—';
}

export function formatDateTime(date: string | Date | null | undefined): string {
  const d = toDate(date);
  return d ? format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : '—';
}

/** e.g. "há 3 dias", "em 2 meses". */
export function formatRelative(date: string | Date | null | undefined): string {
  const d = toDate(date);
  return d ? formatDistanceToNow(d, { locale: ptBR, addSuffix: true }) : '—';
}

export type Change = { text: string; type: 'positive' | 'negative' | 'neutral' };

/**
 * Honest month-over-month delta. Returns null when there is no prior-period
 * signal to compare against (so the UI can hide a misleading "0%").
 */
export function formatChange(current: number, previous: number): Change | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { text: '+100%', type: 'positive' };
  const change = ((current - previous) / previous) * 100;
  const type = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
  return { text: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`, type };
}

/** Whole days from today until `date` (negative if in the past). */
export function daysUntil(date: string | Date | null | undefined): number | null {
  const d = toDate(date);
  return d ? differenceInCalendarDays(d, new Date()) : null;
}
