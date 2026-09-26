/** Display labels only; the stored product key remains stable for integrations. */
const labels: Record<string, string> = {
  localsite: 'Desenvolvimento web',
  barberias: 'Barberias',
  barberpro: 'Barberias',
  atendente_ia: 'Atendente de IA',
  'Sem produto': 'Produto a definir',
};

export function productLabel(product: string): string {
  return labels[product] ?? product;
}
