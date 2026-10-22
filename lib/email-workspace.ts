import type { EmailMessageCategory } from './email-ledger';

export type EmailWorkspace = 'sistema' | 'prospeccao' | 'campanhas';
export const EMAIL_WORKSPACES: { id: EmailWorkspace; label: string; categories: EmailMessageCategory[] }[] = [
  { id: 'sistema', label: 'Sistema · testes e recuperação', categories: ['automacao', 'transacional'] },
  { id: 'prospeccao', label: 'Prospecção', categories: ['prospeccao'] },
  { id: 'campanhas', label: 'Campanhas', categories: ['campanha'] },
];
export const EMAIL_PAGE_SIZE = 15;
/** Explicit keys only: don't merge distinct products by a guessed name. */
export function workspaceProducts(rows: { product: string | null }[]) {
  return [...new Set(['barberias', 'aglabs', ...rows.map((r) => r.product).filter((p): p is string => !!p)])];
}
