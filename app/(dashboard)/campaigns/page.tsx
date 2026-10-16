'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MailPlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { AudienceBasis, EmailCampaign, EmailProvider } from '@/lib/email-campaign';
import { Badge, Button, Card, Field, Input, Modal, PageLoader, Select } from '@/components/ui';

const emptyDraft = {
  name: '', product: 'Barberias', provider: 'brevo' as EmailProvider,
  sender_email: '', subject: '', audience_basis: 'individual_review' as AudienceBasis,
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  const refresh = async () => {
    const { data, error } = await supabase.from('email_campaigns').select('*')
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    setCampaigns((data ?? []) as EmailCampaign[]);
    setLoadError(false);
  };

  useEffect(() => {
    refresh().catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const createDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error('Sessão não autenticada');
      const { error } = await supabase.from('email_campaigns').insert({
        user_id: auth.user.id,
        name: draft.name.trim(), product: draft.product.trim(),
        provider: draft.provider, sender_email: draft.sender_email.trim().toLowerCase(),
        subject: draft.subject.trim(), audience_basis: draft.audience_basis,
      });
      if (error) throw error;
      setOpen(false);
      setDraft(emptyDraft);
      await refresh();
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
          <h1 className="text-2xl font-bold text-fg">Campanhas de e-mail</h1>
          <p className="mt-1 text-sm text-muted">Planejamento e observabilidade por contato, sem misturar envios ao funil comercial.</p>
        </div>
        {!loadError && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova campanha</Button>}
      </div>

      {loading ? <PageLoader /> : loadError ? (
        <Card className="p-10 text-center">
          <h2 className="font-semibold text-fg">Campanhas indisponíveis</h2>
          <p className="mt-1 text-sm text-muted">Não foi possível consultar o módulo. Verifique a conexão e a migração do banco antes de criar uma campanha.</p>
          <Button className="mt-4" onClick={() => { setLoading(true); refresh().catch(() => setLoadError(true)).finally(() => setLoading(false)); }}>Tentar novamente</Button>
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
                  <p className="mt-1 text-sm text-muted">{campaign.product} · {campaign.provider.toUpperCase()} · {campaign.sender_email}</p>
                  <p className="mt-1 text-xs text-muted">{campaign.subject}</p>
                </div>
                <Badge tone={campaign.status === 'draft' ? 'gray' : 'indigo'}>{campaign.status === 'draft' ? 'Rascunho' : campaign.status}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}

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
