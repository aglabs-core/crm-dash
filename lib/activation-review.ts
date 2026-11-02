import type { ProductSnapshot } from './product-metrics';

export type ActivationGap = { label: string; count: number; action: string };

/** Current inventory only. These gaps are not campaign conversions or lost sales. */
export function activationGaps(snapshot: ProductSnapshot): ActivationGap[] {
  const { metrics, activationFunnel: funnel, freemium, marketplace } = snapshot;
  if (snapshot.product === 'barberias' && funnel && metrics.accounts !== null) {
    const stages = [
      { label: 'Sem profissional ativo', count: metrics.accounts - funnel.professional, action: 'Revisar o cadastro do primeiro profissional.' },
      { label: 'Sem serviços cadastrados', count: funnel.professional - funnel.catalog, action: 'Revisar o cadastro do primeiro serviço.' },
      { label: 'Sem agenda disponível', count: funnel.catalog - funnel.readyForBooking, action: 'Revisar horários e disponibilidade para agendamento.' },
      { label: 'Prontas sem primeiro agendamento', count: funnel.readyForBooking - funnel.firstAppointment, action: 'Revisar a publicação e o compartilhamento do link de agendamento.' },
    ];
    return stages.filter(stage => stage.count > 0);
  }
  if (snapshot.product === 'mecard' && freemium?.publishers != null && metrics.users !== null) {
    const count = metrics.users - freemium.publishers;
    return count > 0 ? [{ label: 'Usuários sem página publicada', count, action: 'Revisar o caminho entre escolher um modelo e publicar a página.' }] : [];
  }
  if (snapshot.product === 'viajeki' && freemium?.tripCreators != null && metrics.users !== null) {
    const count = metrics.users - freemium.tripCreators;
    return count > 0 ? [{ label: 'Usuários que não criaram viagem', count, action: 'Revisar o primeiro roteiro e distinguir participantes convidados de criadores.' }] : [];
  }
  if (snapshot.product === 'members' && marketplace) {
    const count = marketplace.producers.onboarding - marketplace.producers.approved;
    return count > 0 ? [{ label: 'Cadastros de produtores sem aprovação', count, action: 'Revisar pendências de cadastro e aprovação antes de ampliar a aquisição de produtores.' }] : [];
  }
  return [];
}
