/** Display labels only; the stored product key remains stable for integrations. */
const labels: Record<string, string> = {
  localsite: 'Desenvolvimento web',
  'local-site': 'Desenvolvimento web',
  desenvolvimento_web: 'Desenvolvimento web',
  'desenvolvimento-web': 'Desenvolvimento web',
  'desenvolvimento web': 'Desenvolvimento web',
  barberias: 'Barberias',
  barberpro: 'Barberias',
  aglabs: 'AG LABS institucional',
  'aglabs-app': 'AG LABS App',
  mecard: 'MeCard',
  members: 'Members',
  vibekit: 'VibeKit',
  atendente_ia: 'Atendente de IA',
  'sem produto': 'Produto a definir',
};

export function productLabel(product: string): string {
  return labels[product.trim().toLowerCase()] ?? product;
}
