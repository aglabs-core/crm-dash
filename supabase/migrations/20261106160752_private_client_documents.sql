-- Client evidence was scattered outside the CRM. Store immutable metadata linked
-- to its owner/contact/payment, with originals in a separate PRIVATE bucket.
-- Existing public avatar policies are deliberately not reused or broadened.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_owner_document_key ON public.contacts(user_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_owner_document_key ON public.payment_transactions(user_id,id);
CREATE TABLE IF NOT EXISTS public.client_documents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  contact_id uuid NOT NULL,
  payment_id uuid,
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
  category text NOT NULL CHECK(category IN ('contract','proposal','invoice_xml','invoice_pdf','receipt','other')),
  competence date,
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
  extension text NOT NULL CHECK(extension IN ('pdf','xml','png','jpg')),
  mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','application/xml','image/png','image/jpeg')),
  size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  object_path text GENERATED ALWAYS AS (user_id::text || '/' || contact_id::text || '/' || id::text || '.' || extension) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_documents_contact_owner_fk FOREIGN KEY(user_id,contact_id) REFERENCES public.contacts(user_id,id),
  CONSTRAINT client_documents_payment_owner_fk FOREIGN KEY(user_id,payment_id) REFERENCES public.payment_transactions(user_id,id),
  CONSTRAINT client_documents_content_key UNIQUE(user_id,contact_id,sha256),
  CONSTRAINT client_documents_mime_check CHECK (
    (extension='pdf' AND mime_type='application/pdf') OR (extension='xml' AND mime_type='application/xml') OR
    (extension='png' AND mime_type='image/png') OR (extension='jpg' AND mime_type='image/jpeg')),
  CONSTRAINT client_documents_file_category_check CHECK (
    (category='invoice_xml' AND extension='xml') OR (category='invoice_pdf' AND extension='pdf') OR category NOT IN ('invoice_xml','invoice_pdf'))
);
CREATE INDEX IF NOT EXISTS client_documents_contact_date ON public.client_documents(user_id,contact_id,created_at DESC,id);
ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.client_documents TO authenticated;
GRANT SELECT, INSERT ON public.client_documents TO service_role;
DROP POLICY IF EXISTS documents_owner_read ON public.client_documents;
CREATE POLICY documents_owner_read ON public.client_documents FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS documents_owner_insert ON public.client_documents;
CREATE POLICY documents_owner_insert ON public.client_documents FOR INSERT TO authenticated WITH CHECK(user_id=(SELECT auth.uid()));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('crm-documents','crm-documents',false,10485760,ARRAY['application/pdf','application/xml','image/png','image/jpeg'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

DROP POLICY IF EXISTS client_documents_storage_read ON storage.objects;
CREATE POLICY client_documents_storage_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='crm-documents' AND split_part(name,'/',1)=(SELECT auth.uid())::text AND EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id::text=split_part(name,'/',2) AND c.user_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS client_documents_storage_insert ON storage.objects;
CREATE POLICY client_documents_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='crm-documents' AND split_part(name,'/',1)=(SELECT auth.uid())::text
  AND name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|xml|png|jpg)$'
  AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id::text=split_part(name,'/',2) AND c.user_id=(SELECT auth.uid())));
-- No UPDATE/DELETE policy: originals cannot be overwritten or deleted by clients.

CREATE OR REPLACE FUNCTION public.check_client_document_original() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE expected_path text;
BEGIN
  NEW.created_at := now();
  expected_path := NEW.user_id::text || '/' || NEW.contact_id::text || '/' || NEW.id::text || '.' || NEW.extension;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='crm-documents' AND o.name=expected_path
    AND o.metadata->>'mimetype'=NEW.mime_type AND (o.metadata->>'size')::bigint=NEW.size_bytes) THEN
    RAISE EXCEPTION 'Original unavailable or incompatible';
  END IF;
  IF NEW.payment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.payment_transactions p WHERE p.id=NEW.payment_id AND p.user_id=NEW.user_id AND p.contact_id=NEW.contact_id
  ) THEN RAISE EXCEPTION 'Payment does not belong to this contact'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_client_document_original() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS check_client_document_original ON public.client_documents;
CREATE TRIGGER check_client_document_original BEFORE INSERT ON public.client_documents
FOR EACH ROW EXECUTE FUNCTION public.check_client_document_original();
COMMENT ON TABLE public.client_documents IS 'Private evidence only. Upload does not establish fiscal authorization, correctness, competence or tax compliance. Originals are immutable.';
COMMIT;
