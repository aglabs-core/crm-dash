/** Dormant executor: rpc MUST use the authenticated batch owner's session.
 * No scheduler, environment reader, route or production provider is installed.
 * All destination/content comes exclusively from the durable start receipt.
 */
export async function executeOne({ enabled = false, rpc, provider, itemId }) {
  if (enabled !== true) return { status: 'disabled' };
  // Deterministic provider setup errors must happen before durable admission.
  provider.preflight();
  const claim = await rpc('claim_campaign_dispatch', [itemId]);
  if (claim.status !== 'claimed') return claim;
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
    return await rpc('finish_campaign_dispatch', [claim.id, claim.token, providerId]);
  } catch {
    // Receipt persistence can fail after commit. Preserve the durable fence;
    // next admission quarantines an expired dispatch, never repeats HTTP.
    return { status: 'uncertain', id: claim.id };
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
