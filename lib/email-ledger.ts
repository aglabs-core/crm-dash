import type { Tone } from './constants';

// Unified e-mail ledger (table `email_messages`): one row per message sent to
// or received from a contact, whatever the provider or source.
export type EmailMessageStatus =
  | 'scheduled' | 'accepted' | 'deferred' | 'soft_bounced' | 'delivered' | 'opened' | 'clicked' | 'replied'
  | 'failed' | 'bounced' | 'complained' | 'unsubscribed' | 'received';
export type EmailMessageCategory = 'prospeccao' | 'campanha' | 'automacao' | 'transacional' | 'atendimento';

export type EmailMessage = {
  id: string;
  contact_id: string;
  direction: 'outbound' | 'inbound';
  provider: 'brevo' | 'resend' | 'mailbox';
  category: EmailMessageCategory;
  source_key: string;
  product: string | null;
  campaign_id: string | null;
  address: string;
  from_address: string | null;
  reply_to: string | null;
  subject: string;
  summary: string | null;
  body_text: string | null;
  body_html: string | null;
  status: EmailMessageStatus;
  sent_at: string;
  status_at: string;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
};

export type EmailMessageEvent = { id: string; message_id: string; event_type: string; provider_event_type: string | null; occurred_at: string };

export type EmailSourceSummary = {
  category: EmailMessageCategory; source_key: string; product: string | null; sent: number; delivered: number;
  opened: number; clicked: number; replied: number; failed: number; opted_out: number; last_sent_at: string;
};

const STATUS: Record<EmailMessageStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Agendado', tone: 'gray' },
  accepted: { label: 'Aceito pelo provedor', tone: 'gray' },
  deferred: { label: 'Entrega adiada', tone: 'amber' },
  soft_bounced: { label: 'Não entregue (temporário)', tone: 'amber' },
  delivered: { label: 'Entregue', tone: 'blue' },
  opened: { label: 'Aberto', tone: 'indigo' },
  clicked: { label: 'Clicou no link', tone: 'purple' },
  replied: { label: 'Respondeu', tone: 'emerald' },
  failed: { label: 'Falhou', tone: 'red' },
  bounced: { label: 'Endereço inválido', tone: 'red' },
  complained: { label: 'Marcou como spam', tone: 'red' },
  unsubscribed: { label: 'Descadastrou', tone: 'red' },
  received: { label: 'Recebido', tone: 'emerald' },
};
export const emailStatusMeta = (status: string) => STATUS[status as EmailMessageStatus] ?? { label: status, tone: 'gray' as Tone };

const CATEGORY: Record<EmailMessageCategory, string> = {
  prospeccao: 'Prospecção', campanha: 'Campanha', automacao: 'Automação', transacional: 'Sistema', atendimento: 'Atendimento',
};
export const emailCategoryLabel = (category: string) => CATEGORY[category as EmailMessageCategory] ?? category;

const SOURCES: Record<string, string> = {
  'barberias.trial.inicio': 'Barberias · Boas-vindas do teste',
  'barberias.trial.meio': 'Barberias · Meio do teste',
  'barberias.trial.ultimo-dia': 'Barberias · Último dia do teste',
  'barberias.trial.encerrado': 'Barberias · Teste encerrado',
  'barberias.trial.recuperacao': 'Barberias · Recuperação (7 dias, cupom)',
  'barberias.trial.ultima-chance': 'Barberias · Último lembrete (14 dias, cupom)',
  'barberias.conta.convite-admin': 'Barberias · Convite de administração',
  'maia.reply': 'Resposta recebida pela Maia',
};
export function emailSourceLabel(source: string): string {
  if (SOURCES[source]) return SOURCES[source];
  if (source.startsWith('prospeccao.')) return `Prospecção · ${source.slice('prospeccao.'.length).replace(/[._-]+/g, ' ')}`;
  return source.replace(/[._-]+/g, ' ');
}

/** Trial-sequence order for the automations overview. */
export const SOURCE_ORDER = ['barberias.trial.inicio', 'barberias.trial.meio', 'barberias.trial.ultimo-dia', 'barberias.trial.encerrado',
  'barberias.trial.recuperacao', 'barberias.trial.ultima-chance', 'barberias.conta.convite-admin'];

const ACCOUNT: Record<string, { label: string; tone: Tone }> = {
  trial: { label: 'Em teste grátis', tone: 'amber' },
  trial_encerrado: { label: 'Teste encerrado', tone: 'gray' },
  ativo: { label: 'Conta ativa', tone: 'emerald' },
  cancelado: { label: 'Assinatura cancelada', tone: 'red' },
};
export const accountStatusMeta = (status: string | null | undefined) => (status ? ACCOUNT[status] : undefined);
