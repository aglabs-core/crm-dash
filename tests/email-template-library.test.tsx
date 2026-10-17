import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailTemplateLibrary } from '@/components/EmailTemplateLibrary';
import { EMAIL_TEMPLATE_PRODUCTS, isolatedEmailPreview, previewTemplateContent, templateProduct } from '@/lib/email-templates';
import catalog from '@/lib/email-templates/barberias.json';
import institutional from '@/lib/email-templates/aglabs.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
it('shows original examples in an isolated iframe, supports mobile/text/search and never sends', async () => {
  const user = userEvent.setup();
  render(<EmailTemplateLibrary />);
  const frame = await screen.findByTitle(`E-mail: ${catalog.templates[0].subject}`) as HTMLIFrameElement;
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(frame.srcdoc).toContain("default-src 'none'");
  expect(frame.srcdoc).toContain('Barbearia Exemplo');
  await user.click(screen.getByRole('button', { name: 'Prévia celular' }));
  expect((screen.getByTitle(`E-mail: ${catalog.templates[0].subject}`) as HTMLIFrameElement).style.maxWidth).toBe('390px');
  await user.click(screen.getByRole('button', { name: 'Texto' }));
  expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === catalog.templates[0].text)).toBeTruthy();
  await user.type(screen.getByLabelText('Buscar modelo'), 'senha');
  expect(screen.getByRole('button', { name: /Recuperação de senha/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Boas-vindas ao teste/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Enviar/ })).toBeNull();
});
it('previews the supplied institutional model with fictional data, copies reusable fields and switches products', async () => {
  const user = userEvent.setup();
  render(<EmailTemplateLibrary product="AG LABS" />);
  const frame = await screen.findByTitle('E-mail: Como ficou a nova página?') as HTMLIFrameElement;
  expect(frame.srcdoc).toContain('Oi, Cliente Exemplo!');
  expect(frame.srcdoc).toContain('https://aglabs.ia.br/android-chrome-512x512.png');
  expect(frame.srcdoc).not.toContain('{{nome}}');
  expect(frame.srcdoc).not.toMatch(/<a\b[^>]*\bhref\s*=/i);
  await user.click(screen.getByRole('button', { name: 'Copiar HTML' }));
  expect(await navigator.clipboard.readText()).toBe(institutional.templates[0].html);
  expect(await navigator.clipboard.readText()).toContain('{{nome}}');
  await user.click(screen.getByRole('button', { name: /^Barberias/ }));
  await screen.findByTitle(`E-mail: ${catalog.templates[0].subject}`);
  expect(screen.queryByTitle('E-mail: Como ficou a nova página?')).toBeNull();
  await user.click(screen.getByRole('button', { name: /^AG LABS institucional/ }));
  await screen.findByTitle('E-mail: Como ficou a nova página?');
  await user.click(screen.getByRole('button', { name: 'Texto' }));
  expect(screen.getByText(/Oi, Cliente Exemplo!/)).toBeTruthy();
});
it('imports only known synthetic examples and preserves the original HTML', () => {
  expect(catalog.templates).toHaveLength(14);
  for (const template of catalog.templates) {
    expect(template.html).not.toMatch(/<script\b|<iframe\b|<form\b|\son[a-z]+\s*=/i);
    expect(template.html).toContain('Barberias');
    expect(template.text.length).toBeGreaterThan(100);
    const preview = isolatedEmailPreview(template.html);
    expect(preview).toContain('Content-Security-Policy');
    expect(preview).not.toMatch(/<a\b[^>]*\bhref\s*=/i);
    expect(template.html).toMatch(/<a\b[^>]*\bhref\s*=/i);
  }
  expect(templateProduct('BarberPRO')).toBe('barberias');
  expect(templateProduct('aglabs')).toBe('aglabs');
});
it('keeps reusable corporate fields separate from escaped preview data', () => {
  const template = institutional.templates[0];
  const example = { ...template, previewData: { ...template.previewData, nome: '<script>alert("example")</script>' } };
  expect(previewTemplateContent(example, 'html')).toContain('&lt;script&gt;alert(&quot;example&quot;)&lt;/script&gt;');
  expect(previewTemplateContent(example, 'html')).not.toContain('<script>');
  expect(previewTemplateContent(example, 'text')).toContain('<script>alert("example")</script>');
  expect(template.html).toContain('href="{{url_pagina}}"');
  expect(template.html).toContain('https://g.page/r/CSmjJ68igB6VEBM/review');
  expect(EMAIL_TEMPLATE_PRODUCTS.find((product) => product.id === 'aglabs')?.count).toBe(institutional.templates.length);
  expect(EMAIL_TEMPLATE_PRODUCTS.find((product) => product.id === 'barberias')?.count).toBe(catalog.templates.length);
});
