-- Administrators can open a CRM contact but could not read its private evidence.
-- Grant authenticated, registered administrators read access to indexed originals;
-- preserve owner-only uploads, immutable files, and the private bucket.
-- Qualify objects.name: contacts.name otherwise shadows the outer object path.
BEGIN;

DROP POLICY IF EXISTS documents_admin_read ON public.client_documents;
CREATE POLICY documents_admin_read ON public.client_documents
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS client_documents_storage_read ON storage.objects;
CREATE POLICY client_documents_storage_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'crm-documents'
  AND split_part(storage.objects.name, '/', 1) = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id::text = split_part(storage.objects.name, '/', 2)
      AND c.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS client_documents_storage_insert ON storage.objects;
CREATE POLICY client_documents_storage_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'crm-documents'
  AND split_part(storage.objects.name, '/', 1) = (SELECT auth.uid())::text
  AND storage.objects.name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}[.](pdf|xml|png|jpg)$'
  AND EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id::text = split_part(storage.objects.name, '/', 2)
      AND c.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS client_documents_admin_storage_read ON storage.objects;
CREATE POLICY client_documents_admin_storage_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'crm-documents'
  AND EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = (SELECT auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.client_documents d
    WHERE d.object_path = storage.objects.name
  )
);

COMMIT;
