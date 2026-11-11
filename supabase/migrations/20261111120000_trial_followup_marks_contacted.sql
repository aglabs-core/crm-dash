-- Quem se cadastra no teste do Barberias entra no funil como Lead. Depois que o teste
-- acaba, o próprio aplicativo envia a sequência de encerramento, recuperação e último
-- lembrete, mas o contato continuava em Lead: o funil mostrava como "ainda não abordado"
-- quem já tinha recebido toda a abordagem. O envio desses e-mails passa a mover o
-- contato de Lead para Contatado. Nenhuma outra etapa é tocada e o funil nunca regride.
BEGIN;

CREATE OR REPLACE FUNCTION crm_ledger_private.mark_trial_followup_contacted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.direction = 'outbound'
     AND NEW.source_key IN ('barberias.trial.encerrado', 'barberias.trial.recuperacao', 'barberias.trial.ultima-chance')
     AND NEW.status NOT IN ('scheduled', 'failed', 'bounced', 'soft_bounced', 'deferred') THEN
    UPDATE public.contacts SET status = 'Contatado'
     WHERE id = NEW.contact_id AND status = 'Lead' AND prospecting_pool IS NOT TRUE;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION crm_ledger_private.mark_trial_followup_contacted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trial_followup_contacted ON public.email_messages;
CREATE TRIGGER trg_trial_followup_contacted
  AFTER INSERT OR UPDATE OF status ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION crm_ledger_private.mark_trial_followup_contacted();

-- Contatos que já receberam a sequência antes desta regra.
UPDATE public.contacts c SET status = 'Contatado'
 WHERE c.status = 'Lead' AND c.prospecting_pool IS NOT TRUE
   AND EXISTS (
     SELECT 1 FROM public.email_messages m
      WHERE m.contact_id = c.id AND m.direction = 'outbound'
        AND m.source_key IN ('barberias.trial.encerrado', 'barberias.trial.recuperacao', 'barberias.trial.ultima-chance')
        AND m.status NOT IN ('scheduled', 'failed', 'bounced', 'soft_bounced', 'deferred'));

COMMIT;
