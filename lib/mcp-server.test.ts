import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, handleMcp, hasSensitiveData, parseMcpTokens, type CrmStore, type McpContact, type McpTask } from './mcp-server';
import type { PaymentTransaction } from './types';

const TOKEN = 'o'.repeat(40);
const READER = 'r'.repeat(40);
const config = { tokens: parseMcpTokens(`orbita:${TOKEN}:leitura,tarefas,atividades;leitor:${READER}:leitura`) };
const NOW = new Date('2026-10-23T15:00:00Z'); // 12h em São Paulo
const CONTACT = '11111111-1111-4111-8111-111111111111';
const T1 = '44444444-4444-4444-8444-444444444444';

function fakeStore() {
  const contact: McpContact = {
    id: CONTACT, name: 'Barbearia Sintética', company: null, status: 'Proposta', produto: 'barberias', origin: 'web', prospecting_pool: false,
    account_status: 'trial', amount: 500, expected_close_date: null, has_email: true, has_whatsapp: false, created_at: '2026-10-20T10:00:00Z', updated_at: null,
  };
  const tasks: McpTask[] = [
    { id: T1, title: 'Enviar proposta', description: null, due_date: '2026-10-22', priority: 'Alta', status: 'pending', assigned_to: 'leo', contact_id: CONTACT, contact_name: contact.name, created_at: '' },
    { id: 't2', title: 'Revisar teste', description: null, due_date: '2026-10-23', priority: 'Média', status: 'pending', assigned_to: 'antonio', contact_id: null, contact_name: null, created_at: '' },
    { id: 't3', title: 'Sem prazo', description: null, due_date: null, priority: 'Baixa', status: 'pending', assigned_to: null, contact_id: null, contact_name: null, created_at: '' },
  ];
  const payment = (net: number, paid_at: string, status: PaymentTransaction['status'] = 'paid') =>
    ({ id: paid_at, contact_id: CONTACT, gateway: 'asaas', external_id: paid_at, status, product: 'barberias', currency: 'BRL', amount: net, refunded_amount: 0, net_amount: net, paid_at }) as PaymentTransaction;
  const writes: { tasks: unknown[]; activities: { contact_id: string | null; type: string; channel: string | null; content: string }[]; completed: string[] } = { tasks: [], activities: [], completed: [] };
  const store: CrmStore = {
    funnelContacts: async () => [
      { status: 'Proposta', prospecting_pool: false, created_at: '2026-10-20T10:00:00Z' },
      { status: 'Lead', prospecting_pool: false, created_at: '2026-09-01T10:00:00Z' },
      { status: 'Cliente', prospecting_pool: false, created_at: '2026-08-01T10:00:00Z' },
      { status: 'Arquivado', prospecting_pool: true, created_at: '2026-10-21T10:00:00Z' },
    ],
    // 01/10 00:30 em São Paulo ainda é outubro; 30/09 23:00 é setembro.
    paymentsSince: async () => [payment(100, '2026-10-01T03:30:00Z'), payment(50, '2026-10-01T02:00:00Z'), payment(80, '2026-10-10T12:00:00Z', 'refunded')],
    pendingTasks: async () => tasks.map((t) => ({ ...t })),
    searchContacts: async () => [contact],
    contact: async (id) => (id === CONTACT ? contact : null),
    contactActivities: async () => [{ type: 'note', channel: 'email', content: 'x'.repeat(500), created_at: '2026-10-21T10:00:00Z' }],
    contactPayments: async () => [payment(100, '2026-10-01T03:30:00Z')],
    task: async (id) => tasks.find((t) => t.id === id) ?? null,
    insertTask: async (row) => { writes.tasks.push(row); return { id: 'new', status: 'pending', created_at: '', contact_name: null, ...row }; },
    completeTask: async (id) => { writes.completed.push(id); },
    insertActivity: async (row) => { writes.activities.push(row); },
  };
  return { store, writes };
}

function rpc(body: unknown, token = TOKEN, headers: Record<string, string> = {}) {
  return new Request('https://crm.test/api/mcp', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...headers },
  });
}
async function call(name: string, args: unknown, token = TOKEN, store = fakeStore().store) {
  const res = await handleMcp(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token), { config, store: () => store, now: NOW });
  return (await res.json()) as { result?: { isError: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] }; error?: { message: string } };
}

test('tokens: formato, tamanho mínimo e escopos conhecidos', () => {
  assert.deepEqual(parseMcpTokens(`a:${TOKEN}:leitura`), []); // nome curto demais
  assert.deepEqual(parseMcpTokens(`orbita:curto:leitura`), []);
  assert.deepEqual(parseMcpTokens(`orbita:${TOKEN}:admin`), []);
  assert.deepEqual(parseMcpTokens(`orbita:${TOKEN}:leitura,leitura,admin`)[0].scopes, ['leitura']);
  assert.equal(authenticate(`Bearer ${READER}`, config.tokens)?.name, 'leitor');
  assert.equal(authenticate(`bearer ${TOKEN}`, config.tokens)?.name, 'orbita');
  assert.equal(authenticate(`Bearer ${'x'.repeat(40)}`, config.tokens), null);
  assert.equal(authenticate(null, config.tokens), null);
});

test('protocolo: initialize, notificação, ping, método desconhecido e autenticação', async () => {
  const { store } = fakeStore();
  const deps = { config, store: () => store, now: NOW };
  const init = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }), deps)).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'crm-ag-labs');
  assert.equal((await handleMcp(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), deps)).status, 202);
  assert.deepEqual((await (await handleMcp(rpc({ jsonrpc: '2.0', id: 2, method: 'ping' }), deps)).json()).result, {});
  assert.equal((await (await handleMcp(rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' }), deps)).json()).error.code, -32601);
  assert.equal((await handleMcp(rpc({ jsonrpc: '2.0', id: 4, method: 'ping' }, 'y'.repeat(40)), deps)).status, 401);
  assert.equal((await handleMcp(new Request('https://crm.test/api/mcp'), deps)).status, 405);
  assert.equal((await handleMcp(rpc({ jsonrpc: '2.0', id: 5, method: 'ping' }), { ...deps, config: { tokens: [] } })).status, 503);
  const batch = await (await handleMcp(rpc([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]), deps)).json();
  assert.equal(batch.length, 1);
});

test('escopos: token de leitura não vê nem chama ferramentas de escrita', async () => {
  const { store } = fakeStore();
  const list = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, READER), { config, store: () => store, now: NOW })).json();
  const names = list.result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(names, ['crm_resumo', 'crm_tarefas', 'crm_buscar_contatos', 'crm_contato']);
  const denied = await call('crm_criar_tarefa', { titulo: 'Teste', responsavel: 'leo' }, READER, store);
  assert.match(denied.error!.message, /escopos/);
});

test('resumo: funil sem a base fria, receita líquida pelo mês de São Paulo e tarefas por responsável', async () => {
  const { result } = await call('crm_resumo', {});
  const data = result!.structuredContent as Record<string, any>;
  assert.equal(data.hoje, '2026-10-23');
  assert.equal(data.oportunidades_abertas, 2);
  assert.equal(data.funil.Proposta, 1);
  assert.equal(data.base_prospeccao, 1);
  assert.equal(data.novos_7d, 1);
  assert.equal(data.receita_mes, 100); // estorno integral não conta
  assert.equal(data.receita_mes_anterior, 50);
  assert.equal(data.tarefas.vencidas, 1);
  assert.equal(data.tarefas.para_hoje, 1);
  assert.equal(data.tarefas.por_responsavel.sem_responsavel, 1);
});

test('tarefas e ficha: urgência, filtros e sem dados de contato', async () => {
  const late = (await call('crm_tarefas', { situacao: 'ate_hoje' })).result!.structuredContent as any;
  assert.deepEqual(late.tarefas.map((t: { id: string }) => t.id), [T1, 't2']);
  assert.equal(late.tarefas[0].vencida, true);
  const leo = (await call('crm_tarefas', { responsavel: 'leo' })).result!.structuredContent as any;
  assert.equal(leo.total, 1);
  assert.equal((await call('crm_tarefas', { limite: 99 })).result!.isError, true);
  const ficha = (await call('crm_contato', { contato_id: CONTACT })).result!.structuredContent as any;
  assert.equal(ficha.contato.tem_email, true);
  assert.equal('email' in ficha.contato, false);
  assert.equal(ficha.interacoes[0].resumo.length, 401);
  assert.equal(ficha.tarefas_pendentes.length, 1);
  assert.equal(ficha.pagamentos.receita_liquida, 100);
  const busca = await call('crm_buscar_contatos', { termo: '%(' });
  assert.equal(busca.result!.isError, true);
});

test('escrita: cria tarefa validada, conclui com motivo e registra atividade', async () => {
  const { store, writes } = fakeStore();
  const created = await call('crm_criar_tarefa', { titulo: 'Enviar e-mail de proposta', responsavel: 'leo', contato_id: CONTACT, prazo: '2026-10-24' }, TOKEN, store);
  assert.equal(created.result!.isError, false);
  assert.deepEqual(writes.tasks[0], { title: 'Enviar e-mail de proposta', description: 'Criada por orbita.', due_date: '2026-10-24', priority: 'Média', assigned_to: 'leo', contact_id: CONTACT });
  for (const bad of [{ titulo: 'x', responsavel: 'leo' }, { titulo: 'Tarefa', responsavel: 'joao' }, { titulo: 'Tarefa', responsavel: 'leo', prazo: '24/10' },
    { titulo: 'Cobrar cartão 4111 1111 1111 1111', responsavel: 'leo' }, { titulo: 'Tarefa', responsavel: 'leo', contato_id: '22222222-2222-4222-8222-222222222222' }]) {
    assert.equal((await call('crm_criar_tarefa', bad, TOKEN, store)).result!.isError, true, JSON.stringify(bad));
  }
  assert.equal(writes.tasks.length, 1);
  assert.equal((await call('crm_concluir_tarefa', { tarefa_id: '33333333-3333-4333-8333-333333333333', motivo: 'feito' }, TOKEN, store)).result!.isError, true);
  assert.equal((await call('crm_concluir_tarefa', { tarefa_id: CONTACT }, TOKEN, store)).result!.isError, true);
  const done = await call('crm_concluir_tarefa', { tarefa_id: T1, motivo: 'Proposta enviada pelo Léo' }, TOKEN, store);
  assert.equal(done.result!.isError, false);
  assert.deepEqual(writes.completed, [T1]);
  assert.deepEqual(writes.activities[0], { contact_id: CONTACT, type: 'task', channel: 'sistema', content: 'Tarefa concluída: Enviar proposta. Motivo: Proposta enviada pelo Léo (por orbita)' });
  const activity = await call('crm_registrar_atividade', { contato_id: CONTACT, tipo: 'note', canal: 'email', resumo: 'Cliente pediu a proposta por e-mail' }, TOKEN, store);
  assert.equal(activity.result!.isError, false);
  assert.match(writes.activities[1].content, /registrado por orbita/);
  assert.equal((await call('crm_registrar_atividade', { contato_id: CONTACT, tipo: 'stage_change', resumo: 'Mudou' }, TOKEN, store)).result!.isError, true);
});

test('falha do banco não vaza detalhes', async () => {
  const { store } = fakeStore();
  store.pendingTasks = async () => { throw new Error('connection refused at 10.0.0.1'); };
  const original = console.error; console.error = () => {};
  try {
    const res = await call('crm_tarefas', {}, TOKEN, store);
    assert.equal(res.result!.isError, true);
    assert.equal(res.result!.content[0].text, 'CRM indisponível no momento');
  } finally { console.error = original; }
});

test('dados sensíveis: barra cartão válido e senha com valor, aceita falar de senha e telefone', () => {
  assert.equal(hasSensitiveData('Cobrar no cartão 4111 1111 1111 1111'), true);
  assert.equal(hasSensitiveData('senha: abc123'), true);
  assert.equal(hasSensitiveData('O token é sk_live_123'), true);
  assert.equal(hasSensitiveData('Renovar token do Instagram da Maia'), false);
  assert.equal(hasSensitiveData('Enviar link para redefinir a senha do cliente'), false);
  assert.equal(hasSensitiveData('Pedido 1234567890123 aguardando confirmação'), false);
});

test('conclusão: falha ao gravar o motivo é avisada sem esconder que a tarefa foi concluída', async () => {
  const { store, writes } = fakeStore();
  store.insertActivity = async () => { throw new Error('insert failed'); };
  const res = await call('crm_concluir_tarefa', { tarefa_id: T1, motivo: 'Proposta enviada' }, TOKEN, store);
  assert.equal(res.result!.isError, true);
  assert.match(res.result!.content[0].text, /foi concluída, mas o motivo não foi gravado/);
  assert.deepEqual(writes.completed, [T1]);
});
