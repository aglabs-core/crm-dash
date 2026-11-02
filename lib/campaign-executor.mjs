/** Dormant executor: rpc MUST use the authenticated batch owner's session.
 * The explicit one-shot CLI remains off; no timer or production provider is installed.
 * All destination/content comes exclusively from the durable start receipt.
 */
export async function executeOne({ enabled = false, rpc, provider, itemId, step = 'initial' }) {
  if (enabled !== true) return { status: 'disabled' };
  if (!['initial', 'second'].includes(step)) throw Error('Unsupported campaign step');
  // Deterministic provider setup errors must happen before durable admission.
  provider.preflight();
  const claim = await rpc(step === 'second' ? 'claim_campaign_second_dispatch' : 'claim_campaign_dispatch', [itemId]);
  if (claim.status !== 'claimed') {
    if (step === 'second' && claim.status === 'accepted') return publishAccepted(rpc, claim);
    return claim;
  }
  // A failed/unknown start transaction must NEVER release a claim: it may have committed.
  const start = await rpc('start_campaign_dispatch', [claim.id, claim.token]);
  if (start.status !== 'dispatch_started') return start;
  let providerId = null;
  try {
    const receipt = await provider.send(start.message);
    if (receipt && typeof receipt.provider_message_id === 'string'
        && receipt.provider_message_id.trim().length > 0 && receipt.provider_message_id.length <= 500) {
      providerId = receipt.provider_message_id;
    }
  } catch {
    // Any post-start exception may follow remote acceptance. Never resend.
  }
  try {
    const finish = await rpc('finish_campaign_dispatch', [claim.id, claim.token, providerId]);
    return step === 'second' && finish.status === 'accepted' ? publishAccepted(rpc, finish) : finish;
  } catch {
    // Receipt persistence can fail after commit. Preserve the durable fence;
    // next admission quarantines an expired dispatch, never repeats HTTP.
    return { status: 'uncertain', id: claim.id };
  }
}

/** One-shot bounded runner for an existing external cron/job mechanism.
 * No timer is installed. Reconciliation does not require a send provider.
 */
export async function runSecondBatch({ enabled = false, reconcile = false, rpc, provider, limit }) {
  if (enabled !== true && reconcile !== true) return { status: 'disabled' };
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw Error('Explicit batch bound required');
  if (!reconcile) provider.preflight();
  const rows = await rpc('list_campaign_second_work', [reconcile ? 'reconcile' : 'send', limit]);
  if (!Array.isArray(rows) || rows.length > limit) throw Error('Invalid work receipt');
  const results = [];
  for (const row of rows) {
    if (reconcile) {
      try { results.push(await rpc('publish_campaign_second_dispatch', [row.id])); }
      catch { results.push({ status: 'pending', id: row.id }); }
    } else {
      results.push(await executeOne({ enabled: true, step: 'second', rpc, provider, itemId: row.item_id }));
    }
  }
  return { status: 'complete', results };
}

async function publishAccepted(rpc, accepted) {
  try {
    const publication = await rpc('publish_campaign_second_dispatch', [accepted.id]);
    return { ...accepted, ledger: publication.status, message_id: publication.message_id };
  } catch {
    return { ...accepted, ledger: 'pending' };
  }
}

/** Generic JSON HTTP adapter, NOT a Brevo adapter. No implicit retries.
 * Production binding/credentials/receipt mapping require separate review.
 */
export function httpProvider({ url, timeoutMs, headers = {} }) {
  return {
    preflight() {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
          || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
        throw new Error('Explicit HTTP provider configuration required');
      }
    },
    async send(message) {
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error('Provider outcome requires review');
      const body = await response.json();
      if (typeof body.messageId !== 'string' || !body.messageId.trim() || body.messageId.length > 500) {
        throw new Error('Missing provider acceptance receipt');
      }
      return { provider_message_id: body.messageId };
    },
  };
}
