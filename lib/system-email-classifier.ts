// Classifies e-mails sent by product backends (today: Barberias via Resend) into
// ledger records. Only messages addressed to the account owner become CRM
// history; e-mails to a barbershop's own customers or staff are ignored and
// nothing about them is stored.
//
// Resend tags (`category`, `stage`) are authoritative when present. Subjects
// are the fallback for messages sent before tagging existed; they mirror the
// templates in barberias/backend/trial-nurture.cjs and EmailService.cjs.

export type AccountStatus = 'trial' | 'trial_encerrado' | 'ativo' | 'cancelado';

export type SystemEmailRecord = {
  category: 'automacao' | 'transacional';
  source_key: string;
  product: string;
  summary: string;
  account_status?: AccountStatus;
  account_name?: string;
};

type Rule = {
  stage: string;
  pattern: RegExp;
  account: AccountStatus;
  summary: (offer: boolean) => string;
};

const TRIAL_RULES: Rule[] = [
  { stage: 'inicio', pattern: /^Bem-vindo ao Barberias\s+—\s+(.+)$/u, account: 'trial',
    summary: () => 'Boas-vindas ao teste grátis: convida a configurar profissionais, serviços e horários e indica o próximo passo no painel.' },
  { stage: 'inicio', pattern: /^Seu teste do Barberias começou,\s*(.+)$/u, account: 'trial',
    summary: () => 'Boas-vindas ao teste grátis (modelo anterior): confirma o início do teste e convida a configurar a barbearia.' },
  { stage: 'meio', pattern: /^Aproveite seu teste: restam cerca de .+$/u, account: 'trial',
    summary: () => 'Meio do teste: lembra que restam poucos dias e sugere o próximo passo da configuração.' },
  { stage: 'meio', pattern: /^Faltam \d+ dias? do seu teste no Barberias$/u, account: 'trial',
    summary: () => 'Meio do teste (modelo anterior): lembra quantos dias restam.' },
  { stage: 'ultimo-dia', pattern: /^Seu período de teste está terminando$/u, account: 'trial',
    summary: () => 'Último dia do teste: avisa que termina em 24 horas e apresenta os planos para continuar.' },
  { stage: 'encerrado', pattern: /^Seu teste terminou — veja como continuar$/u, account: 'trial_encerrado',
    summary: () => 'Teste encerrado: convida a escolher um plano e pergunta o que faltou para assinar.' },
  { stage: 'recuperacao', pattern: /^Um desconto para a (.+) voltar ao Barberias$/u, account: 'trial_encerrado',
    summary: () => 'Recuperação (7 dias após o teste): oferece cupom de desconto para voltar e convida a responder se algo faltou.' },
  { stage: 'recuperacao', pattern: /^A (.+) continua salva no Barberias$/u, account: 'trial_encerrado',
    summary: () => 'Recuperação (7 dias após o teste): lembra que os dados continuam salvos e convida a escolher um plano.' },
  { stage: 'ultima-chance', pattern: /^Último lembrete: cupom \S+ para a (.+)$/u, account: 'trial_encerrado',
    summary: () => 'Último lembrete (14 dias após o teste): o cupom ainda vale; é o último e-mail da sequência.' },
  { stage: 'ultima-chance', pattern: /^Último lembrete sobre o teste da (.+)$/u, account: 'trial_encerrado',
    summary: () => 'Último lembrete (14 dias após o teste): último e-mail da sequência, sem cupom.' },
];

const SUMMARY_BY_STAGE = new Map(TRIAL_RULES.map((rule) => [rule.stage, rule]));
const ACCOUNT_INVITE = /^Convite para administrar\s+—\s+(.+)$/u;
// Explicitly not CRM history: customers and staff of a barbershop.
const IGNORED = [/^Convite para a equipe/u, /^Redefina sua senha/u, /^Ative seu acesso/u, /Agendamento confirmado/u,
  /^Lembrete do seu agendamento/u, /^Uma data da recorrência/u, /^Nova solicitação de cadastro/u];

function tagValue(tags: unknown, name: string): string | undefined {
  if (Array.isArray(tags)) {
    const found = tags.find((tag) => tag && typeof tag === 'object' && (tag as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof found?.value === 'string' ? found.value : undefined;
  }
  if (tags && typeof tags === 'object') {
    const value = (tags as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

export function isBarberiasSender(from: string): boolean {
  return /@barberias\.com\.br>?\s*$/i.test(from.trim());
}

export function classifySystemEmail(input: { from: string; subject: string; tags?: unknown }): SystemEmailRecord | null {
  if (!isBarberiasSender(input.from)) return null;
  const subject = input.subject.trim();
  const taggedCategory = tagValue(input.tags, 'category');
  const taggedStage = tagValue(input.tags, 'stage');
  if (taggedCategory && taggedCategory !== 'trial' && taggedCategory !== 'account') return null;
  if (taggedCategory === 'trial' && taggedStage && SUMMARY_BY_STAGE.has(taggedStage)) {
    const rule = SUMMARY_BY_STAGE.get(taggedStage)!;
    const name = TRIAL_RULES.map((r) => r.pattern.exec(subject)?.[1]).find(Boolean);
    return { category: 'automacao', source_key: `barberias.trial.${taggedStage}`, product: 'barberias',
      summary: rule.summary(false), account_status: rule.account, account_name: name?.trim() };
  }
  if (IGNORED.some((pattern) => pattern.test(subject))) return null;
  for (const rule of TRIAL_RULES) {
    const match = rule.pattern.exec(subject);
    if (match) {
      return { category: 'automacao', source_key: `barberias.trial.${rule.stage}`, product: 'barberias',
        summary: rule.summary(false), account_status: rule.account, account_name: match[1]?.trim() };
    }
  }
  const invite = ACCOUNT_INVITE.exec(subject);
  if (invite) {
    return { category: 'transacional', source_key: 'barberias.conta.convite-admin', product: 'barberias',
      summary: 'Convite para administrar a barbearia no Barberias (conta criada pela equipe).', account_name: invite[1]?.trim() };
  }
  return null;
}

/** Ledger payload for crm_ingest_resend_event / crm_record_outbound_email. */
export function systemEmailLedgerRecord(record: SystemEmailRecord, message: {
  subject: string; from: string; reply_to?: string | null; sent_at: string; rfc_message_id?: string | null;
}) {
  const shop = record.account_name && record.account_name.length <= 120 ? record.account_name : undefined;
  return {
    category: record.category, source_key: record.source_key, product: record.product, summary: record.summary,
    subject: message.subject.slice(0, 300), from_address: message.from.slice(0, 320), reply_to: message.reply_to ?? null,
    sent_at: message.sent_at, rfc_message_id: message.rfc_message_id ?? undefined,
    contact: {
      name: shop, company: shop, status: 'Lead', origin: 'cadastro', product: record.product,
      account_status: record.account_status, promote_status: record.account_status === 'trial' ? 'Lead' : undefined,
    },
  };
}
