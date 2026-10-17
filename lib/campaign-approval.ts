export type CampaignApprovalRecipient = {
  recipient_id: string;
  email: string;
  name: string | null;
  subject: string;
  content: string;
  reason: string | null;
};

export type CampaignApprovalReview = {
  fingerprint: string;
  campaign_id: string;
  subject: string;
  sender_email: string;
  reply_to: string | null;
  product: string;
  recipients: CampaignApprovalRecipient[];
};

export type CampaignApprovalBatch = {
  id: string;
  state: 'approved' | 'paused' | 'cancelled';
  approved_at: string;
  approval_note: string;
  sender_email: string;
  reply_to: string | null;
  subject: string;
  recipients: (CampaignApprovalRecipient & { provider_message_id: string | null })[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid approval data');
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid approval data');
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function recipient(value: unknown): CampaignApprovalRecipient {
  const row = record(value);
  return {
    recipient_id: text(row.recipient_id), email: text(row.email), name: nullableText(row.name),
    subject: text(row.subject), content: text(row.content), reason: nullableText(row.reason),
  };
}

// Malformed or failed RPC responses must never look like an empty, successful queue.
export function readCampaignApprovalReview(value: unknown, campaignId: string): CampaignApprovalReview {
  const row = record(value);
  if (row.campaign_id !== campaignId || !Array.isArray(row.recipients)) throw new Error('Invalid approval review');
  const fingerprint = text(row.fingerprint);
  if (!fingerprint) throw new Error('Invalid approval review');
  return {
    fingerprint, campaign_id: campaignId, subject: text(row.subject), sender_email: text(row.sender_email),
    reply_to: nullableText(row.reply_to), product: text(row.product), recipients: row.recipients.map(recipient),
  };
}

export function readCampaignApprovalBatches(value: unknown): CampaignApprovalBatch[] {
  if (!Array.isArray(value)) throw new Error('Invalid approval overview');
  return value.map((entry) => {
    const row = record(entry);
    if (!['approved', 'paused', 'cancelled'].includes(String(row.state)) || !Array.isArray(row.recipients)) {
      throw new Error('Invalid approval overview');
    }
    return {
      id: text(row.id), state: row.state as CampaignApprovalBatch['state'],
      approved_at: text(row.approved_at), approval_note: text(row.approval_note),
      sender_email: text(row.sender_email), reply_to: nullableText(row.reply_to), subject: text(row.subject),
      recipients: row.recipients.map((entry) => ({ ...recipient(entry), provider_message_id: nullableText(record(entry).provider_message_id) })),
    };
  });
}

export function campaignBatchStateLabel(state: CampaignApprovalBatch['state']): string {
  return { approved: 'Aprovada para execução externa', paused: 'Pausada', cancelled: 'Cancelada' }[state];
}
