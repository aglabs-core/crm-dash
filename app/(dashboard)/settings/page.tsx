'use client';

import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Upload, Eye, EyeOff, KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/components/ThemeProvider';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardBody, Button, Field, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

const MAX_AVATAR_BYTES = 2_000_000; // 2MB
const MIN_PASSWORD_LEN = 6;

export default function Settings() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '' });

  // Change-password state.
  const [pwd, setPwd] = useState({ next: '', confirm: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [isSavingPwd, setIsSavingPwd] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.user_metadata?.first_name || '',
        lastName: user.user_metadata?.last_name || '',
        email: user.email || '',
      });
      setAvatarUrl(user.user_metadata?.avatar_url);
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { first_name: formData.firstName, last_name: formData.lastName },
      });
      if (error) throw error;
      toast.success('Perfil atualizado com sucesso!');
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Erro ao atualizar perfil.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('A imagem deve ter no máximo 2MB.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setIsUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `avatars/${user.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('crm-dash')
        .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = supabase.storage.from('crm-dash').getPublicUrl(path);
      const busted = `${publicUrl}?t=${Date.now()}`;
      const { error: updErr } = await supabase.auth.updateUser({ data: { avatar_url: busted } });
      if (updErr) throw updErr;
      setAvatarUrl(busted);
      toast.success('Avatar atualizado!');
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast.error('Erro ao enviar o avatar. Verifique as permissões do bucket "crm-dash".');
    } finally {
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.next.length < MIN_PASSWORD_LEN) {
      toast.error(`A senha deve ter pelo menos ${MIN_PASSWORD_LEN} caracteres.`);
      return;
    }
    if (pwd.next !== pwd.confirm) {
      toast.error('As senhas não coincidem.');
      return;
    }
    setIsSavingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd.next });
      if (error) throw error;
      toast.success('Senha alterada com sucesso!');
      setPwd({ next: '', confirm: '' });
    } catch (error) {
      console.error('Error changing password:', error);
      const msg = (error as { message?: string })?.message ?? '';
      toast.error(
        /same.*password/i.test(msg)
          ? 'A nova senha deve ser diferente da atual.'
          : 'Erro ao alterar a senha. Tente novamente.',
      );
    } finally {
      setIsSavingPwd(false);
    }
  };

  const initials =
    `${formData.firstName?.[0] || ''}${formData.lastName?.[0] || ''}`.toUpperCase() ||
    user?.email?.[0]?.toUpperCase() ||
    'U';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-fg">Configurações</h1>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Perfil</CardTitle>
            <p className="mt-1 text-sm text-muted">Atualize suas informações pessoais.</p>
          </div>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="flex items-center gap-6">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Avatar" className="h-20 w-20 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand/10 text-2xl font-bold text-brand">
                  {initials}
                </div>
              )}
              <div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} loading={isUploading}>
                  <Upload className="h-4 w-4" />
                  Mudar avatar
                </Button>
                <p className="mt-2 text-xs text-muted">JPG, GIF ou PNG. Máx 2MB.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nome" htmlFor="first-name">
                <Input
                  id="first-name"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </Field>
              <Field label="Sobrenome" htmlFor="last-name">
                <Input
                  id="last-name"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Endereço de e-mail" htmlFor="email" hint="O e-mail não pode ser alterado.">
              <Input id="email" type="email" disabled value={formData.email} />
            </Field>

            <div className="flex justify-end border-t border-border pt-6">
              <Button type="submit" loading={isLoading}>
                Salvar
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Segurança</CardTitle>
            <p className="mt-1 text-sm text-muted">Altere a senha da sua conta.</p>
          </div>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleChangePassword} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nova senha" htmlFor="new-password" hint={`Mínimo de ${MIN_PASSWORD_LEN} caracteres.`}>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="pr-10"
                    value={pwd.next}
                    onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted transition-colors hover:text-fg"
                    aria-label={showPwd ? 'Ocultar senha' : 'Mostrar senha'}
                    tabIndex={-1}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Confirmar nova senha" htmlFor="confirm-password">
                <Input
                  id="confirm-password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={pwd.confirm}
                  onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
                  placeholder="••••••••"
                />
              </Field>
            </div>
            <div className="flex justify-end border-t border-border pt-6">
              <Button type="submit" loading={isSavingPwd} disabled={!pwd.next || !pwd.confirm}>
                <KeyRound className="h-4 w-4" />
                Alterar senha
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Aparência</CardTitle>
            <p className="mt-1 text-sm text-muted">Escolha o tema da interface.</p>
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-4 text-sm font-medium transition-colors',
                  theme === t ? 'border-brand bg-brand/10 text-brand' : 'border-border text-fg hover:bg-surface-2',
                )}
              >
                {t === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                {t === 'light' ? 'Claro' : 'Escuro'}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
