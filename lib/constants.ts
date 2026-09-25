// Taxonomy + visual mapping — single source of truth for stages, statuses,
// priorities and activity types. Reused by badges, the Kanban, contact totals,
// dashboards and reports so colors/labels never drift between screens.

import type {
  ContactStatus,
  ContactOrigin,
  Priority,
  ActivityType,
  ActivityChannel,
  LeadStatus,
} from './types';

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

// ---- Contact lifecycle — single source of truth for the funnel ------------
// One field (`contacts.status`) drives everything. The active stages mirror the
// message/WhatsApp attendance flow, in order:
//   Lead (esperando) · Contatado · Atendimento (em conversa) ·
//   Proposta (orçamento enviado) · Pagamento (aguardando pagamento) -> Kanban
//   Cliente (ativo) · Inativo (inativo)                             -> won
//   Arquivado (não fechou)                                          -> lost

export type StatusGroup = 'active' | 'client' | 'archived';

export type StatusMeta = { id: ContactStatus; label: string; tone: Tone; group: StatusGroup };

export const CONTACT_STATUSES: StatusMeta[] = [
  { id: 'Lead', label: 'Lead', tone: 'gray', group: 'active' },
  { id: 'Contatado', label: 'Contatado', tone: 'blue', group: 'active' },
  { id: 'Atendimento', label: 'Atendimento', tone: 'indigo', group: 'active' },
  { id: 'Proposta', label: 'Proposta', tone: 'purple', group: 'active' },
  { id: 'Pagamento', label: 'Pagamento', tone: 'amber', group: 'active' },
  { id: 'Cliente', label: 'Cliente', tone: 'emerald', group: 'client' },
  { id: 'Inativo', label: 'Cliente inativo', tone: 'gray', group: 'client' },
  { id: 'Arquivado', label: 'Arquivado', tone: 'red', group: 'archived' },
];

/** Active funnel stages, in order — the Kanban columns. */
export const KANBAN_STATUSES = CONTACT_STATUSES.filter((s) => s.group === 'active');

const STATUS_BY_ID = new Map(CONTACT_STATUSES.map((s) => [s.id, s]));
export function statusMeta(status: string): StatusMeta {
  return STATUS_BY_ID.get(status as ContactStatus) ?? CONTACT_STATUSES[0];
}
export function statusTone(status: string): Tone {
  return statusMeta(status).tone;
}
export function statusLabel(status: string): string {
  return statusMeta(status).label;
}
export const isActiveStatus = (s: string | null | undefined) => statusMeta(s ?? '').group === 'active';
export const isClientStatus = (s: string | null | undefined) => statusMeta(s ?? '').group === 'client';
export const isArchivedStatus = (s: string | null | undefined) => statusMeta(s ?? '').group === 'archived';

// ---- Origin — where the contact came from ---------------------------------
export const ORIGINS: { id: ContactOrigin; label: string; tone: Tone }[] = [
  { id: 'web', label: 'Web', tone: 'indigo' },
  { id: 'prospeccao', label: 'Prospecção', tone: 'blue' },
  { id: 'whatsapp', label: 'WhatsApp', tone: 'emerald' },
  { id: 'email', label: 'E-mail', tone: 'amber' },
  { id: 'manual', label: 'Manual', tone: 'gray' },
  { id: 'compra', label: 'Compra', tone: 'purple' },
];
const ORIGIN_TONE = new Map(ORIGINS.map((o) => [o.id, o.tone]));
export function originTone(origin: string | null | undefined): Tone {
  return ORIGIN_TONE.get(origin as ContactOrigin) ?? 'gray';
}
export function originLabel(origin: string | null | undefined): string {
  return ORIGINS.find((o) => o.id === origin)?.label ?? 'Não informada';
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

/** Handling status of inbound (web-captured) institutional leads. */
export const LEAD_STATUSES: { id: LeadStatus; label: string; tone: Tone }[] = [
  { id: 'novo', label: 'Novo', tone: 'blue' },
  { id: 'contatado', label: 'Contatado', tone: 'amber' },
  { id: 'convertido', label: 'Convertido', tone: 'emerald' },
  { id: 'descartado', label: 'Descartado', tone: 'gray' },
];

const LEAD_STATUS_TONE = new Map(LEAD_STATUSES.map((s) => [s.id, s.tone]));
export function leadStatusTone(status: string | null | undefined): Tone {
  return LEAD_STATUS_TONE.get((status as LeadStatus) ?? 'novo') ?? 'blue';
}

export type ActivityMeta = { label: string; tone: Tone; icon: string };
/** `icon` is a lucide-react icon name resolved by the timeline component. */
export const ACTIVITY_META: Record<ActivityType, ActivityMeta> = {
  note: { label: 'Nota', tone: 'gray', icon: 'StickyNote' },
  followup: { label: 'Follow-up', tone: 'blue', icon: 'Repeat' },
  boas_vindas: { label: 'Boas-vindas', tone: 'emerald', icon: 'Sparkles' },
  disparo: { label: 'Disparo', tone: 'indigo', icon: 'Megaphone' },
  suporte: { label: 'Suporte', tone: 'red', icon: 'LifeBuoy' },
  meeting: { label: 'Reunião', tone: 'purple', icon: 'Users' },
  stage_change: { label: 'Mudança de estágio', tone: 'amber', icon: 'ArrowRightLeft' },
  task: { label: 'Tarefa', tone: 'emerald', icon: 'CheckSquare' },
};

/** Activity types a user can log manually (excludes system-generated ones). */
export const LOGGABLE_ACTIVITY_TYPES: ActivityType[] = [
  'note',
  'followup',
  'boas_vindas',
  'disparo',
  'suporte',
  'meeting',
];

// ---- Channel — por onde a interação aconteceu ------------------------------
export const ACTIVITY_CHANNELS: { id: ActivityChannel; label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'E-mail' },
  { id: 'telefone', label: 'Telefone' },
  { id: 'presencial', label: 'Presencial' },
  { id: 'sistema', label: 'Sistema' },
];
export function channelLabel(channel: string | null | undefined): string | null {
  return ACTIVITY_CHANNELS.find((c) => c.id === channel)?.label ?? null;
}
