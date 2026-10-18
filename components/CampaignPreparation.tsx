"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Mail, Save, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { contactName, contactMatchesSearch } from '@/lib/contact-name';
import { productLabel } from '@/lib/product-label';
import { originLabel, ORIGINS } from '@/lib/constants';
import type { Contact } from '@/lib/types';
import type { EmailCampaign, EmailCampaignRecipient } from '@/lib/email-campaign';
import { campaignAudience, inAudienceSegment, personalizePreview, MAX_CAMPAIGN_SELECTION, type AudienceSegment } from '@/lib/campaign-preparation';
import { Badge, Button, Card, Checkbox, Field, Input, Select, Textarea } from '@/components/ui';

const steps = ['Público', 'Mensagem', 'Revisão'];
export function CampaignPreparation({ campaign, contacts, recipients, onSaved }: {
  campaign: EmailCampaign; contacts: Contact[]; recipients: EmailCampaignRecipient[];
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [segment, setSegment] = useState<AudienceSegment>('prospecting');
  const [origin, setOrigin] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set<string>());
  const [subject, setSubject] = useState(campaign.subject);
  const [content, setContent] = useState(campaign.content_text || '');
  const [replyTo, setReplyTo] = useState(campaign.reply_to || '');
  const [reviewNote, setReviewNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existingIds = useMemo(() => new Set(recipients.map((r) => r.contact_id)), [recipients]);
  const audience = useMemo(() => campaignAudience(contacts, campaign.user_id, campaign.product, existingIds), [contacts, campaign, existingIds]);
  const filtered = audience.filter(({ contact }) => inAudienceSegment(contact, segment)
    && (origin === 'all' || contact.origin === origin) && (contactMatchesSearch(contact, search) || !!contact.email?.toLowerCase().includes(search.toLowerCase())));
  const eligible = filtered.filter((r) => !r.reason);
  const excluded = filtered.length - eligible.length;
  const chosen = audience.filter((r) => selected.has(r.contact.id) && !r.reason);
  const previewName = chosen[0]?.contact.name ?? null;
  const visible = filtered.slice(page * 25, (page + 1) * 25);
  const changeFilter = () => { setSelected(new Set()); setPage(0); setConfirmed(false); };
  const toggle = (id: string) => {
    setConfirmed(false);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_CAMPAIGN_SELECTION) next.add(id);
      return next;
    });
  };
  const save = async () => {
    setError('');
    if (!subject.trim() || subject.trim().length > 255 || content.length > 12000) {
      setError('Confira o assunto e o tamanho da mensagem.'); return;
    }
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo.trim())) {
      setError('Informe um endereço de resposta válido ou deixe vazio.'); return;
    }
    if (selected.size !== chosen.length) { setError('O público mudou. Volte e revise os contatos selecionados.'); return; }
    if (selected.size && (!confirmed || reviewNote.trim().length < 8)) {
      setError('Registre a evidência e confirme a revisão dos destinatários.'); return;
    }
    setSaving(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('prepare_email_campaign', {
        p_campaign_id: campaign.id, p_subject: subject.trim(), p_content_text: content,
        p_reply_to: replyTo.trim() || null, p_contact_ids: [...selected], p_review_note: reviewNote.trim(),
      });
      if (rpcError) throw rpcError;
      setSelected(new Set()); setConfirmed(false); setReviewNote('');
      toast.success(`Rascunho salvo. ${Number(data) || 0} contato(s) adicionado(s).`);
      // A refresh failure must never suggest the successful save failed or invite replay.
      try { await onSaved(); } catch { setError('Salvo, mas a lista não atualizou. Recarregue a página antes de continuar.'); }
    } catch {
      setError('Não foi possível salvar. Confira se a preparação está disponível e se os contatos continuam aptos, sem bloqueios ou descadastros.');
    } finally { setSaving(false); }
  };

  return <Card className="overflow-hidden">
    <div className="border-b border-border bg-surface-2/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-fg">Preparar campanha</h2>
          <p className="mt-1 text-sm text-muted">{productLabel(campaign.product)} · {campaign.provider.toUpperCase()} · avance no seu ritmo e salve o rascunho.</p></div>
        <Badge tone="gray">Sem envio nesta etapa</Badge>
      </div>
      <nav aria-label="Etapas da preparação" className="mt-5 grid grid-cols-3 gap-2">
        {steps.map((label, index) => <button key={label} disabled={saving} onClick={() => setStep(index)}
          aria-current={step === index ? 'step' : undefined}
          className={`min-w-0 rounded-lg border px-1 py-3 text-xs sm:px-2 sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${step === index ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-fg'}`}>
          {index + 1}. {label}
        </button>)}
      </nav>
    </div>
    <fieldset disabled={saving} className="min-w-0 space-y-5 p-5">
      <legend className="sr-only">{steps[step]}</legend>
      {step === 0 && <>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-surface-2 p-3"><p className="text-xl font-semibold text-fg">{eligible.length}</p><p className="text-xs text-muted">Aptos nesta seleção</p></div>
          <div className="rounded-lg bg-surface-2 p-3"><p className="text-xl font-semibold text-fg">{excluded}</p><p className="text-xs text-muted">Fora da seleção</p></div>
          <div className="rounded-lg bg-brand/10 p-3"><p className="text-xl font-semibold text-brand">{selected.size}</p><p className="text-xs text-muted">Selecionados</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Grupo de contatos" htmlFor="campaign-segment"><Select id="campaign-segment" value={segment} onChange={(e) => { setSegment(e.target.value as AudienceSegment); changeFilter(); }}>
            <option value="prospecting">Prospecção</option><option value="pipeline">Funil ativo</option><option value="clients">Clientes</option><option value="all">Todos do produto</option>
          </Select></Field>
          <Field label="Origem do público" htmlFor="campaign-origin"><Select id="campaign-origin" value={origin} onChange={(e) => { setOrigin(e.target.value); changeFilter(); }}>
            <option value="all">Todas as origens</option>{ORIGINS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select></Field>
          <Field label="Buscar no público" htmlFor="campaign-search"><Input id="campaign-search" value={search} onChange={(e) => { setSearch(e.target.value); changeFilter(); }} placeholder="Nome, empresa ou e-mail" /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" disabled={eligible.length === 0 || eligible.length > MAX_CAMPAIGN_SELECTION}
            onClick={() => { setSelected(new Set(eligible.map((r) => r.contact.id))); setConfirmed(false); }}>Selecionar aptos ({eligible.length})</Button>
          <button type="button" className="text-sm text-muted underline" onClick={() => { setSelected(new Set()); setConfirmed(false); }}>Limpar seleção</button>
          <span className="text-xs text-muted">Até {MAX_CAMPAIGN_SELECTION} por preparação. Trocar filtros limpa a seleção.</span>
        </div>
        <div className="divide-y divide-border rounded-lg border border-border">
          {!visible.length && <p className="p-5 text-sm text-muted">Nenhum contato neste grupo. Ajuste os filtros ou revise a base de prospecção.</p>}
          {visible.map(({ contact, reason }) => <label key={contact.id} className={`flex items-start gap-3 p-3 ${reason ? 'bg-surface-2/40' : 'cursor-pointer hover:bg-surface-2'}`}>
            <Checkbox aria-label={`Incluir ${contactName(contact.name)}`} disabled={!!reason || (!selected.has(contact.id) && selected.size >= MAX_CAMPAIGN_SELECTION)} checked={selected.has(contact.id)} onChange={() => toggle(contact.id)} />
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-fg">{contactName(contact.name)}</span>
              <span className="block break-all text-xs text-muted">{contact.email || 'Sem e-mail'} · {originLabel(contact.origin)}</span>
              {reason && <span className="mt-1 block text-xs text-muted">{reason}</span>}</span>
          </label>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>{filtered.length ? `${page * 25 + 1}–${Math.min((page + 1) * 25, filtered.length)} de ${filtered.length}` : '0 contatos'}</span>
          <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={!page} onClick={() => setPage(page - 1)}>Página anterior</Button>
            <Button size="sm" variant="secondary" disabled={(page + 1) * 25 >= filtered.length} onClick={() => setPage(page + 1)}>Próxima página</Button></div>
        </div>
        <p className="text-xs text-muted">Apto significa cadastro revisado, não permissão automática. Confirme o contexto de cada destinatário. <Link href="/contacts" className="text-brand underline">Revisar contatos</Link></p>
      </>}
      {step === 1 && <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Assunto da mensagem" htmlFor="prepare-subject" required><Input id="prepare-subject" value={subject} maxLength={255} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Receber respostas em" htmlFor="prepare-reply" hint="Vazio usa o remetente. A caixa deverá estar conectada ao atendimento."><Input id="prepare-reply" type="email" value={replyTo} maxLength={320} onChange={(e) => setReplyTo(e.target.value)} placeholder={campaign.sender_email} /></Field>
          <Field label="Texto do e-mail" htmlFor="prepare-content" hint="Use {{nome}} e {{produto}} para personalizar a prévia."><Textarea id="prepare-content" rows={12} maxLength={12000} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Escreva uma mensagem clara, com contexto e um próximo passo." /></Field>
          <p className="text-xs text-muted">{content.length}/12.000 caracteres. O conteúdo fica salvo como texto.</p>
          <Link href={`/campaigns/templates?product=${encodeURIComponent(campaign.product)}`} target="_blank" rel="noopener noreferrer" className="inline-flex text-sm font-medium text-brand hover:underline">Consultar modelo visual da marca ↗</Link>
        </div>
        <div className="space-y-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Mail className="h-4 w-4" /> Prévia da mensagem</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="space-y-1 border-b border-border p-4 text-sm"><p className="break-all text-muted">De: {campaign.sender_email}</p><p className="font-semibold text-fg">{personalizePreview(subject, previewName, campaign.product) || 'Sem assunto'}</p></div>
            <div data-testid="campaign-preview" className="min-h-48 whitespace-pre-wrap break-words p-5 text-sm leading-relaxed text-fg">{personalizePreview(content, previewName, campaign.product) || 'Sua mensagem aparecerá aqui.'}</div>
          </div><p className="text-xs text-muted">{previewName ? 'Prévia com o primeiro contato selecionado.' : 'Prévia sem destinatário selecionado.'} A aparência final depende do modelo de envio.</p>
        </div>
      </div>}
      {step === 2 && <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-border p-4"><p className="flex items-center gap-2 font-medium text-fg"><Users className="h-4 w-4" /> Público revisado</p><p className="mt-2 text-sm text-muted">{recipients.length} já na campanha · {chosen.length} novos selecionados</p></div>
          <div className="rounded-lg border border-border p-4"><p className="font-medium text-fg">Mensagem</p><p className="mt-2 break-words text-sm text-muted">{subject || 'Assunto pendente'}</p><p className="mt-1 text-xs text-muted">{content.trim() ? 'Texto preenchido' : 'Texto ainda não preenchido'}</p></div></div>
        {!!selected.size && <>
          <Field label="Evidência da revisão deste público" htmlFor="prepare-note" required hint={campaign.audience_basis === 'opt_in' ? 'Informe a origem, data e escopo do opt-in de todos os selecionados. Se forem diferentes, prepare grupos separados.' : 'Registre origem, data e contexto da abordagem. Separe contatos que exigem uma revisão diferente.'}>
            <Textarea id="prepare-note" rows={3} minLength={8} maxLength={1000} value={reviewNote} onChange={(e) => { setReviewNote(e.target.value); setConfirmed(false); }} />
          </Field>
          <label className="flex items-start gap-3 rounded-lg bg-surface-2 p-4 text-sm text-fg"><Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-label="Confirmar revisão da audiência" />Revisei os destinatários e a evidência corresponde a todos os contatos selecionados.</label>
        </>}
        <div className="rounded-lg border border-border p-4 text-sm text-muted"><p className="flex items-center gap-2 font-medium text-fg"><Check className="h-4 w-4" /> O que acontece ao salvar</p><p className="mt-2">A mensagem e os novos destinatários ficam no rascunho. Os contatos mantêm seu histórico e posição no funil.</p><p className="mt-2">O envio pela Brevo ainda depende da conexão e da revisão final de remetente, permissão e descadastro. Nenhum e-mail será enviado ao salvar.</p></div>
      </div>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
        {step < 2 ? <Button onClick={() => setStep(step + 1)}>Continuar <ArrowRight className="h-4 w-4" /></Button> : <Button loading={saving} onClick={save}><Save className="h-4 w-4" /> Salvar preparação</Button>}
      </div>
    </fieldset>
  </Card>;
}
