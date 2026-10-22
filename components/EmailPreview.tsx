'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

/** Block remote pixels by default; opening the CRM must not count as a recipient open. */
export function EmailPreview({ html }: { html: string }) {
  const [images, setImages] = useState(false);
  const policy = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: ${images ? 'https:' : ''}; font-src data:; base-uri 'none'; form-action 'none'`;
  const src = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"></head><body>${html}</body></html>`;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Button size="sm" variant="secondary" onClick={() => setImages(!images)}>{images ? 'Ocultar imagens externas' : 'Carregar imagens externas'}</Button>
      <span>Imagens externas podem registrar uma abertura no provedor.</span>
    </div>
    <iframe title="Prévia do e-mail" sandbox="" referrerPolicy="no-referrer" srcDoc={src}
      className="h-[420px] w-full rounded-lg border border-border bg-white" />
  </div>;
}
