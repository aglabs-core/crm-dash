'use client';

import { useEffect, useState } from 'react';
import { Copy, Download, Monitor, Search, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, Input, PageLoader, Select } from '@/components/ui';
import { EMAIL_TEMPLATE_PRODUCTS, EMAIL_TEMPLATE_LABELS, isolatedEmailPreview, previewTemplateContent, templateCategory, templateProduct, type EmailTemplateCatalog, type EmailTemplateProductId } from '@/lib/email-templates';

export function EmailTemplateLibrary({ product }: { product?: string }) {
  const [activeProduct, setActiveProduct] = useState<EmailTemplateProductId>(templateProduct(product) ?? 'barberias');
  const [catalogs, setCatalogs] = useState<Partial<Record<EmailTemplateProductId, EmailTemplateCatalog>>>({});
  const [failedProducts, setFailedProducts] = useState<Partial<Record<EmailTemplateProductId, boolean>>>({});
  const [selectedId, setSelectedId] = useState('teste-inicio');
  const [search, setSearch] = useState('');
  const [format, setFormat] = useState<'html' | 'text'>('html');
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    let active = true;
    const load = activeProduct === 'barberias' ? import('@/lib/email-templates/barberias.json') : import('@/lib/email-templates/aglabs.json');
    load.then((module) => { if (active) setCatalogs((previous) => ({ ...previous, [activeProduct]: module.default })); })
      .catch(() => { if (active) setFailedProducts((previous) => ({ ...previous, [activeProduct]: true })); });
    return () => { active = false; };
  }, [activeProduct]);
  const catalog = catalogs[activeProduct];
  const failed = failedProducts[activeProduct];
  const productName = EMAIL_TEMPLATE_PRODUCTS.find((item) => item.id === activeProduct)!.name;
  const selected = catalog?.templates.find((template) => template.id === selectedId) ?? catalog?.templates[0];
  const templates = catalog?.templates.filter((template) => `${template.subject} ${EMAIL_TEMPLATE_LABELS[template.id]} ${templateCategory(template.id)}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) ?? [];
  const copyHtml = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.html); toast.success('HTML copiado.'); }
    catch { toast.error('Não foi possível copiar. Use Baixar HTML.'); }
  };
  const downloadHtml = () => {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([selected.html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${activeProduct}-${selected.id}.html`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
    <aside className="space-y-4" aria-label="Biblioteca por produto">
      <Card className="p-3">
        <h2 className="px-2 pb-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Produtos</h2>
        {EMAIL_TEMPLATE_PRODUCTS.map((item) => <button type="button" key={item.id} onClick={() => { setActiveProduct(item.id); setSelectedId(''); setSearch(''); }} aria-pressed={activeProduct === item.id}
          className={`mb-1 w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeProduct === item.id ? 'border-brand/30 bg-brand/10' : 'border-transparent hover:bg-surface-2'}`}>
          <span className="block text-sm font-semibold text-fg">{item.name}</span><span className="mt-1 block text-xs leading-relaxed text-muted">{item.description}</span>
          <span className="mt-2 block text-xs text-muted">{item.count} {item.count === 1 ? 'modelo' : 'modelos'}</span>
        </button>)}
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border p-3"><label htmlFor="template-search" className="mb-2 flex items-center gap-2 text-xs font-medium text-muted"><Search className="h-3.5 w-3.5" /> Buscar modelo</label><Input id="template-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou finalidade…" /></div>
        <div className="p-3 lg:hidden"><label htmlFor="template-model" className="mb-2 block text-xs font-medium text-muted">Modelo para visualizar</label><Select id="template-model" value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
          {!templates.some((template) => template.id === selected?.id) && selected && <option value={selected.id}>{EMAIL_TEMPLATE_LABELS[selected.id]}</option>}
          {templates.map((template) => <option key={template.id} value={template.id}>{templateCategory(template.id)} · {EMAIL_TEMPLATE_LABELS[template.id]}</option>)}
        </Select>{catalog && !templates.length && <p className="mt-2 text-xs text-muted">Nenhum modelo encontrado.</p>}</div>
        <div className="hidden max-h-[640px] overflow-y-auto p-2 lg:block">
          {templates.map((template) => <button type="button" key={template.id} aria-pressed={selected?.id === template.id} onClick={() => setSelectedId(template.id)}
            className={`mb-1 w-full rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === template.id ? 'bg-brand/10 ring-1 ring-inset ring-brand/25' : 'hover:bg-surface-2'}`}>
            <span className="block text-[11px] font-medium text-muted">{templateCategory(template.id)}</span><span className="mt-1 block text-sm leading-snug text-fg">{EMAIL_TEMPLATE_LABELS[template.id] || template.subject}</span>
          </button>)}
          {catalog && !templates.length && <p className="p-3 text-sm text-muted">Nenhum modelo encontrado.</p>}
        </div>
      </Card>
    </aside>
    {failed ? <Card className="p-8"><p role="alert" className="text-sm text-muted">Não foi possível carregar os modelos. Recarregue a página para tentar novamente.</p></Card> : !catalog || !selected ? <PageLoader /> : <section className="min-w-0 space-y-4" aria-label="Prévia do template">
      <Card className="overflow-hidden">
        <div className="space-y-4 border-b border-border p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><Badge tone="gray">{templateCategory(selected.id)}</Badge><h2 className="mt-2 text-lg font-semibold leading-snug text-fg">{selected.subject}</h2><p className="mt-1 text-xs text-muted">{productName} · exemplo com dados fictícios</p></div></div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg bg-surface-2 p-1" aria-label="Formato da prévia">{(['html', 'text'] as const).map((value) => <button type="button" key={value} aria-pressed={format === value} onClick={() => setFormat(value)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${format === value ? 'bg-surface text-fg shadow-sm' : 'text-muted'}`}>{value === 'html' ? 'E-mail' : 'Texto'}</button>)}</div>
            <div className="flex gap-1" aria-label="Largura da prévia"><Button size="icon" variant="ghost" aria-label="Prévia desktop" aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="Prévia celular" aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone className="h-4 w-4" /></Button></div>
          </div>
        </div>
        {catalog.variables?.length ? <div className="border-b border-border px-4 py-3 text-xs leading-relaxed text-muted">O HTML usa campos para personalizar: {catalog.variables.map((name) => <code key={name} className="mr-2 inline-block text-fg">{`{{${name}}}`}</code>)}. A prévia usa dados fictícios.</div> : null}
        <div className="overflow-hidden bg-surface-2 p-2 sm:p-4">{format === 'html' ? <iframe key={`${selected.id}-${mobile}`} title={`E-mail: ${selected.subject}`} sandbox="" referrerPolicy="no-referrer" srcDoc={isolatedEmailPreview(previewTemplateContent(selected, 'html'))} className="mx-auto block h-[760px] w-full border-0 bg-white" style={{ maxWidth: mobile ? 390 : '100%' }} /> : <pre className="min-h-80 whitespace-pre-wrap break-words rounded-lg bg-surface p-5 font-sans text-sm leading-relaxed text-fg">{previewTemplateContent(selected, 'text')}</pre>}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4"><p className="max-w-sm text-xs text-muted">{catalog.variables?.length ? 'Links desativados na prévia. Preencha os campos do HTML antes de usar.' : 'Dados e links fictícios. Datas e preços são exemplos, não uma oferta vigente.'}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={copyHtml}><Copy className="h-3.5 w-3.5" /> Copiar HTML</Button><Button size="sm" variant="secondary" onClick={downloadHtml}><Download className="h-3.5 w-3.5" /> Baixar HTML</Button></div></div>
      </Card>
      <details className="rounded-xl border border-border bg-surface p-4 text-xs text-muted"><summary className="cursor-pointer font-medium text-fg">Origem e versão dos modelos</summary><div className="mt-3 space-y-2 break-words"><p>{catalog.sourceLabel || `Galeria fictícia do projeto ${catalog.sourceRepository}. Os layouts continuam mantidos no projeto de origem.`} · Importado em {catalog.importedOn}.</p>{catalog.sourceCommit && <p>Revisão consultada: {catalog.sourceCommit.slice(0, 12)}</p>}<ul className="list-inside list-disc">{catalog.sourceFiles.map((file) => <li key={file}>{file}</li>)}</ul><p>A preparação e aprovação das campanhas continuam em Campanhas; copiar o HTML não aplica o modelo a uma campanha.</p></div></details>
    </section>}
  </div>;
}
