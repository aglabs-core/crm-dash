-- Generic inbound conversations were forced into Lead/Contatado, inflating
-- commercial pipeline metrics. Add a neutral contact state on the existing
-- contacts unit; qualification remains an explicit commercial action.
-- Preserve every currently valid lifecycle and all existing prospecting flags.
BEGIN;
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
UPDATE public.contacts SET status = 'Contato'
WHERE status IS NULL OR status NOT IN (
  'Contato','Lead','Contatado','Atendimento','Proposta','Pagamento','Cliente','Inativo','Arquivado'
);
ALTER TABLE public.contacts ADD CONSTRAINT contacts_status_check
CHECK (status IN ('Contato','Lead','Contatado','Atendimento','Proposta','Pagamento','Cliente','Inativo','Arquivado'));
ALTER TABLE public.contacts ALTER COLUMN status SET DEFAULT 'Contato';
COMMIT;
