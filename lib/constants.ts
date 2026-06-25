// Taxonomy + visual mapping — single source of truth for stages, statuses,
// priorities and activity types. Reused by badges, the Kanban, contact totals,
// dashboards and reports so colors/labels never drift between screens.

import type { DealStage, ContactStatus, Priority, ActivityType } from './types';

export type Tone =
  | 'gray'
  | 'blue'
  | 'indigo'
  | 'amber'
  | 'emerald'
  | 'red'
  | 'purple';

/** Badge classes per tone, working in light and dark mode. */
export const TONE_BADGE: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700 ring-gray-500/20 dark:bg-gray-400/15 dark:text-gray-300',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/15 dark:text-blue-300',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/15 dark:text-indigo-300',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/15 dark:text-red-300',
  purple: 'bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-500/15 dark:text-purple-300',
};

/** Solid hex per tone, for chart fills/strokes. */
export const TONE_HEX: Record<Tone, string> = {
  gray: '#6b7280',
  blue: '#3b82f6',
  indigo: '#6366f1',
  amber: '#f59e0b',
  emerald: '#10b981',
  red: '#ef4444',
  purple: '#a855f7',
};

export type StageMeta = {
  id: DealStage;
  label: string;
  tone: Tone;
  isOpen: boolean;
  isWon: boolean;
  isLost: boolean;
};

export const DEAL_STAGES: StageMeta[] = [
  { id: 'Lead', label: 'Lead', tone: 'gray', isOpen: true, isWon: false, isLost: false },
  { id: 'Contatado', label: 'Contatado', tone: 'blue', isOpen: true, isWon: false, isLost: false },
  { id: 'Proposta', label: 'Proposta', tone: 'indigo', isOpen: true, isWon: false, isLost: false },
  { id: 'Negociação', label: 'Negociação', tone: 'amber', isOpen: true, isWon: false, isLost: false },
  { id: 'Ganho', label: 'Ganho', tone: 'emerald', isOpen: false, isWon: true, isLost: false },
  { id: 'Perdido', label: 'Perdido', tone: 'red', isOpen: false, isWon: false, isLost: true },
];

/** Open stages, in pipeline order (used for the funnel chart). */
export const OPEN_STAGES = DEAL_STAGES.filter((s) => s.isOpen);

const STAGE_BY_ID = new Map(DEAL_STAGES.map((s) => [s.id, s]));
export function stageMeta(stage: string): StageMeta {
  return STAGE_BY_ID.get(stage as DealStage) ?? DEAL_STAGES[0];
}
export function stageTone(stage: string): Tone {
  return stageMeta(stage).tone;
}

export const CONTACT_STATUSES: { id: ContactStatus; label: string; tone: Tone }[] = [
  { id: 'Lead', label: 'Lead', tone: 'gray' },
  { id: 'Contatado', label: 'Contatado', tone: 'blue' },
  { id: 'Proposta', label: 'Proposta', tone: 'indigo' },
  { id: 'Negociação', label: 'Negociação', tone: 'amber' },
  { id: 'Ganho', label: 'Ganho', tone: 'emerald' },
  { id: 'Cliente', label: 'Cliente', tone: 'emerald' },
  { id: 'Inativo', label: 'Inativo', tone: 'gray' },
];

const STATUS_TONE = new Map(CONTACT_STATUSES.map((s) => [s.id, s.tone]));
export function statusTone(status: string): Tone {
  return STATUS_TONE.get(status as ContactStatus) ?? 'gray';
}

export const PRIORITIES: { id: Priority; label: string; tone: Tone }[] = [
  { id: 'Baixa', label: 'Baixa', tone: 'emerald' },
  { id: 'Média', label: 'Média', tone: 'amber' },
  { id: 'Alta', label: 'Alta', tone: 'red' },
];

const PRIORITY_TONE = new Map(PRIORITIES.map((p) => [p.id, p.tone]));
export function priorityTone(priority: string | null | undefined): Tone {
  return PRIORITY_TONE.get((priority as Priority) ?? 'Média') ?? 'amber';
}

export type ActivityMeta = { label: string; tone: Tone; icon: string };
/** `icon` is a lucide-react icon name resolved by the timeline component. */
export const ACTIVITY_META: Record<ActivityType, ActivityMeta> = {
  note: { label: 'Nota', tone: 'gray', icon: 'StickyNote' },
  call: { label: 'Ligação', tone: 'blue', icon: 'Phone' },
  email: { label: 'E-mail', tone: 'indigo', icon: 'Mail' },
  meeting: { label: 'Reunião', tone: 'purple', icon: 'Users' },
  stage_change: { label: 'Mudança de estágio', tone: 'amber', icon: 'ArrowRightLeft' },
  task: { label: 'Tarefa', tone: 'emerald', icon: 'CheckSquare' },
};

/** Activity types a user can log manually (excludes system-generated ones). */
export const LOGGABLE_ACTIVITY_TYPES: ActivityType[] = ['note', 'call', 'email', 'meeting'];
