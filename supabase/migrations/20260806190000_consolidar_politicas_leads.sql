-- =============================================================================
-- leads_institucional: uma política de INSERT em vez de três
--
-- A captura pública de e-mail do site institucional acumulou três políticas de
-- INSERT equivalentes para `anon`, criadas em momentos diferentes:
--   • Permitir inserção pública
--   • anon pode inserir leads
--   • Public can submit institutional leads   (esta vem das migrations)
--
-- Nenhuma delas está errada, e o efeito somado é o correto: anônimo insere,
-- não lê. Mas três regras equivalentes é como uma divergência de permissão
-- começa — basta alguém ajustar uma e esquecer das outras.
--
-- Mantém a que veio das migrations e remove as duas criadas à mão.
-- Idempotente.
-- =============================================================================

DROP POLICY IF EXISTS "Permitir inserção pública" ON public.leads_institucional;
DROP POLICY IF EXISTS "anon pode inserir leads"   ON public.leads_institucional;

-- Garante que a política mantida existe, caso este banco não a tenha.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'leads_institucional'
      AND policyname = 'Public can submit institutional leads'
  ) THEN
    CREATE POLICY "Public can submit institutional leads"
      ON public.leads_institucional FOR INSERT TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;
