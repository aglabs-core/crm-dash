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
  { id: 'barberias', name: 'Barberias', description: 'Padrão visual para campanhas e acompanhamento', count: 1 },
  { id: 'aglabs', name: 'AG LABS institucional', description: 'Padrão visual para prospecção e relacionamento', count: 1 },
] as const;
export type EmailTemplateProductId = typeof EMAIL_TEMPLATE_PRODUCTS[number]['id'];
export function templateProduct(value?: string): EmailTemplateProductId | undefined {
  const key = value?.toLowerCase().replace(/[^a-z]/g, '');
  if (key?.startsWith('barber')) return 'barberias';
  if (key?.startsWith('aglabs')) return 'aglabs';
  return undefined;
}
export const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  'barberias-base': 'Modelo-base Barberias',
  'aglabs-base': 'Modelo-base AG LABS',
};
export function templateCategory(id: string) {
  return id.endsWith('-base') ? 'Padrão visual' : 'Modelo de campanha';
}
// Apenas imagens da marca conhecida. O documento não executa código, formulários,
// navegações ou chamadas de rede; os dados de destinatários da prévia são fictícios.
export function previewTemplateContent(template: EmailTemplateExample, format: 'html' | 'text') {
  let actionUrl = '';
  try {
    const url = new URL(template.previewData?.url_acao || '');
    if (['https:', 'http:'].includes(url.protocol)) actionUrl = url.href;
  } catch { /* A ação é opcional e URLs inválidas não são renderizadas. */ }
  const hasAction = !!actionUrl && !!template.previewData?.texto_acao?.trim();
  return template[format].replace(/<!-- CTA_START -->([\s\S]*?)<!-- CTA_END -->/g, (_, action: string) => hasAction ? action : '')
    .replace(/\{\{([a-z_]+)\}\}/g, (token, name: string) => {
    const value = template.previewData?.[name];
    if (value === undefined) return token;
    if (format === 'text') return value;
    const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    return ['mensagem', 'assinatura'].includes(name) ? escaped.replaceAll('\n', '<br>') : escaped;
  });
}
export function isolatedEmailPreview(html: string) {
  const policy = "default-src 'none'; img-src https://barberias.com.br https://aglabs.ia.br; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`)
    .replace(/<a\b[^>]*>/gi, (anchor) => anchor.replace(/\s+href\s*=\s*(?:"[^"]*"|'[^']*')/gi, ''));
}
