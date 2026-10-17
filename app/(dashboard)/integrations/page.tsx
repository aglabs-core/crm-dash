"use client";
import { useCallback, useEffect, useState } from 'react';
import { Cable, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/format';
import { Badge, Button, Card, PageLoader } from '@/components/ui';
type Connection = { id: string; name: string; last_received_at: string | null; total_events: number; pending_events: number; ignored_events: number };
export default function Integrations() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('brevo_connection_health');
    if (error) throw new Error('Health unavailable');
    return (data?.[0] || null) as Connection | null;
  }, []);
  useEffect(() => {
    let active = true;
    refresh().then((row) => { if (active) setConnection(row); }).catch(() => { if (active) setError('Não foi possível consultar a integração. Confira sua conexão e a instalação do módulo.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const reload = async () => {
    setLoading(true); setError('');
    try { setConnection(await refresh()); } catch { setError('Não foi possível atualizar a integração.'); } finally { setLoading(false); }
  };
  const prepare = async () => {
    setSaving(true); setError('');
    try {
      const { data: auth } = await supabase.auth.getUser(); if (!auth.user) throw new Error('Session required');
      const { error } = await supabase.from('email_provider_connections').insert({ user_id: auth.user.id, provider: 'brevo', name: 'Brevo AG LABS' });
      if (error && error.code !== '23505') throw new Error('Connection unavailable');
      setConnection(await refresh());
    } catch { setError('Não foi possível preparar a conexão. Confira seu acesso e a instalação do módulo.'); } finally { setSaving(false); }
  };
  return <div className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold text-fg">Integrações</h1><p className="mt-1 text-sm text-muted">Acompanhe a chegada dos resultados dos seus provedores.</p></div><Button variant="secondary" onClick={reload} disabled={loading}><RefreshCw className="h-4 w-4" /> Atualizar</Button></div>
    {loading ? <PageLoader /> : <Card className="space-y-5 p-5">
      <div className="flex flex-wrap justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold text-fg"><Cable className="h-5 w-5" /> Brevo</h2><Badge tone={connection?.last_received_at ? 'emerald' : 'gray'}>{connection?.last_received_at ? 'Eventos recebidos' : 'Aguardando conexão'}</Badge></div>
      <p className="text-sm text-muted">Receba entregas, falhas e descadastros dos envios individuais. O retorno não envia e-mails nem altera o funil comercial.</p>
      {connection ? <>
        <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-surface-2 p-4"><p className="text-2xl font-semibold text-fg">{connection.total_events}</p><p className="text-sm text-muted">Eventos únicos</p></div><div className="rounded-lg bg-surface-2 p-4"><p className="text-2xl font-semibold text-fg">{connection.pending_events}</p><p className="text-sm text-muted">Aguardando vínculo</p></div><div className="rounded-lg bg-surface-2 p-4"><p className="text-2xl font-semibold text-fg">{connection.ignored_events}</p><p className="text-sm text-muted">Tipos não reconhecidos</p></div></div>
        <p className="text-sm text-muted">Último recebimento: {connection.last_received_at ? formatDateTime(connection.last_received_at) : 'Ainda não recebemos eventos. Preparar o cadastro não ativa o webhook.'}</p>
        <p className="text-sm text-muted">Para conciliar envios já feitos, abra a campanha e vincule o identificador Brevo ao destinatário correto. Eventos pendentes serão relacionados sem reenviar mensagens.</p>
        <details className="rounded-lg border border-border p-4 text-sm"><summary className="cursor-pointer font-medium text-fg">Dados para configuração do servidor</summary><div className="mt-3 space-y-2 break-all text-muted"><p>Conexão: {connection.id}</p><p>Endpoint: /api/integrations/brevo/webhook</p><p>A ativação exige o endpoint publicado e autenticação Bearer no servidor. Nenhuma chave API é salva pelo navegador.</p></div></details>
      </> : !error && <Button loading={saving} onClick={prepare}>Preparar conexão Brevo</Button>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Card>}
  </div>;
}
