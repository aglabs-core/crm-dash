import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailTemplateLibrary } from '@/components/EmailTemplateLibrary';
import { EMAIL_TEMPLATE_PRODUCTS, isolatedEmailPreview, previewTemplateContent, templateProduct } from '@/lib/email-templates';
import barberias from '@/lib/email-templates/barberias.json';
import aglabs from '@/lib/email-templates/aglabs.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
it('shows one visual base per brand and switches isolated HTML, text and mobile previews', async () => {
  const user = userEvent.setup();
  render(<EmailTemplateLibrary />);
  const frame = await screen.findByTitle('E-mail: Modelo-base Barberias') as HTMLIFrameElement;
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(frame.srcdoc).toContain("default-src 'none'");
  expect(frame.srcdoc).toContain('https://barberias.com.br/logo.png');
  expect(screen.queryByLabelText('Buscar modelo')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Prévia celular' }));
  expect((screen.getByTitle('E-mail: Modelo-base Barberias') as HTMLIFrameElement).style.maxWidth).toBe('390px');
  await user.click(screen.getByRole('button', { name: /^AG LABS institucional/ }));
  const corporate = await screen.findByTitle('E-mail: Modelo-base AG LABS') as HTMLIFrameElement;
  expect(corporate.srcdoc).toContain('https://aglabs.ia.br/android-chrome-512x512.png');
  expect(screen.queryByTitle('E-mail: Modelo-base Barberias')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Texto' }));
  expect(screen.getByText((_, element) => element?.tagName === 'PRE' && !!element.textContent?.includes('Personalize o contexto'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Enviar/ })).toBeNull();
});
it('copies a reusable base with free content instead of fixed customer or system messages', async () => {
  const user = userEvent.setup();
  render(<EmailTemplateLibrary product="AG LABS" />);
  await screen.findByTitle('E-mail: Modelo-base AG LABS');
  await user.click(screen.getByRole('button', { name: 'Copiar modelo-base' }));
  const copied = await navigator.clipboard.readText();
  expect(copied).toBe(aglabs.templates[0].html);
  for (const name of ['titulo', 'mensagem', 'assinatura', 'url_acao']) expect(copied).toContain(`{{${name}}}`);
  expect(copied).not.toContain('Personalize o contexto');
  expect(copied).not.toContain('Como ficou a nova página?');
  expect(copied).not.toContain('g.page');
});
it('keeps exactly two neutral visual bases with the existing brand identities', () => {
  for (const [product, catalog] of [['barberias', barberias], ['aglabs', aglabs]] as const) {
    expect(catalog.templates).toHaveLength(1);
    expect(EMAIL_TEMPLATE_PRODUCTS.find((item) => item.id === product)?.count).toBe(1);
    const template = catalog.templates[0];
    expect(template.html).not.toMatch(/<script\b|<iframe\b|<form\b|\son[a-z]+\s*=/i);
    expect(template.html).not.toMatch(/trialEndsAt|Teste disponível até|exemplo-sem-validade|AVALIE-NOS/);
    const preview = isolatedEmailPreview(previewTemplateContent(template, 'html'));
    expect(preview).toContain('Content-Security-Policy');
    expect(preview).not.toMatch(/<a\b[^>]*\bhref\s*=/i);
  }
  expect(templateProduct('BarberPRO')).toBe('barberias');
  expect(templateProduct('AG LABS inst')).toBe('aglabs');
});
it('escapes personalized content, preserves line breaks and omits invalid or absent optional actions', () => {
  const template = aglabs.templates[0];
  const custom = { ...template, previewData: { ...template.previewData, mensagem: 'Olá <script>example</script>\n\nOutra linha', url_acao: 'javascript:alert(1)' } };
  const html = previewTemplateContent(custom, 'html');
  expect(html).toContain('Olá &lt;script&gt;example&lt;/script&gt;<br><br>Outra linha');
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('Ação opcional');
  expect(previewTemplateContent(custom, 'text')).toContain('Olá <script>example</script>\n\nOutra linha');
  expect(previewTemplateContent({ ...template, previewData: { ...template.previewData, texto_acao: '' } }, 'html')).not.toContain('example.invalid/acao');
  expect(previewTemplateContent(template, 'html')).toContain('https://example.invalid/acao');
});
