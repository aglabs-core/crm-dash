'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const inputClass =
  'block w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-fg placeholder:text-muted shadow-sm transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring';

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const router = useRouter();

  const notConfigured =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://placeholder.supabase.co';

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    if (notConfigured) {
      setError('Supabase não configurado. Adicione NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      setIsLoading(false);
      return;
    }

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccessMsg('Conta criada com sucesso! Você já pode fazer login.');
        setIsSignUp(false);
        setPassword('');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/');
      }
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro na autenticação.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setSuccessMsg(null);
    if (!email) {
      setError('Digite seu e-mail acima para redefinir a senha.');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined,
      });
      if (error) throw error;
      setSuccessMsg('Enviamos um link de redefinição para o seu e-mail.');
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar a redefinição.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border bg-surface p-10 shadow-xl">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="AG Labs" className="mx-auto h-16 w-16 object-contain" />
          <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-fg">
            {isSignUp ? 'Crie sua conta' : 'Acesse sua conta'}
          </h2>
          <p className="mt-2 text-sm text-muted">
            Ou{' '}
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
                setSuccessMsg(null);
              }}
              className="font-medium text-brand transition-colors hover:text-brand-strong"
            >
              {isSignUp ? 'faça login na sua conta existente' : 'crie uma nova conta'}
            </button>
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleAuth}>
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
              {successMsg}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email-address" className="mb-1 block text-sm font-medium text-fg">
                E-mail
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute inset-y-0 left-3 my-auto h-5 w-5 text-muted" />
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="seu@email.com"
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-fg">
                Senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute inset-y-0 left-3 my-auto h-5 w-5 text-muted" />
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                />
              </div>
            </div>
          </div>

          {!isSignUp && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                className="text-sm font-medium text-brand transition-colors hover:text-brand-strong"
              >
                Esqueceu a senha?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-contrast shadow-md transition-all hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLoading ? (isSignUp ? 'Criando...' : 'Entrando...') : isSignUp ? 'Criar conta' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
