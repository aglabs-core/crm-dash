import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CampaignFollowupReview } from '@/components/CampaignFollowupReview';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
afterEach(() => { cleanup(); rpc.mockReset(); });
it('reviews without an invented interval or any send action', async () => {
  rpc.mockResolvedValue({ data: { campaign_id: 'synthetic', mode: 'preparation_only', executor_available: false, recipients: [{ contact_id: 'c', recipient_id: 'r', reasons: ['Intervalo não definido'] }] }, error: null });
  render(<CampaignFollowupReview campaignId="synthetic" />);
  fireEvent.click(screen.getByRole('button', { name: 'Conferir impedimentos da segunda etapa' }));
  expect(await screen.findByText('Intervalo não definido')).toBeTruthy();
  expect(rpc).toHaveBeenCalledWith('review_email_campaign_followup', { p_campaign_id: 'synthetic', p_wait_hours: null });
  expect(screen.getByText(/Executor automático desativado por padrão/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Enviar|Ativar/ })).toBeNull();
});
