export type EmailProvider = 'brevo' | 'resend';
export type AudienceBasis = 'opt_in' | 'individual_review';
export type EmailEventType =
  | 'sent' | 'delivered' | 'opened' | 'clicked' | 'replied'
  | 'bounced' | 'complained' | 'unsubscribed';

export type EmailCampaign = {
  id: string;
  user_id: string;
  name: string;
  product: string;
  provider: EmailProvider;
  sender_email: string;
  subject: string;
  content_text?: string;
  reply_to?: string | null;
  audience_basis: AudienceBasis;
  status: 'draft' | 'active' | 'completed' | 'paused';
  provider_campaign_id: string | null;
  created_at: string;
};

export type EmailCampaignEvent = {
  id: string;
  recipient_id: string;
  event_type: EmailEventType;
  occurred_at: string;
};

export type EmailCampaignRecipient = {
  id: string;
  campaign_id: string;
  contact_id: string;
  email_snapshot: string;
  review_note: string;
  provider_message_id: string | null;
  added_at: string;
};

export type EmailCampaignMetrics = Record<EmailEventType, number> & {
  recipients: number;
  pending: number;
};

/** Unique recipients per event type, not webhook count (providers can replay events). */
export function campaignMetrics(
  recipients: EmailCampaignRecipient[], events: EmailCampaignEvent[],
): EmailCampaignMetrics {
  const recipientIds = new Set(recipients.map((recipient) => recipient.id));
  const byType = new Map<EmailEventType, Set<string>>();
  const withEvents = new Set<string>();
  for (const event of events) {
    if (!recipientIds.has(event.recipient_id)) continue;
    withEvents.add(event.recipient_id);
    const seen = byType.get(event.event_type) ?? new Set<string>();
    seen.add(event.recipient_id);
    byType.set(event.event_type, seen);
  }
  const count = (type: EmailEventType) => byType.get(type)?.size ?? 0;
  return {
    recipients: recipients.length,
    pending: recipients.length - withEvents.size,
    sent: count('sent'),
    delivered: count('delivered'),
    opened: count('opened'),
    clicked: count('clicked'),
    replied: count('replied'),
    bounced: count('bounced'),
    complained: count('complained'),
    unsubscribed: count('unsubscribed'),
  };
}
