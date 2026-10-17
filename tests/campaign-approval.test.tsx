import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignApproval } from '@/components/CampaignApproval';
import type { CampaignApprovalBatch, CampaignApprovalReview } from '@/lib/campaign-approval';

const api = vi.hoisted(() => ({ rpc: vi.fn(), confirm: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: api.rpc } }));
vi.mock('@/components/ConfirmDialog', () => ({ useConfirm: () => api.confirm }));
const key = '00000000-0000-4000-8000-000000000001';
const secondKey = '00000000-0000-4000-8000-000000000002';
const review: CampaignApprovalReview = {
  fingerprint: 'synthetic-fingerprint-1', campaign_id: 'synthetic-campaign', subject: 'Olá, {{nome}}',
  sender_email: 'sender@example.invalid', reply_to: null, product: 'barberias',
  recipients: [{ recipient_id: 'synthetic-recipient', email: 'recipient@example.invalid', name: 'Contato sintético',
    subject: 'Olá, Contato sintético', content: 'Mensagem final <img src=x onerror=alert(1)>', reason: null }],
};
const batch: CampaignApprovalBatch = {
  id: 'synthetic-batch', state: 'approved', approved_at: '2026-10-17T12:00:00Z', approval_note: 'Aprovação sintética',
  sender_email: review.sender_email, reply_to: review.reply_to, subject: review.subject,
  recipients: review.recipients.map((row) => ({ ...row, provider_message_id: null })),
};

beforeEach(() => {
  api.rpc.mockReset(); api.confirm.mockReset(); api.fetch.mockReset();
  api.confirm.mockResolvedValue(true);
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(key);
  vi.stubGlobal('fetch', api.fetch);
  api.rpc.mockImplementation(async (name: string) => {
    if (name === 'campaign_batch_overview') return { data: [], error: null };
    if (name === 'review_email_campaign_batch') return { data: review, error: null };
    return { data: null, error: { message: 'Unexpected operation' } };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function prepareApproval(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Revisar versão para aprovação' }));
  await user.type(await screen.findByLabelText(/^Nota da aprovação/), 'Revisei esta versão sintética');
  await user.click(screen.getByRole('checkbox', { name: 'Confirmar versão final da preparação' }));
}

describe('approved campaign preparation', () => {
  it('does not turn an unavailable overview into an empty queue or enable approval', async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
    const onLockChange = vi.fn();
    render(<CampaignApproval campaignId="synthetic-campaign" onChanged={vi.fn()} onLockChange={onLockChange} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Nenhuma versão aprovada registrada.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revisar versão para aprovação' })).toBeNull();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(onLockChange).toHaveBeenLastCalledWith(true);
  });

  it('fails closed on malformed successful responses and hides new review when the parent disallows it', async () => {
    api.rpc.mockResolvedValue({ data: { unexpected: true }, error: null });
    const user = userEvent.setup(); const onLockChange = vi.fn();
    render(<CampaignApproval campaignId="synthetic-campaign" onChanged={vi.fn()} canReview={false} onLockChange={onLockChange} />);
    await screen.findByRole('alert');
    expect(onLockChange).toHaveBeenLastCalledWith(true);
    api.rpc.mockResolvedValue({ data: [], error: null });
    await user.click(screen.getByRole('button', { name: 'Atualizar situação' }));
    expect(await screen.findByText('A revisão para aprovação está disponível apenas em rascunhos sem histórico de envio.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisar versão para aprovação' })).toBeNull();
    expect(onLockChange).toHaveBeenLastCalledWith(false);
  });

  it('freezes the reviewed fingerprint and keeps the idempotency key when approval fails or is retried', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<CampaignApproval campaignId="synthetic-campaign" onChanged={onChanged} />);
    await prepareApproval(user);
    const finalReview = screen.getByRole('region', { name: 'Revisão final para aprovação' });
    expect(within(finalReview).getByText('Assunto: Olá, Contato sintético')).toBeTruthy();
    expect(within(finalReview).getByText('Mensagem final <img src=x onerror=alert(1)>')).toBeTruthy();
    expect(finalReview.querySelector('img')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Congelar aprovação sem enviar' }));
    expect(await screen.findByText(/A aprovação não foi confirmada/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(/Versão aprovada e congelada/)).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Confirmar versão final da preparação' }));
    await user.click(screen.getByRole('button', { name: 'Congelar aprovação sem enviar' }));
    await waitFor(() => expect(api.rpc.mock.calls.filter(([name]) => name === 'approve_email_campaign_batch')).toHaveLength(2));
    const attempts = api.rpc.mock.calls.filter(([name]) => name === 'approve_email_campaign_batch');
    for (const [, args] of attempts) expect(args).toEqual({
      p_campaign_id: 'synthetic-campaign', p_fingerprint: review.fingerprint,
      p_approval_key: key, p_note: 'Revisei esta versão sintética',
    });
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('requires a new review and confirmation after the fingerprint becomes stale', async () => {
    let reviewCalls = 0;
    api.rpc.mockImplementation(async (name: string) => {
      if (name === 'campaign_batch_overview') return { data: [], error: null };
      if (name === 'review_email_campaign_batch') return { data: { ...review, fingerprint: ++reviewCalls === 1 ? 'old-version' : 'new-version' }, error: null };
      return { data: null, error: { message: 'Review changed' } };
    });
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(key).mockReturnValueOnce(secondKey);
    const user = userEvent.setup();
    render(<CampaignApproval campaignId="synthetic-campaign" onChanged={vi.fn()} />);
    await prepareApproval(user);
    await user.click(screen.getByRole('button', { name: 'Congelar aprovação sem enviar' }));
    await screen.findByText(/A aprovação não foi confirmada/);
    await user.click(screen.getByRole('button', { name: 'Revisar novamente' }));
    expect((await screen.findByLabelText(/^Nota da aprovação/) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: 'Confirmar versão final da preparação' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Congelar aprovação sem enviar' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/^Nota da aprovação/), 'Nova revisão sintética');
    await user.click(screen.getByRole('checkbox', { name: 'Confirmar versão final da preparação' }));
    await user.click(screen.getByRole('button', { name: 'Congelar aprovação sem enviar' }));
    await waitFor(() => expect(api.rpc).toHaveBeenCalledWith('approve_email_campaign_batch', expect.objectContaining({ p_fingerprint: 'new-version', p_approval_key: secondKey })));
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('shows current impediments and prevents approving a blocked recipient', async () => {
    api.rpc.mockImplementation(async (name: string) => ({
      data: name === 'campaign_batch_overview' ? [] : { ...review, recipients: [{ ...review.recipients[0], reason: 'Descadastro registrado' }] }, error: null,
    }));
    const user = userEvent.setup();
    render(<CampaignApproval campaignId="synthetic-campaign" onChanged={vi.fn()} />);
    await prepareApproval(user);
    expect(screen.getByText('Bloqueado: Descadastro registrado')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Congelar aprovação sem enviar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.rpc.mock.calls.some(([name]) => name === 'approve_email_campaign_batch')).toBe(false);
  });

  it('keeps a confirmed approval visible if the parent refresh fails and never calls a provider', async () => {
    let approved = false;
    api.rpc.mockImplementation(async (name: string) => {
      if (name === 'campaign_batch_overview') return { data: approved ? [batch] : [], error: null };
      if (name === 'review_email_campaign_batch') return { data: review, error: null };
      if (name === 'approve_email_campaign_batch') { approved = true; return { data: batch.id, error: null }; }
      return { data: null, error: null };
    });
    const user = userEvent.setup(); const onChanged = vi.fn().mockRejectedValue(new Error('Refresh failed'));
    render(<CampaignApproval campaignId="synthetic-campaign" onChanged={onChanged} />);
    await prepareApproval(user);
    await user.click(screen.getByRole('button', { name: 'Congelar aprovação sem enviar' }));
    expect(await screen.findByText('Versão aprovada e congelada. Nenhum e-mail foi enviado.')).toBeTruthy();
    expect(await screen.findByText(/A alteração foi registrada, mas a tela não atualizou/)).toBeTruthy();
    expect(screen.getByText('Aprovada para execução externa')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Congelar aprovação sem enviar' })).toBeNull();
    expect(api.rpc.mock.calls.filter(([name]) => name === 'approve_email_campaign_batch')).toHaveLength(1);
    expect(api.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Enviar/ })).toBeNull();
  });

  it('requires confirmation to pause or cancel and preserves history after cancellation', async () => {
    let state: CampaignApprovalBatch['state'] = 'approved';
    api.rpc.mockImplementation(async (name: string, args: { p_state?: CampaignApprovalBatch['state'] }) => {
      if (name === 'campaign_batch_overview') return { data: [{ ...batch, state, recipients: [{ ...batch.recipients[0], provider_message_id: 'synthetic-external-id' }] }], error: null };
      if (name === 'set_email_campaign_batch_state') { state = args.p_state!; return { data: null, error: null }; }
      return { data: review, error: null };
    });
    const onChanged = vi.fn().mockResolvedValue(undefined); const onLockChange = vi.fn(); const user = userEvent.setup();
    render(<CampaignApproval campaignId="synthetic-campaign" onChanged={onChanged} onLockChange={onLockChange} />);
    api.confirm.mockResolvedValueOnce(false);
    await user.click(await screen.findByRole('button', { name: 'Pausar aprovação' }));
    expect(onLockChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('De: sender@example.invalid')).toBeTruthy();
    expect(screen.getByText('Assunto base: Olá, {{nome}}')).toBeTruthy();
    expect(api.rpc.mock.calls.some(([name]) => name === 'set_email_campaign_batch_state')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Pausar aprovação' }));
    expect(await screen.findByText('Pausada')).toBeTruthy();
    expect(api.rpc).toHaveBeenCalledWith('set_email_campaign_batch_state', { p_batch_id: batch.id, p_state: 'paused' });
    await user.click(screen.getByRole('button', { name: 'Cancelar aprovação' }));
    expect(await screen.findByText('Cancelada')).toBeTruthy();
    expect(api.rpc).toHaveBeenCalledWith('set_email_campaign_batch_state', { p_batch_id: batch.id, p_state: 'cancelled' });
    expect(screen.getByText('Envio externo vinculado: synthetic-external-id')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisar versão para aprovação' })).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(onLockChange).toHaveBeenLastCalledWith(false);
    expect(api.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'danger', title: 'Cancelar aprovação' }));
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
