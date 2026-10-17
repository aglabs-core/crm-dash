"use client";
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button, Field, Input } from '@/components/ui';
export function BrevoMessageLink({ recipientId, onLinked }: { recipientId: string; onLinked: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const link = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Session required');
      const result = await fetch('/api/integrations/brevo/associate', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ recipient_id: recipientId, message_id: message.trim() }),
      });
      if (!result.ok) throw new Error('Association unavailable');
      setOpen(false); setMessage('');
      try { await onLinked(); } catch { setError('Vínculo salvo. Recarregue a página para atualizar os eventos.'); }
    } catch { setError('Não foi possível vincular. Confira o identificador, a conta e a configuração da integração.'); }
    finally { setLoading(false); }
  };
  return <div className="w-full">
    {!open ? <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Vincular envio externo</Button> : <form onSubmit={link} className="mt-2 space-y-3 rounded-lg border border-border p-3">
      <Field label="ID da mensagem na Brevo" htmlFor={`message-${recipientId}`} hint="Use o identificador retornado no envio API/SMTP. Vincular não reenvia a mensagem."><Input id={`message-${recipientId}`} required maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2"><Button size="sm" loading={loading} type="submit">Salvar vínculo</Button><Button size="sm" variant="secondary" disabled={loading} onClick={() => setOpen(false)}>Cancelar</Button></div>
    </form>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
  </div>;
}
