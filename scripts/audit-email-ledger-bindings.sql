-- READ ONLY: aggregate binding audit. Does not select addresses/bodies or infer
-- that different owners are corruption. Run against the exact deployed schema.
WITH bindings AS (
  SELECT m.category,
    m.user_id = crm_ledger_private.tenant() AS technical_tenant,
    c.id IS NOT NULL AND crm_ledger_private.contact_owner(c.user_id)
      AND lower(btrim(c.email)) = m.address AS canonical_contact,
    m.user_id = c.user_id AS same_contact_owner,
    m.campaign_id IS NULL AS no_campaign,
    m.campaign_id IS NOT NULL AND ca.user_id = c.user_id
      AND public.campaign_product_key(ca.product) = public.campaign_product_key(m.product) AS canonical_campaign,
    m.recipient_id IS NULL AS no_recipient,
    m.recipient_id IS NOT NULL AND r.campaign_id = m.campaign_id
      AND r.user_id = c.user_id AND r.contact_id = c.id
      AND lower(btrim(r.email_snapshot)) = m.address AS canonical_recipient
  FROM public.email_messages m
  LEFT JOIN public.contacts c ON c.id=m.contact_id
  LEFT JOIN public.email_campaigns ca ON ca.id=m.campaign_id
  LEFT JOIN public.email_campaign_recipients r ON r.id=m.recipient_id
  WHERE m.direction='outbound'
)
SELECT category,count(*) messages,
  count(*) FILTER(WHERE same_contact_owner) same_contact_owner,
  count(*) FILTER(WHERE technical_tenant AND canonical_contact
    AND (no_campaign OR canonical_campaign) AND (no_recipient OR canonical_recipient)) approved_bridge_shape,
  count(*) FILTER(WHERE NOT coalesce(technical_tenant AND canonical_contact
    AND (no_campaign OR canonical_campaign) AND (no_recipient OR canonical_recipient),false)) requires_review
FROM bindings GROUP BY category ORDER BY category;
-- This is metadata reconciliation, not proof of sender consent or dispatch.
-- Do NOT update user_id: the Maia context/reply/provider RPCs select the technical
-- tenant. Historical correction requires exact immutable evidence and review.
