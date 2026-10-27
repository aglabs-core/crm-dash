import { productMetrics } from './product-metrics';
import { timingSafeEqual } from 'node:crypto';
import { readLimitedJson } from './brevo-receiver';
import { campaignProductKey } from './campaign-preparation';
import { paymentRevenue, netRevenue } from './payment-analytics';
import type { Contact, PaymentTransaction, TaskAssignee, Task } from './types';
import { buildActions } from './action-center';

// Servidor MCP do CRM (Streamable HTTP, sem sessão, respostas JSON).
// Quem chama: a Órbita e, no futuro, outros agentes, cada um com o próprio
// token e escopos. A interface só lê o funil e as tarefas, cria e conclui
// tarefas e registra atividades. Não apaga, não exporta, não muda o estágio do
// funil e não devolve e-mail, telefone ou documento dos contatos.

export const MCP_SCOPES = ['leitura', 'tarefas', 'atividades'] as const;
export type McpScope = typeof MCP_SCOPES[number];
export type McpCaller = { name: string; scopes: McpScope[] };
type TokenEntry = McpCaller & { token: string };

const ASSIGNEES: TaskAssignee[] = ['maia', 'leo', 'antonio', 'tecnico'];
const PRIORITIES = ['Baixa', 'Média', 'Alta'] as const;
const ACTIVITY_TYPES = ['note', 'followup', 'suporte', 'meeting'] as const;
const ACTIVITY_CHANNELS = ['whatsapp', 'email', 'telefone', 'presencial', 'instagram'] as const;
const FUNNEL = ['Lead', 'Contatado', 'Atendimento', 'Proposta', 'Pagamento'] as const;
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** `CRM_MCP_TOKENS`: entradas `nome:token:escopo,escopo`, separadas por `;` ou quebra de linha. */
export function parseMcpTokens(raw: string | undefined): TokenEntry[] {
  return (raw || '').split(/[;\n]/).map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
    const [name, token, scopes = ''] = entry.split(':');
    const list = [...new Set(scopes.split(',').map((s) => s.trim()))]
      .filter((s): s is McpScope => (MCP_SCOPES as readonly string[]).includes(s));
    if (!/^[a-z0-9-]{2,40}$/.test(name || '') || !token || token.length < 32 || !list.length) return [];
    return [{ name, token, scopes: list }];
  });
}

export function authenticate(header: string | null, tokens: TokenEntry[]): McpCaller | null {
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header || '');
  if (!match) return null;
  const actual = Buffer.from(match[1]);
  let caller: McpCaller | null = null;
  for (const entry of tokens) {
    const expected = Buffer.from(entry.token);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) caller = { name: entry.name, scopes: entry.scopes };
  }
  return caller;
}

// ---- Dados ------------------------------------------------------------------

export type McpTask = {
  id: string; title: string; description: string | null; due_date: string | null; priority: string | null;
  status: string; assigned_to: TaskAssignee | null; contact_id: string | null; contact_name: string | null; created_at: string;
  /** Produto do contato ligado à tarefa; tarefa sem contato não pertence a um produto. */
  contact_product?: string | null;
};
export type McpContact = {
  id: string; name: string | null; company: string | null; status: string; produto: string | null; origin: string | null;
  prospecting_pool: boolean | null; account_status: string | null; amount: number | null; expected_close_date: string | null;
  has_email: boolean; has_whatsapp: boolean; created_at: string; updated_at: string | null;
};
export type McpActivity = { type: string; channel: string | null; content: string | null; created_at: string };
export type McpFunnelContact = { status: string; prospecting_pool: boolean | null; created_at: string; produto?: string | null; account_status?: string | null };
/** Linha do registro único de e-mails sem endereço, assunto ou corpo: só o necessário para contar o funil. */
export type McpEmailRow = {
  direction: 'outbound' | 'inbound'; category: string; source_key: string; product: string | null; status: string; campaign_id: string | null;
  sent_at: string; delivered_at: string | null; opened_at: string | null; clicked_at: string | null; replied_at: string | null;
};

/** Tudo que o servidor precisa do banco. Implementação real em `mcp-store.ts`; os testes usam uma falsa. */
export type CrmStore = {
  actionContacts(): Promise<Pick<Contact, 'id' | 'status' | 'produto' | 'prospecting_pool' | 'account_status' | 'account_updated_at' | 'updated_at'>[]>;
  funnelContacts(): Promise<McpFunnelContact[]>;
  paymentsSince(iso?: string): Promise<PaymentTransaction[]>;
  pendingTasks(): Promise<McpTask[]>;
  searchContacts(term: string, limit: number): Promise<McpContact[]>;
  contact(id: string): Promise<McpContact | null>;
  contactActivities(id: string, limit: number): Promise<McpActivity[]>;
  contactPayments(id: string): Promise<PaymentTransaction[]>;
  task(id: string): Promise<McpTask | null>;
  insertTask(row: { title: string; description: string | null; due_date: string | null; priority: string; assigned_to: TaskAssignee; contact_id: string | null }): Promise<McpTask>;
  completeTask(id: string): Promise<void>;
  insertActivity(row: { contact_id: string | null; type: string; channel: string | null; content: string }): Promise<void>;
  emailMessagesSince(iso: string): Promise<McpEmailRow[]>;
};

// ---- Validação --------------------------------------------------------------

class InvalidArgs extends Error {}
type Args = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Número de cartão (13 a 19 dígitos que passam no Luhn) e senha ou token escritos
// com o valor ("senha: ...") não entram no CRM por esta interface. Falar de senha
// ou token ("redefinir senha", "renovar token") continua permitido.
const SECRET = /\b(senha|password|cvv|token)\s*(?:[:=]|é|eh)\s*\S/i;
const CARD_CANDIDATE = /\b(?:\d[ .-]?){13,19}\b/g;
function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
export function hasSensitiveData(text: string) {
  if (SECRET.test(text)) return true;
  return (text.match(CARD_CANDIDATE) ?? []).some((m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); });
}

function str(args: Args, key: string, min: number, max: number, required: true): string;
function str(args: Args, key: string, min: number, max: number, required?: false): string | null;
function str(args: Args, key: string, min: number, max: number, required = false) {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new InvalidArgs(`${key} é obrigatório`);
    return null;
  }
  if (typeof value !== 'string') throw new InvalidArgs(`${key} deve ser texto`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new InvalidArgs(`${key} deve ter entre ${min} e ${max} caracteres`);
  return text;
}
function oneOf<T extends string>(args: Args, key: string, list: readonly T[], fallback?: T): T {
  const value = args[key] ?? fallback;
  if (typeof value !== 'string' || !list.includes(value as T)) throw new InvalidArgs(`${key} deve ser um de: ${list.join(', ')}`);
  return value as T;
}
function uuid(args: Args, key: string, required: boolean): string | null {
  const value = args[key];
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new InvalidArgs(`${key} deve ser um id válido`);
  return value.toLowerCase();
}
function date(args: Args, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) throw new InvalidArgs(`${key} deve estar no formato AAAA-MM-DD`);
  return value;
}
function clean(text: string | null, key: string) {
  if (text && hasSensitiveData(text)) throw new InvalidArgs(`${key} parece conter dado sensível (cartão, senha ou token); registre sem ele`);
  return text;
}

// ---- Ferramentas ------------------------------------------------------------

export function localToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
function previousMonthStart(day: string) {
  const [y, m] = day.split('-').map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}
const spIso = (day: string) => `${day}T00:00:00-03:00`;
const PRIORITY_RANK: Record<string, number> = { Alta: 0, 'Média': 1, Baixa: 2 };
function byUrgency(a: McpTask, b: McpTask) {
  return (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (PRIORITY_RANK[a.priority ?? ''] ?? 1) - (PRIORITY_RANK[b.priority ?? ''] ?? 1);
}
const taskView = (t: McpTask, today: string) => ({
  id: t.id, titulo: t.title, descricao: t.description, prazo: t.due_date, prioridade: t.priority, responsavel: t.assigned_to,
  contato: t.contact_id ? { id: t.contact_id, nome: t.contact_name } : null, vencida: !!t.due_date && t.due_date < today,
});
const contactView = (c: McpContact) => ({
  id: c.id, nome: c.name, empresa: c.company, etapa: c.status, produto: c.produto, origem: c.origin,
  prospeccao: !!c.prospecting_pool, conta_no_produto: c.account_status, valor_estimado: c.amount,
  previsao_fechamento: c.expected_close_date, tem_email: c.has_email, tem_whatsapp: c.has_whatsapp,
  criado_em: c.created_at, atualizado_em: c.updated_at,
});

// Produto: mesma chave das campanhas (minúsculas; o código histórico barberpro é Barberias).
const productKey = (value?: string | null) => campaignProductKey(value) || null;
function productArg(args: Args): string | null {
  const value = str(args, 'produto', 2, 60);
  if (value === null) return null;
  const key = productKey(value)!;
  if (!/^[a-z0-9][a-z0-9_-]{1,59}$/.test(key)) throw new InvalidArgs('produto deve ser o identificador do produto, ex.: barberias');
  return key;
}
const ACCOUNT_STATES = ['trial', 'trial_encerrado', 'ativo', 'cancelado'] as const;
function accounts(contacts: McpFunnelContact[]) {
  return Object.fromEntries(ACCOUNT_STATES.map((s) => [s, contacts.filter((c) => c.account_status === s).length]));
}
const EMAIL_CATEGORIES = ['prospeccao', 'campanha', 'automacao', 'transacional', 'atendimento'] as const;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const delivered = (row: McpEmailRow) => !!row.delivered_at || ['delivered', 'opened', 'clicked', 'replied'].includes(row.status);
const replied = (row: McpEmailRow) => !!row.replied_at || row.status === 'replied';
function emailFunnel(rows: McpEmailRow[]) {
  const enviados = rows.length;
  const entregues = rows.filter(delivered).length;
  const abertos = rows.filter((r) => r.opened_at).length;
  const cliques = rows.filter((r) => r.clicked_at).length;
  const respostas = rows.filter(replied).length;
  return {
    enviados, entregues, abertos, cliques, respostas,
    falhas: rows.filter((r) => ['bounced', 'soft_bounced', 'failed'].includes(r.status)).length,
    descadastros: rows.filter((r) => ['complained', 'unsubscribed'].includes(r.status)).length,
    // Percentuais sobre entregues; null quando não há base (ausência de dados não é zero).
    taxa_entrega: pct(entregues, enviados), taxa_abertura: pct(abertos, entregues), taxa_clique: pct(cliques, entregues), taxa_resposta: pct(respostas, entregues),
  };
}

type Tool = {
  name: string; scope: McpScope; title: string; description: string; readOnly: boolean; openWorld?: boolean;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  run: (args: Args, ctx: { store: CrmStore; caller: McpCaller; now: Date }) => Promise<unknown>;
};

const assigneeProp = { type: 'string', enum: ASSIGNEES, description: 'Papel responsável: maia, leo, antonio ou tecnico' };
const productProp = { type: 'string', minLength: 2, maxLength: 60, description: 'Identificador do produto, ex.: barberias, mecard. Sem ele, o CRM inteiro.' };

export const TOOLS: Tool[] = [
  {
    name: 'crm_prioridades', scope: 'leitura', readOnly: true, title: 'Prioridades comerciais por produto',
    description: 'Contagens para triagem humana: tarefas vencidas, testes com encerramento confirmado e oportunidades sem tarefa pendente. Exclui base fria das oportunidades. Não envia mensagens nem altera etapas.',
    inputSchema: { type: 'object', properties: { produto: productProp }, additionalProperties: false },
    async run(args, { store, now }) {
      const product = productArg(args);
      const [contacts, tasks] = await Promise.all([store.actionContacts(), store.pendingTasks()]);
      const scopedContacts = contacts.filter((c) => !product || productKey(c.produto) === product);
      const scopedTasks = tasks.filter((t) => !product || productKey(t.contact_product) === product);
      const items = buildActions(scopedContacts.map((c) => ({ ...c, name: null })), scopedTasks as unknown as Task[], [], new Date(`${localToday(now)}T12:00:00`));
      const count = (kind: string) => items.filter((item) => item.kind === kind).length;
      return { produto: product, consultado_em: now.toISOString(), tarefas_vencidas: count('overdue'), testes_encerrados: count('trial'), sem_proximo_passo: count('next_step'),
        cobertura: 'Consulta completa de contatos e tarefas pendentes. Uma pessoa pode gerar mais de uma ação. Sem próximo passo significa ausência de tarefa pendente, não ausência de conversa. Respostas de e-mail exigem crm_funil_emails e revisão no CRM. Não mede receita nem autoriza contato.', caminho: '/actions' };
    },
  },
  {
    name: 'crm_metricas_produto', scope: 'leitura', readOnly: true, openWorld: true, title: 'Dados administrativos do produto',
    description: 'Agregados administrativos consultados na API do produto pelo CRM. VibeKit inclui eventos anônimos e compras registradas na janela informada: eventos não são visitantes únicos; valor de checkout não é receita líquida ou liquidada. Sem cadastros pessoais. Não confundir assinantes vigentes com receita do ledger.',
    inputSchema: { type: 'object', properties: { produto: productProp }, required: ['produto'], additionalProperties: false },
    async run(args) { return productMetrics(productArg(args) ?? ''); },
  },
  {
    name: 'crm_resumo', scope: 'leitura', readOnly: true, title: 'Resumo do CRM',
    description: 'Funil por etapa (sem a base fria de prospecção), contas no produto, novos contatos, receita líquida do mês e do mês anterior e tarefas pendentes por responsável. Com produto, tudo filtrado por ele; sem produto, inclui a divisão por produto.',
    inputSchema: { type: 'object', properties: { produto: productProp }, additionalProperties: false },
    async run(args, { store, now }) {
      const today = localToday(now);
      const product = productArg(args);
      const inProduct = (value?: string | null) => !product || productKey(value) === product;
      const [allContacts, allPayments, allTasks] = await Promise.all([store.funnelContacts(), store.paymentsSince(), store.pendingTasks()]);
      const contacts = allContacts.filter((c) => inProduct(c.produto));
      const payments = allPayments.filter((p) => inProduct(p.product));
      const tasks = product ? allTasks.filter((t) => t.contact_id && inProduct(t.contact_product)) : allTasks;
      const active = contacts.filter((c) => !c.prospecting_pool);
      const count = (status: string) => active.filter((c) => c.status === status).length;
      const since = (days: number) => active.filter((c) => Date.parse(c.created_at) >= now.getTime() - days * 86_400_000).length;
      const thisMonth = Date.parse(spIso(monthStart(today)));
      const owners = Object.fromEntries([...ASSIGNEES, 'sem_responsavel'].map((a) => [a, 0])) as Record<string, number>;
      for (const t of tasks) owners[t.assigned_to ?? 'sem_responsavel'] += 1;
      const byProduct = () => {
        const groups = new Map<string, McpFunnelContact[]>();
        for (const c of allContacts) {
          const key = productKey(c.produto) ?? 'sem_produto';
          groups.set(key, [...(groups.get(key) ?? []), c]);
        }
        return Object.fromEntries([...groups].sort((a, b) => b[1].length - a[1].length).map(([key, list]) => {
          const open = list.filter((c) => !c.prospecting_pool);
          return [key, {
            oportunidades_abertas: open.filter((c) => (FUNNEL as readonly string[]).includes(c.status)).length,
            clientes: open.filter((c) => c.status === 'Cliente').length,
            base_prospeccao: list.length - open.length,
            novos_30d: open.filter((c) => Date.parse(c.created_at) >= now.getTime() - 30 * 86_400_000).length,
            contas: accounts(list),
          }];
        }));
      };
      const monthPayments = payments.filter(p => p.paid_at && Date.parse(p.paid_at) >= thisMonth && Date.parse(p.paid_at) <= now.getTime());
      const positive = monthPayments.filter(p => netRevenue(p) > 0);
      return {
        consultado_em: now.toISOString(),
        pagamentos_mes: positive.length,
        pagantes_mes: new Set(positive.map(p => p.contact_id).filter(Boolean)).size,
        pagamentos_sem_contato_mes: positive.filter(p => !p.contact_id).length,
        hoje: today,
        produto: product,
        ...(product ? { cobertura: 'Receita conta só pagamentos registrados com este produto; tarefas, só as ligadas a contatos do produto.' } : {}),
        funil: Object.fromEntries(FUNNEL.map((s) => [s, count(s)])),
        oportunidades_abertas: FUNNEL.reduce((n, s) => n + count(s), 0),
        clientes: count('Cliente'), clientes_inativos: count('Inativo'), contatos_a_qualificar: count('Contato'),
        base_prospeccao: contacts.length - active.length,
        contas_no_produto: accounts(contacts),
        novos_7d: since(7), novos_30d: since(30),
        receita_total: paymentRevenue(payments.filter(p => !p.paid_at || Date.parse(p.paid_at) <= now.getTime())),
        receita_mes: paymentRevenue(monthPayments),
        receita_mes_anterior: paymentRevenue(payments.filter((p) => p.paid_at && Date.parse(p.paid_at) >= Date.parse(spIso(previousMonthStart(today))) && Date.parse(p.paid_at) < thisMonth)),
        tarefas: {
          pendentes: tasks.length, vencidas: tasks.filter((t) => t.due_date && t.due_date < today).length,
          para_hoje: tasks.filter((t) => t.due_date === today).length, por_responsavel: owners,
        },
        ...(product ? {} : { por_produto: byProduct() }),
      };
    },
  },
  {
    name: 'crm_tarefas', scope: 'leitura', readOnly: true, title: 'Tarefas pendentes',
    description: 'Tarefas pendentes do CRM, das mais urgentes para as menos urgentes. Filtra por responsável e situação.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        produto: productProp,
        responsavel: assigneeProp,
        situacao: { type: 'string', enum: ['todas', 'vencidas', 'hoje', 'ate_hoje'], description: 'Padrão: todas' },
        limite: { type: 'integer', minimum: 1, maximum: 50, description: 'Padrão: 20' },
      },
    },
    async run(args, { store, now }) {
      const today = localToday(now);
      const product = productArg(args);
      const owner = args.responsavel === undefined ? null : oneOf(args, 'responsavel', ASSIGNEES);
      const filter = oneOf(args, 'situacao', ['todas', 'vencidas', 'hoje', 'ate_hoje'] as const, 'todas');
      const limit = args.limite === undefined ? 20 : Number(args.limite);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new InvalidArgs('limite deve ser um inteiro entre 1 e 50');
      const tasks = (await store.pendingTasks()).filter((t) => (!product || productKey(t.contact_product) === product) && (!owner || t.assigned_to === owner) && (
        filter === 'todas' || (filter === 'vencidas' && !!t.due_date && t.due_date < today)
        || (filter === 'hoje' && t.due_date === today) || (filter === 'ate_hoje' && !!t.due_date && t.due_date <= today)));
      return { produto: product, consultado_em: now.toISOString(), total: tasks.length, tarefas: tasks.sort(byUrgency).slice(0, limit).map((t) => taskView(t, today)) };
    },
  },
  {
    name: 'crm_funil_emails', scope: 'leitura', readOnly: true, title: 'Funil de e-mails',
    description: 'Totais dos e-mails enviados registrados no CRM no período: enviados, entregues, abertos, cliques, respostas, falhas e descadastros, com taxas, por categoria e por origem. Filtra por produto e categoria. Sem endereços, assuntos ou conteúdo.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        produto: productProp,
        dias: { type: 'integer', minimum: 1, maximum: 365, description: 'Janela em dias até agora. Padrão: 30' },
        categoria: { type: 'string', enum: EMAIL_CATEGORIES },
      },
    },
    async run(args, { store, now }) {
      const product = productArg(args);
      const days = args.dias === undefined ? 30 : Number(args.dias);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new InvalidArgs('dias deve ser um inteiro entre 1 e 365');
      const category = args.categoria === undefined ? null : oneOf(args, 'categoria', EMAIL_CATEGORIES);
      const since = new Date(now.getTime() - days * 86_400_000).toISOString();
      const rows = (await store.emailMessagesSince(since)).filter((r) => {
        const timestamp = Date.parse(r.sent_at);
        return Number.isFinite(timestamp) && timestamp >= Date.parse(since) && timestamp <= now.getTime()
          && (!product || productKey(r.product) === product) && (!category || r.category === category);
      });
      // O ledger também guarda agendamentos: existência do registro não prova envio.
      const outbound = rows.filter((r) => r.direction === 'outbound' && r.status !== 'scheduled');
      const sources = new Map<string, McpEmailRow[]>();
      for (const r of outbound) sources.set(r.source_key, [...(sources.get(r.source_key) ?? []), r]);
      return {
        consultado_em: now.toISOString(),
        produto: product, categoria: category, desde: since, dias: days,
        aguardando_entrega: outbound.filter(r => !delivered(r) && ['accepted', 'deferred', 'soft_bounced'].includes(r.status)).length,
        entregues_sem_resposta: outbound.filter(r => delivered(r) && !replied(r)).length,
        agendados_na_janela: rows.filter(r => r.direction === 'outbound' && r.status === 'scheduled').length,
        ultima_mensagem_em: rows.length ? new Date(Math.max(...rows.map(r => Date.parse(r.sent_at)))).toISOString() : null,
        total: emailFunnel(outbound),
        campanhas: new Set(outbound.map((r) => r.campaign_id).filter(Boolean)).size,
        respostas_recebidas: rows.filter((r) => r.direction === 'inbound').length,
        por_categoria: Object.fromEntries(EMAIL_CATEGORIES.flatMap((c) => {
          const list = outbound.filter((r) => r.category === c);
          return list.length ? [[c, emailFunnel(list)]] : [];
        })),
        por_origem: [...sources].sort((a, b) => b[1].length - a[1].length).slice(0, 15)
          .map(([source, list]) => ({ origem: source, categoria: list[0].category, produto: productKey(list[0].product), ...emailFunnel(list) })),
        observacao: 'Agendados e datas futuras não contam como enviados. Abertura depende de pixel e pode incluir abertura automática do provedor de e-mail; trate como sinal, não como leitura confirmada.',
      };
    },
  },
  {
    name: 'crm_buscar_contatos', scope: 'leitura', readOnly: true, title: 'Buscar contatos',
    description: 'Procura contatos por nome, empresa, e-mail ou Instagram. Devolve até 10 fichas, sem e-mail nem telefone.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['termo'], properties: { termo: { type: 'string', minLength: 2, maxLength: 80 } } },
    async run(args, { store }) {
      const term = str(args, 'termo', 2, 80, true).replace(/[,()*%\\"']/g, ' ').replace(/\s+/g, ' ').trim();
      if (term.length < 2) throw new InvalidArgs('termo deve ter ao menos 2 letras ou números');
      return { contatos: (await store.searchContacts(term, 10)).map(contactView) };
    },
  },
  {
    name: 'crm_contato', scope: 'leitura', readOnly: true, title: 'Ficha do contato',
    description: 'Etapa, produto, últimas interações, tarefas pendentes e pagamentos de um contato.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['contato_id'], properties: { contato_id: { type: 'string', format: 'uuid' } } },
    async run(args, { store, now }) {
      const id = uuid(args, 'contato_id', true)!;
      const contact = await store.contact(id);
      if (!contact) throw new InvalidArgs('contato não encontrado');
      const today = localToday(now);
      const [activities, tasks, payments] = await Promise.all([store.contactActivities(id, 8), store.pendingTasks(), store.contactPayments(id)]);
      return {
        contato: contactView(contact),
        interacoes: activities.map((a) => ({ tipo: a.type, canal: a.channel, resumo: a.content && a.content.length > 400 ? `${a.content.slice(0, 400)}…` : a.content, em: a.created_at })),
        tarefas_pendentes: tasks.filter((t) => t.contact_id === id).sort(byUrgency).map((t) => taskView(t, today)),
        pagamentos: { quantidade: payments.length, receita_liquida: paymentRevenue(payments) },
      };
    },
  },
  {
    name: 'crm_criar_tarefa', scope: 'tarefas', readOnly: false, title: 'Criar tarefa no CRM',
    description: 'Cria uma tarefa com responsável (maia, leo, antonio ou tecnico). Para enviar um e-mail a um contato, crie a tarefa para o Léo com o contato e o que deve ser enviado. Atribuir não garante que o responsável recebeu.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['titulo', 'responsavel'],
      properties: {
        titulo: { type: 'string', minLength: 3, maxLength: 200 },
        descricao: { type: 'string', maxLength: 2000 },
        responsavel: assigneeProp,
        prazo: { type: 'string', format: 'date', description: 'AAAA-MM-DD' },
        prioridade: { type: 'string', enum: PRIORITIES, description: 'Padrão: Média' },
        contato_id: { type: 'string', format: 'uuid' },
      },
    },
    async run(args, { store, caller, now }) {
      const title = clean(str(args, 'titulo', 3, 200, true), 'titulo')!;
      const body = clean(str(args, 'descricao', 1, 2000), 'descricao');
      const contactId = uuid(args, 'contato_id', false);
      if (contactId && !(await store.contact(contactId))) throw new InvalidArgs('contato não encontrado');
      const task = await store.insertTask({
        title, description: [body, `Criada por ${caller.name}.`].filter(Boolean).join('\n\n'), due_date: date(args, 'prazo'),
        priority: oneOf(args, 'prioridade', PRIORITIES, 'Média'), assigned_to: oneOf(args, 'responsavel', ASSIGNEES), contact_id: contactId,
      });
      return { criada: taskView(task, localToday(now)) };
    },
  },
  {
    name: 'crm_concluir_tarefa', scope: 'tarefas', readOnly: false, title: 'Concluir tarefa no CRM',
    description: 'Conclui uma tarefa pendente e registra o motivo na linha do tempo. Use também para tarefa cancelada ou substituída.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['tarefa_id', 'motivo'],
      properties: { tarefa_id: { type: 'string', format: 'uuid' }, motivo: { type: 'string', minLength: 3, maxLength: 500 } },
    },
    async run(args, { store, caller }) {
      const id = uuid(args, 'tarefa_id', true)!;
      const reason = clean(str(args, 'motivo', 3, 500, true), 'motivo')!;
      const task = await store.task(id);
      if (!task) throw new InvalidArgs('tarefa não encontrada');
      if (task.status !== 'pending') return { ja_concluida: true, tarefa: task.title };
      await store.completeTask(id);
      try {
        await store.insertActivity({ contact_id: task.contact_id, type: 'task', channel: 'sistema', content: `Tarefa concluída: ${task.title}. Motivo: ${reason} (por ${caller.name})` });
      } catch {
        throw new InvalidArgs(`a tarefa foi concluída, mas o motivo não foi gravado; registre-o com crm_registrar_atividade${task.contact_id ? ` no contato ${task.contact_id}` : ''}`);
      }
      return { concluida: task.title };
    },
  },
  {
    name: 'crm_registrar_atividade', scope: 'atividades', readOnly: false, title: 'Registrar interação',
    description: 'Registra na linha do tempo de um contato uma interação que já aconteceu (nota, follow-up, suporte ou reunião). Não muda a etapa do funil.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['contato_id', 'tipo', 'resumo'],
      properties: {
        contato_id: { type: 'string', format: 'uuid' },
        tipo: { type: 'string', enum: ACTIVITY_TYPES },
        canal: { type: 'string', enum: ACTIVITY_CHANNELS },
        resumo: { type: 'string', minLength: 3, maxLength: 2000 },
      },
    },
    async run(args, { store, caller }) {
      const contactId = uuid(args, 'contato_id', true)!;
      const type = oneOf(args, 'tipo', ACTIVITY_TYPES);
      const channel = args.canal === undefined ? null : oneOf(args, 'canal', ACTIVITY_CHANNELS);
      const summary = clean(str(args, 'resumo', 3, 2000, true), 'resumo')!;
      if (!(await store.contact(contactId))) throw new InvalidArgs('contato não encontrado');
      await store.insertActivity({ contact_id: contactId, type, channel, content: `${summary}\n\n(registrado por ${caller.name})` });
      return { registrada: true };
    },
  },
];

// ---- JSON-RPC ---------------------------------------------------------------

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const rpcResult = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const rpcError = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const json = (status: number, body: unknown, extra?: Record<string, string>) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

const INSTRUCTIONS = 'CRM da AG LABS. contacts é a ficha única e a posição no funil; activities é o que aconteceu; tasks é o que falta fazer, com responsável. '
  + 'Procure o contato antes de criar tarefa ou interação. E-mail para um contato é enviado pelo Léo: crie a tarefa para leo com o contato e o conteúdo. '
  + 'Não há exclusão, exportação nem mudança de etapa por aqui.';

export async function dispatch(message: RpcRequest, ctx: { store: CrmStore; caller: McpCaller; now?: Date }) {
  const { id, method } = message;
  const tools = TOOLS.filter((t) => ctx.caller.scopes.includes(t.scope));
  switch (method) {
    case 'initialize': {
      const asked = String(message.params?.protocolVersion ?? '');
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'crm-ag-labs', title: 'CRM AG LABS', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping': return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: tools.map((t) => ({
        name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
        annotations: { readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: t.openWorld ?? false },
      })) });
    case 'tools/call': {
      const name = message.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, TOOLS.some((t) => t.name === name) ? 'Ferramenta fora dos escopos deste token' : 'Ferramenta desconhecida');
      const args = message.params?.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'arguments deve ser um objeto');
      try {
        const data = await tool.run(args as Args, { store: ctx.store, caller: ctx.caller, now: ctx.now ?? new Date() });
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false });
      } catch (error) {
        // Erro de validação volta para o agente corrigir; falha do banco não expõe detalhes.
        const text = error instanceof InvalidArgs ? error.message : 'CRM indisponível no momento';
        if (!(error instanceof InvalidArgs)) console.error('crm-mcp', tool.name, (error as Error)?.message);
        return rpcResult(id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, 'Método não suportado');
  }
}

export type McpConfig = { tokens: TokenEntry[] };
export function mcpConfig(): McpConfig {
  return { tokens: parseMcpTokens(process.env.CRM_MCP_TOKENS) };
}

export async function handleMcp(request: Request, deps: { config: McpConfig; store: () => CrmStore | null; now?: Date }) {
  if (request.method !== 'POST') return json(405, rpcError(null, -32000, 'Use POST'), { Allow: 'POST' });
  if (!deps.config.tokens.length) return json(503, rpcError(null, -32000, 'MCP desativado'));
  const caller = authenticate(request.headers.get('authorization'), deps.config.tokens);
  if (!caller) return json(401, rpcError(null, -32001, 'Não autorizado'), { 'WWW-Authenticate': 'Bearer' });
  let body: unknown;
  try { body = await readLimitedJson(request); } catch (error) {
    const code = (error as Error).message;
    return json(code === '413' ? 413 : code === '415' ? 415 : 400, rpcError(null, -32700, 'JSON inválido'));
  }
  const store = deps.store();
  if (!store) return json(503, rpcError(null, -32000, 'CRM indisponível'));
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcRequest[];
  if (!messages.length || messages.length > 20 || messages.some((m) => !m || typeof m !== 'object' || typeof m.method !== 'string')) {
    return json(400, rpcError(null, -32600, 'Requisição inválida'));
  }
  // Notificações (sem id) não têm resposta.
  const replies = await Promise.all(messages.filter((m) => m.id !== undefined && m.id !== null).map((m) => dispatch(m, { store, caller, now: deps.now })));
  if (!replies.length) return new Response(null, { status: 202 });
  return json(200, batch ? replies : replies[0]);
}
