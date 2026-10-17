export type EmailTemplateExample = {
  id: string; subject: string; html: string; text: string;
  previewData?: Record<string, string>;
};
export type EmailTemplateCatalog = {
  sourceRepository?: string; sourceCommit?: string; rendererSha256?: string;
  sourceLabel?: string; variables?: string[];
  importedOn: string; sourceFiles: string[]; templates: EmailTemplateExample[];
};
export const EMAIL_TEMPLATE_PRODUCTS = [
  { id: 'barberias', name: 'Barberias', description: 'Teste grátis, acesso e agendamentos', count: 14 },
  { id: 'aglabs', name: 'AG LABS institucional', description: 'Pós-entrega e relacionamento', count: 1 },
] as const;
export type EmailTemplateProductId = typeof EMAIL_TEMPLATE_PRODUCTS[number]['id'];
export function templateProduct(value?: string): EmailTemplateProductId | undefined {
  const key = value?.toLowerCase().replace(/[^a-z]/g, '');
  if (key?.startsWith('barber')) return 'barberias';
  if (key?.startsWith('aglabs')) return 'aglabs';
  return undefined;
}
export const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  'teste-inicio': 'Boas-vindas ao teste', 'teste-meio': 'Acompanhamento do teste',
  'teste-ultimo-dia': 'Último dia do teste', 'teste-encerrado': 'Teste encerrado',
  'teste-configuracao-completa': 'Teste com configuração concluída',
  'convite-administrador': 'Convite para administrador', 'convite-profissional': 'Convite para profissional',
  'recuperacao-senha': 'Recuperação de senha', 'ativacao-cliente': 'Ativação de acesso',
  'agendamento-confirmado': 'Confirmação de agendamento', 'lembrete-agendamento': 'Lembrete de agendamento',
  'recorrencia-cliente': 'Recorrência · cliente', 'recorrencia-administrador': 'Recorrência · administrador',
  'solicitacao-cadastro': 'Solicitação de cadastro',
  'pos-entrega-avaliacao': 'Pós-entrega · avaliação',
};
export function templateCategory(id: string) {
  if (id === 'pos-entrega-avaliacao') return 'Relacionamento';
  if (id.startsWith('teste-')) return 'Teste grátis';
  if (/agendamento|recorrencia/.test(id)) return 'Agendamentos';
  if (id === 'solicitacao-cadastro') return 'Cadastro';
  return 'Acesso e convites';
}
// Apenas imagens da marca conhecida. O documento não executa código, formulários,
// navegações ou chamadas de rede; os dados de destinatários da prévia são fictícios.
export function previewTemplateContent(template: EmailTemplateExample, format: 'html' | 'text') {
  return template[format].replace(/\{\{([a-z_]+)\}\}/g, (token, name: string) => {
    const value = template.previewData?.[name];
    if (value === undefined) return token;
    return format === 'text' ? value : value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  });
}
export function isolatedEmailPreview(html: string) {
  const policy = "default-src 'none'; img-src https://barberias.com.br https://aglabs.ia.br; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`)
    .replace(/<a\b[^>]*>/gi, (anchor) => anchor.replace(/\s+href\s*=\s*(?:"[^"]*"|'[^']*')/gi, ''));
}
