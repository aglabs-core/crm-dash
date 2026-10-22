'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MailPlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { AudienceBasis, EmailCampaign, EmailProvider } from '@/lib/email-campaign';
import { Badge, Button, Card, Field, Input, Modal, PageLoader, Select } from '@/components/ui';
import { CampaignNavigation } from '@/components/CampaignNavigation';
import { EmailSourceOverview } from '@/components/EmailSourceOverview';
import { EMAIL_PAGE_SIZE, EMAIL_WORKSPACES, workspaceProducts, type EmailWorkspace } from '@/lib/email-workspace';
import { productLabel } from '@/lib/product-label';

const emptyDraft = {
  name: '', product: 'barberias', provider: 'brevo' as EmailProvider,
  sender_email: '', subject: '', audience_basis: 'individual_review' as AudienceBasis,
};

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [product, setProduct] = useState('barberias');
  const [workspace, setWorkspace] = useState<EmailWorkspace>('sistema');
  const [products, setProducts] = useState(workspaceProducts([]));
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    supabase.from('email_workspace_products').select('product').order('product').abortSignal(controller.signal)
      .then(({ data, error }) => { if (!controller.signal.aborted && !error) setProducts(workspaceProducts(data ?? [])); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (workspace !== 'campanhas') { setLoading(false); setLoadError(false); return; }
    const controller = new AbortController();
    setLoading(true); setLoadError(false);
    let query = supabase.from('email_campaigns').select('id,name,product,provider,sender_email,subject,status,created_at');
    query = product === '__undefined__' ? query.is('product', null) : query.eq('product', product);
    query.order('created_at', { ascending: false }).order('id')
      .range(page * EMAIL_PAGE_SIZE, (page + 1) * EMAIL_PAGE_SIZE).abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (error) setLoadError(true);
        else { setCampaigns((data ?? []).slice(0, EMAIL_PAGE_SIZE) as EmailCampaign[]); setHasNext((data?.length ?? 0) > EMAIL_PAGE_SIZE); }
        setLoading(false);
      });
    return () => controller.abort();
  }, [product, workspace, page, revision]);

  const createDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error('Sessão não autenticada');
      const { data: created, error } = await supabase.from('email_campaigns').insert({
        user_id: auth.user.id,
        name: draft.name.trim(), product: draft.product.trim(),
        provider: draft.provider, sender_email: draft.sender_email.trim().toLowerCase(),
        subject: draft.subject.trim(), audience_basis: draft.audience_basis,
      }).select('id').single();
      if (error) throw error;
      setOpen(false);
      setDraft(emptyDraft);
      router.push(`/campaigns/${created.id}`);
      toast.success('Rascunho criado. Nenhum e-mail foi enviado.');
    } catch {
      toast.error('Não foi possível criar o rascunho.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg">E-mails por produto</h1>
          <p className="mt-1 text-sm text-muted">Acompanhe o sistema, a prospecção e as campanhas de cada produto.</p>
        </div>
        {!loadError && <Button onClick={() => { setDraft({ ...emptyDraft, product: product === '__undefined__' ? 'barberias' : product }); setOpen(true); }}><Plus className="h-4 w-4" /> Nova campanha</Button>}
      </div>

      <CampaignNavigation active="campaigns" />
      <Card className="space-y-4 p-4">
        <Field label="Produto em acompanhamento" htmlFor="email-workspace-product">
          <Select id="email-workspace-product" value={product} onChange={(e) => { setProduct(e.target.value); setPage(0); }}>
            {products.map((key) => <option key={key} value={key}>{productLabel(key)}</option>)}
            <option value="__undefined__">Produto a definir</option>
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2" aria-label="Grupos de e-mail">
          {EMAIL_WORKSPACES.map((group) => <Button key={group.id} variant={workspace === group.id ? 'primary' : 'secondary'}
            aria-pressed={workspace === group.id} onClick={() => { setWorkspace(group.id); setPage(0); }}>{group.label}</Button>)}
        </div>
      </Card>
      <EmailSourceOverview key={`${product}:${workspace}`} product={product} workspace={workspace} />
      {workspace !== 'campanhas' ? null : loading ? <PageLoader /> : loadError ? (
        <Card className="p-10 text-center">
          <h2 className="font-semibold text-fg">Campanhas indisponíveis</h2>
          <p className="mt-1 text-sm text-muted">Não foi possível consultar o módulo. Verifique a conexão e a migração do banco antes de criar uma campanha.</p>
          <Button className="mt-4" onClick={() => setRevision((n) => n + 1)}>Tentar novamente</Button>
        </Card>
      ) : campaigns.length === 0 ? (
        <Card className="p-10 text-center">
          <MailPlus className="mx-auto mb-3 h-9 w-9 text-muted" />
          <h2 className="font-semibold text-fg">Nenhuma campanha registrada</h2>
          <p className="mt-1 text-sm text-muted">Crie um rascunho para revisar a audiência e acompanhar os eventos do provedor.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {campaigns.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`}
              className="rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-surface-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-fg">{campaign.name}</h2>
                  <p className="mt-1 text-sm text-muted">{productLabel(campaign.product)} · {campaign.provider.toUpperCase()} · {campaign.sender_email}</p>
                  <p className="mt-1 text-xs text-muted">{campaign.subject}</p>
                </div>
                <Badge tone={campaign.status === 'draft' ? 'gray' : 'indigo'}>{campaign.status === 'draft' ? 'Rascunho' : campaign.status}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
      {workspace === 'campanhas' && !loading && !loadError && <div className="flex items-center justify-between text-sm">
        <span className="text-muted">Página {page + 1} · rascunhos e campanhas deste produto</span>
        <div className="flex gap-2"><Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <Button variant="secondary" disabled={!hasNext} onClick={() => setPage(page + 1)}>Próxima</Button></div>
      </div>}

      <Modal open={open} onClose={() => setOpen(false)} title="Nova campanha">
        <form onSubmit={createDraft} className="space-y-4">
          <Field label="Nome interno" htmlFor="campaign-name" required>
            <Input id="campaign-name" required maxLength={160} value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Produto" htmlFor="campaign-product" required>
            <Input id="campaign-product" required maxLength={120} value={draft.product}
              onChange={(e) => setDraft({ ...draft, product: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provedor" htmlFor="campaign-provider">
              <Select id="campaign-provider" value={draft.provider}
                onChange={(e) => setDraft({ ...draft, provider: e.target.value as EmailProvider,
                  audience_basis: e.target.value === 'resend' ? 'opt_in' : draft.audience_basis })}>
                <option value="brevo">Brevo</option><option value="resend">Resend</option>
              </Select>
            </Field>
            <Field label="Base de contato" htmlFor="campaign-basis" hint="Resend: somente contatos com permissão documentada.">
              <Select id="campaign-basis" value={draft.audience_basis} disabled={draft.provider === 'resend'}
                onChange={(e) => setDraft({ ...draft, audience_basis: e.target.value as AudienceBasis })}>
                <option value="opt_in">Opt-in documentado</option>
                <option value="individual_review">Abordagem individual revisada</option>
              </Select>
            </Field>
          </div>
          <Field label="Remetente" htmlFor="campaign-sender" required hint="Use um endereço verificado no provedor escolhido.">
            <Input id="campaign-sender" type="email" required maxLength={320} value={draft.sender_email}
              onChange={(e) => setDraft({ ...draft, sender_email: e.target.value })} />
          </Field>
          <Field label="Assunto" htmlFor="campaign-subject" required>
            <Input id="campaign-subject" required maxLength={255} value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </Field>
          <p className="text-xs text-muted">Criar um rascunho não envia mensagens. Disparos exigem uma etapa separada de aprovação.</p>
          <div className="flex justify-end"><Button type="submit" loading={saving}>Criar rascunho</Button></div>
        </form>
      </Modal>
    </div>
  );
}
