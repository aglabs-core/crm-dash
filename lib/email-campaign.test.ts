import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignMetrics, recipientEventSummary, type EmailCampaignEvent, type EmailCampaignRecipient } from './email-campaign';

test('counts unique recipients and leaves an unsent draft pending', () => {
  const recipients = ['a', 'b', 'c'].map((id) => ({ id })) as EmailCampaignRecipient[];
  const events = [
    { id: '1', recipient_id: 'a', event_type: 'sent' },
    { id: '2', recipient_id: 'a', event_type: 'delivered' },
    { id: '3', recipient_id: 'a', event_type: 'delivered' },
    { id: '4', recipient_id: 'b', event_type: 'sent' },
    { id: '5', recipient_id: 'b', event_type: 'bounced' },
    { id: '6', recipient_id: 'missing', event_type: 'opened' },
  ] as EmailCampaignEvent[];
  assert.deepEqual(campaignMetrics(recipients, events), {
    recipients: 3, pending: 1, sent: 2, delivered: 1, opened: 0,
    clicked: 0, replied: 0, bounced: 1, complained: 0, unsubscribed: 0, deferred: 0, blocked: 0, error: 0, proxy_open: 0,
  });
});

test('a provider delivery without a separate sent event is not presented as pending', () => {
  const recipients = [{ id: 'a' }] as EmailCampaignRecipient[];
  const events = [{ id: 'e', recipient_id: 'a', event_type: 'delivered' }] as EmailCampaignEvent[];
  const metrics = campaignMetrics(recipients, events);
  assert.equal(metrics.pending, 0);
  assert.equal(metrics.delivered, 1);
});

test('late engagement never hides opt-out, complaint or permanent delivery failure', () => {
  const summary = recipientEventSummary([
    { id: 'one', recipient_id: 'a', event_type: 'delivered', occurred_at: '2026-01-01T00:00:00Z' },
    { id: 'two', recipient_id: 'a', event_type: 'unsubscribed', occurred_at: '2026-01-02T00:00:00Z' },
    { id: 'three', recipient_id: 'a', event_type: 'proxy_open', occurred_at: '2026-01-03T00:00:00Z' },
    { id: 'four', recipient_id: 'a', event_type: 'bounced', provider_event_type: 'hard_bounce', occurred_at: '2026-01-04T00:00:00Z' },
  ]).get('a');
  assert.equal(summary?.unsubscribed, true);
  assert.equal(summary?.hardBounce, true);
  assert.equal(summary?.engagement?.event_type, 'proxy_open');
  assert.equal(summary?.delivery?.event_type, 'bounced');
});
