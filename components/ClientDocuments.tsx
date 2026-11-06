'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { Button, Field, Input, Select } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { DOCUMENT_CATEGORIES, completeDocumentUpload, downloadDocument, inspectDocument, loadDocuments,
  type ClientDocument, type DocumentCategory, type DocumentDraft } from '@/lib/client-documents';
import { formatDate, formatCurrency } from '@/lib/format';

type PaymentOption = { id: string; amount: number; paid_at: string | null; currency: string };
export function ClientDocuments({ contactId, ownerId }: { contactId?: string; ownerId?: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ClientDocument[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ draft: DocumentDraft; file: File } | null>(null);
  const [payments, setPayments] = useState<PaymentOption[]>([]);
  const [paymentsFailed, setPaymentsFailed] = useState(false);
  const canUpload = !!contactId && !!ownerId && user?.id === ownerId;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    loadDocuments(contactId, page, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setRows(result.rows); setCount(result.count); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contactId, page, version]);

  useEffect(() => {
    const controller = new AbortController();
    setPayments([]); setPaymentsFailed(false);
    if (canUpload) (async () => {
      const result: PaymentOption[] = [];
      for (;;) {
        const { data, error } = await supabase.from('payment_transactions').select('id,amount,paid_at,currency')
          .eq('contact_id', contactId!).eq('user_id', ownerId!).order('id').range(result.length, result.length + 99).abortSignal(controller.signal);
        if (error) throw error;
        if (!data?.length) break;
        result.push(...data as PaymentOption[]);
      }
      if (!controller.signal.aborted) setPayments(result);
    })().catch(() => { if (!controller.signal.aborted) setPaymentsFailed(true); });
    return () => controller.abort();
  }, [canUpload, contactId, ownerId]);

  const persist = async (candidate: { draft: DocumentDraft; file: File }) => {
    setBusy(true); setMessage('');
    try {
      await completeDocumentUpload(candidate.draft, candidate.file);
      setPending(null); setMessage('Documento registrado. A validade fiscal não foi verificada.');
      setPage(0); setVersion((v) => v + 1);
    } catch {
      setMessage('Registro não confirmado. Tente confirmar novamente: será usado o mesmo arquivo, sem sobrescrever o original.');
    } finally { setBusy(false); }
  };
  const upload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canUpload || !user || !contactId || busy || pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get('file');
    if (!(file instanceof File)) return;
    setBusy(true); setMessage('');
    try {
      const category = values.get('category') as DocumentCategory;
      const details = await inspectDocument(file, category);
      const { data: existing, error } = await supabase.from('client_documents').select('id')
        .eq('contact_id', contactId).eq('user_id', user.id).eq('sha256', details.sha256).maybeSingle();
      if (error) throw new Error('Não foi possível conferir os documentos existentes.');
      if (existing) { setMessage('Este arquivo já está registrado para o cliente.'); setBusy(false); return; }
      const candidate = { file, draft: { ...details, id: crypto.randomUUID(), user_id: user.id, contact_id: contactId,
        payment_id: values.get('payment')?.toString() || null, title: values.get('title')!.toString().trim(),
        category, competence: values.get('competence')?.toString() || null, file_name: file.name.slice(0, 255) } };
      setPending(candidate);
      await persist(candidate);
      form.reset();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível preparar o documento.'); setBusy(false); }
  };
  return <section className="space-y-4 rounded-2xl border border-border bg-surface p-5" aria-label="Documentos do CRM">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Documentos {loading || failed ? '' : `· ${count}`}</h2><Button size="sm" variant="secondary" disabled={loading} onClick={() => setVersion((v) => v + 1)}>Atualizar documentos</Button></div>
    <p className="text-xs text-muted">Arquivos privados, até 10 MB. Originais preservados. Anexar uma nota não comprova autorização fiscal; confirme prestador, tomador e serviço antes de emitir outra.</p>
    {loading ? <p role="status" className="text-sm text-muted">Consultando documentos…</p> : failed ? <p role="alert" className="text-sm">Documentos indisponíveis. Não foi possível consultar o cadastro; tente atualizar.</p> : !rows.length ? <p className="text-sm text-muted">Nenhum documento registrado nesta página.</p> : <ul className="divide-y divide-border">{rows.map((doc) => <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{doc.title}</p><p className="text-xs text-muted">{DOCUMENT_CATEGORIES[doc.category]} · {Math.ceil(doc.size_bytes / 1024)} KB · anexado em {formatDate(doc.created_at)}{doc.competence && ` · competência informada ${formatDate(doc.competence)}`}{doc.payment_id && ' · pagamento vinculado'}</p>{!contactId && <Link href={`/contacts/${doc.contact_id}`} className="text-xs text-brand underline">Abrir cliente</Link>}</div><Button size="sm" variant="secondary" disabled={busy} onClick={async () => { setBusy(true); setMessage(''); try { await downloadDocument(doc); } catch { setMessage('Não foi possível baixar o arquivo. Verifique sua sessão e tente novamente.'); } finally { setBusy(false); } }}>Baixar original</Button></li>)}</ul>}
    {!loading && !failed && count > 25 && <div className="flex items-center justify-between"><Button size="sm" variant="ghost" disabled={!page} onClick={() => setPage((v) => v - 1)}>Anterior</Button><span className="text-xs">Página {page + 1} de {Math.ceil(count / 25)}</span><Button size="sm" variant="ghost" disabled={(page + 1) * 25 >= count} onClick={() => setPage((v) => v + 1)}>Próxima</Button></div>}
    {contactId && !canUpload && <p className="text-xs text-muted">Novos documentos podem ser anexados pelo proprietário desta ficha. A visualização administrativa de contatos não amplia o acesso aos arquivos.</p>}
    {canUpload && !pending && !failed && <form onSubmit={upload} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
      <Field label="Título" htmlFor="document-title"><Input id="document-title" name="title" required maxLength={160} disabled={busy} /></Field>
      <Field label="Tipo de documento" htmlFor="document-category"><Select id="document-category" name="category" disabled={busy}>{Object.entries(DOCUMENT_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
      <Field label="Competência (opcional)" htmlFor="document-competence" hint="Data da prestação, quando confirmada; pode ser diferente do pagamento."><Input id="document-competence" name="competence" type="date" disabled={busy} /></Field>
      <Field label="Pagamento relacionado (opcional)" htmlFor="document-payment"><Select id="document-payment" name="payment" disabled={busy || paymentsFailed}><option value="">Sem vínculo de pagamento</option>{payments.map((p) => <option key={p.id} value={p.id}>{formatDate(p.paid_at)} · {p.currency === 'BRL' ? formatCurrency(p.amount) : `${p.currency} ${p.amount}`}</option>)}</Select>{paymentsFailed && <p className="text-xs text-muted">Pagamentos indisponíveis. Atualize a página para tentar carregar os vínculos.</p>}</Field>
      <Field label="Arquivo original" htmlFor="document-file"><Input id="document-file" name="file" type="file" required accept=".pdf,.xml,.png,.jpg,.jpeg" disabled={busy} /></Field>
      <div className="flex items-end"><Button type="submit" loading={busy}>Anexar documento</Button></div>
    </form>}
    {pending && <div className="space-y-2"><p className="text-sm">Envio aguardando confirmação: {pending.draft.title}. Mantenha esta página aberta para tentar novamente.</p><Button loading={busy} onClick={() => persist(pending)}>Confirmar registro novamente</Button></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
