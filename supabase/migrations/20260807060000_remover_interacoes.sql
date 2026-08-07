-- =============================================================================
-- Remover a tabela `interacoes`
--
-- Última estrutura remanescente da fase em que o CRM era um banco operado
-- direto por agente. Os 230 registros foram migrados para `activities` em
-- 20260806210000_consolidar_interacoes.sql, com tipo e canal preservados.
--
-- Enquanto as duas tabelas existirem, cada interação tem dois lugares
-- possíveis e a divergência volta — foi assim que o histórico acabou 73% numa
-- tabela que a aplicação nem lia (RLS ligada, zero políticas).
--
-- A migração conferiu: 313 registros em `activities` (83 + 230), zero
-- interações sem correspondente, zero órfãs.
--
-- Guarda de segurança: só remove se todo registro de `interacoes` tiver
-- correspondente em `activities`. Se algo tiver entrado depois da migração,
-- a migration falha em vez de apagar.
-- =============================================================================

DO $$
DECLARE
  sem_correspondente INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'interacoes'
  ) THEN
    RAISE NOTICE 'interacoes já não existe — nada a fazer.';
    RETURN;
  END IF;

  SELECT count(*) INTO sem_correspondente
  FROM interacoes i
  WHERE NOT EXISTS (
    SELECT 1 FROM activities a
    WHERE a.contact_id = i.contact_id AND a.created_at = i.criado_em
  );

  IF sem_correspondente > 0 THEN
    RAISE EXCEPTION
      'Abortado: % registro(s) de interacoes sem correspondente em activities. Rodar a consolidação antes.',
      sem_correspondente;
  END IF;

  DROP TABLE interacoes;
  RAISE NOTICE 'interacoes removida.';
END $$;
