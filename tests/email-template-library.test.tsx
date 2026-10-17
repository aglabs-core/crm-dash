import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailTemplateLibrary } from '@/components/EmailTemplateLibrary';
import { isolatedEmailPreview, templateProduct } from '@/lib/email-templates';
import catalog from '@/lib/email-templates/barberias.json';

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
it('does not substitute a fabricated model for the missing institutional original', async () => {
  render(<EmailTemplateLibrary product="AG LABS" />);
  expect(screen.getByText(/arquivo HTML original ainda precisa/)).toBeTruthy();
  expect(screen.queryByTitle(/^E-mail:/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Baixar HTML' })).toBeNull();
  await waitFor(() => expect(screen.getByText('14 modelos')).toBeTruthy());
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
