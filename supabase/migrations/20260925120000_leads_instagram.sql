-- =========================================================================
-- Leads do Instagram
--   Quem pede um material por palavra-chave (comentário ou direct) vira
--   contato no CRM, com o produto de interesse em `produto`. O n8n do VPS-01
--   recebe o webhook da Meta e chama as duas funções abaixo; nada fica
--   guardado fora do CRM.
-- =========================================================================
BEGIN;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram           TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_id        TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_oferta_em TIMESTAMPTZ;
COMMENT ON COLUMN contacts.instagram           IS '@ do Instagram, sem a arroba.';
COMMENT ON COLUMN contacts.instagram_id        IS 'ID da pessoa no Instagram (escopo da conta AG LABS). Chave do contato vindo do Instagram.';
COMMENT ON COLUMN contacts.instagram_oferta_em IS 'Quando recebeu a oferta automática no direct. Uma oferta por pessoa.';
CREATE UNIQUE INDEX IF NOT EXISTS contacts_instagram_id_key
  ON contacts (instagram_id) WHERE instagram_id IS NOT NULL;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_origin_check;
ALTER TABLE contacts ADD  CONSTRAINT contacts_origin_check
  CHECK (origin IN ('web', 'prospeccao', 'whatsapp', 'email', 'manual', 'compra', 'instagram'));

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_channel_check;
ALTER TABLE activities ADD  CONSTRAINT activities_channel_check
  CHECK (channel IS NULL OR channel IN ('whatsapp', 'email', 'telefone', 'presencial', 'sistema', 'instagram'));

-- CRM de um único dono: contatos automáticos ficam com quem já é dono da base.
CREATE OR REPLACE FUNCTION public.crm_dono_da_base()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT user_id FROM contacts GROUP BY user_id ORDER BY count(*) DESC LIMIT 1;
$$;

-- Registra (ou atualiza) o contato e a interação. Devolve o contato e se ele
-- já recebeu a oferta automática, para o direct não repetir a oferta.
CREATE OR REPLACE FUNCTION public.registrar_lead_instagram(
  p_instagram_id text,
  p_username     text,
  p_codigo       text,
  p_interesse    text,
  p_canal        text
)
RETURNS TABLE (contact_id uuid, novo boolean, oferta_ja_enviada boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner   uuid := public.crm_dono_da_base();
  v_contact uuid;
  v_oferta  timestamptz;
  v_novo    boolean := false;
  v_user    text := NULLIF(lower(ltrim(trim(coalesce(p_username, '')), '@')), '');
BEGIN
  IF p_instagram_id IS NULL OR p_instagram_id !~ '^[0-9]{5,40}$' THEN
    RAISE EXCEPTION 'instagram_id_invalido';
  END IF;
  IF p_canal NOT IN ('comentario', 'direct') THEN
    RAISE EXCEPTION 'canal_invalido';
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'crm_sem_dono';
  END IF;

  SELECT c.id, c.instagram_oferta_em INTO v_contact, v_oferta
  FROM contacts c WHERE c.instagram_id = p_instagram_id;

  IF v_contact IS NULL THEN
    INSERT INTO contacts (user_id, name, instagram, instagram_id, origin, status, produto)
    VALUES (v_owner,
            coalesce('@' || v_user, 'Instagram ' || right(p_instagram_id, 6)),
            v_user, p_instagram_id, 'instagram', 'Lead', NULLIF(trim(p_interesse), ''))
    RETURNING id INTO v_contact;
    v_novo := true;
  ELSE
    UPDATE contacts
    SET instagram  = coalesce(v_user, instagram),
        produto    = coalesce(produto, NULLIF(trim(p_interesse), '')),
        updated_at = now()
    WHERE id = v_contact;
  END IF;

  INSERT INTO activities (user_id, contact_id, type, channel, content)
  VALUES (v_owner, v_contact, 'note', 'instagram',
          format('Pediu o material %s pelo %s.', upper(coalesce(p_codigo, '?')),
                 CASE p_canal WHEN 'direct' THEN 'direct' ELSE 'comentário' END));

  RETURN QUERY SELECT v_contact, v_novo, v_oferta IS NOT NULL;
END;
$$;

-- Marca a oferta automática enviada no direct e registra na linha do tempo.
CREATE OR REPLACE FUNCTION public.marcar_oferta_instagram(p_instagram_id text, p_interesse text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_contact uuid;
  v_owner   uuid;
BEGIN
  UPDATE contacts SET instagram_oferta_em = now(), updated_at = now()
  WHERE instagram_id = p_instagram_id AND instagram_oferta_em IS NULL
  RETURNING id, user_id INTO v_contact, v_owner;
  IF v_contact IS NULL THEN RETURN; END IF;
  INSERT INTO activities (user_id, contact_id, type, channel, content)
  VALUES (v_owner, v_contact, 'disparo', 'instagram',
          format('Recebeu a oferta automática de %s no direct.', coalesce(NULLIF(trim(p_interesse), ''), 'produto')));
END;
$$;

REVOKE ALL ON FUNCTION public.crm_dono_da_base() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_lead_instagram(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marcar_oferta_instagram(text, text) FROM PUBLIC, anon, authenticated;

COMMIT;
