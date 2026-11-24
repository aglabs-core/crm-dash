export function mapAsaasPayment(payment, event, customer) {
  const amount = Number(payment.value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Valor Asaas inválido');
  const done = (Array.isArray(payment.refunds) ? payment.refunds : [])
    .filter((refund) => refund.status === 'DONE')
    .reduce((sum, refund) => {
      const value = Number(refund.value);
      if (!Number.isFinite(value) || value < 0) throw new Error('Estorno Asaas inválido');
      return sum + value;
    }, 0);
  if (done > amount + 0.005) throw new Error('Estorno supera o valor da cobrança');
  const refunded = payment.status === 'REFUNDED' ? amount : Math.min(done, amount);
  const status = refunded >= amount ? 'refunded' : refunded > 0 ? 'partially_refunded' : 'paid';
  if (status === 'paid' && (!['CONFIRMED', 'RECEIVED'].includes(payment.status) || ['PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED'].includes(event.event))) {
    throw new Error('Estado Asaas ainda não conciliável');
  }
  // Asaas dates have no time zone; UTC midnight would appear on the previous day in Brazil.
  const paidAt = payment.paymentDate || payment.confirmedDate;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(paidAt || '')
    ? `${paidAt}T00:00:00-03:00` : paidAt || new Date().toISOString();
  // An automatically generated Pix description does not identify the purchased service.
  const description = String(payment.description || '').trim();
  const product = /^Cobrança gerada automaticamente a partir de Pix recebido\b/i.test(description)
    ? null : description || null;
  return { gateway: 'asaas', external_id: event.external_id,
    nome: customer.name || null, email: customer.email || null,
    telefone: customer.mobilePhone || customer.phone || null, documento: customer.cpfCnpj || null,
    produto: product, valor: amount, status, refunded_amount: refunded,
    moeda: 'BRL', tipo: payment.subscription ? 'assinatura' : 'avulso',
    data: date };
}
