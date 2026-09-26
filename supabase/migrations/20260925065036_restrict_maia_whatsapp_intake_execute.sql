REVOKE ALL ON FUNCTION public.maia_whatsapp_intake(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maia_whatsapp_intake(text) TO service_role;
