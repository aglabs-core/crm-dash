import { supabase } from './supabase';

export const DOCUMENT_CATEGORIES = {
  contract: 'Contrato', proposal: 'Proposta', invoice_xml: 'Nota fiscal · XML',
  invoice_pdf: 'Nota fiscal · PDF', receipt: 'Comprovante', other: 'Outro documento',
} as const;
export type DocumentCategory = keyof typeof DOCUMENT_CATEGORIES;
export type ClientDocument = {
  id: string; user_id: string; contact_id: string; payment_id: string | null;
  title: string; category: DocumentCategory; competence: string | null;
  file_name: string; extension: string; mime_type: string; size_bytes: number;
  sha256: string; object_path: string; created_at: string;
};
export type DocumentDraft = Omit<ClientDocument, 'object_path' | 'created_at'>;
export const DOCUMENT_BUCKET = 'crm-documents';
const fields = 'id,user_id,contact_id,payment_id,title,category,competence,file_name,extension,mime_type,size_bytes,sha256,object_path,created_at';

export async function inspectDocument(file: File, category: DocumentCategory) {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Escolha um arquivo de até 10 MB, com conteúdo.');
  const extension = file.name.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg');
  const types: Record<string, string> = { pdf: 'application/pdf', xml: 'application/xml', png: 'image/png', jpg: 'image/jpeg' };
  if (!extension || !types[extension]) throw new Error('Use PDF, XML, PNG ou JPEG.');
  if ((category === 'invoice_xml' && extension !== 'xml') || (category === 'invoice_pdf' && extension !== 'pdf')) throw new Error('O tipo da nota deve corresponder ao arquivo.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 512));
  const valid = extension === 'pdf' ? header.startsWith('%PDF-')
    : extension === 'png' ? [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
    : extension === 'jpg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : header.trimStart().startsWith('<') && !/<!DOCTYPE|<!ENTITY/i.test(new TextDecoder().decode(bytes));
  if (!valid) throw new Error('O conteúdo não corresponde ao formato permitido.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return { extension, mime_type: types[extension], size_bytes: file.size,
    sha256: Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join('') };
}

export async function loadDocuments(contactId: string | undefined, page: number, signal: AbortSignal, client = supabase) {
  let query = client.from('client_documents').select(fields, { count: 'exact' });
  if (contactId) query = query.eq('contact_id', contactId);
  const { data, count, error } = await query.order('created_at', { ascending: false }).order('id').range(page * 25, page * 25 + 24).abortSignal(signal);
  if (error) throw error;
  return { rows: (data ?? []) as ClientDocument[], count: count ?? 0 };
}

/** Retry the same insert after timeout, never upload another copy or delete an uncertain original. */
export async function registerDocument(draft: DocumentDraft, client = supabase) {
  const { data: existing, error: lookupError } = await client.from('client_documents').select('id').eq('user_id', draft.user_id).eq('contact_id', draft.contact_id).eq('sha256', draft.sha256).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return;
  const { error } = await client.from('client_documents').insert(draft);
  if (error) throw error;
}

export async function completeDocumentUpload(draft: DocumentDraft, file: File, client = supabase) {
  const path = `${draft.user_id}/${draft.contact_id}/${draft.id}.${draft.extension}`;
  const { error } = await client.storage.from(DOCUMENT_BUCKET).upload(path, file, { upsert: false, contentType: draft.mime_type, cacheControl: '0' });
  if (error && String(error.statusCode) !== '409') throw error;
  await registerDocument(draft, client);
}

export async function downloadDocument(doc: ClientDocument, client = supabase) {
  // Download as attachment; never render untrusted PDF/XML/HTML in the CRM origin.
  const { data, error } = await client.storage.from(DOCUMENT_BUCKET).download(doc.object_path);
  if (error || !data) throw error ?? new Error('Unavailable');
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url; link.download = doc.file_name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
