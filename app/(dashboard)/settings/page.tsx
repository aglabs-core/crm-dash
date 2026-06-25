'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sun, Moon, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/components/ThemeProvider';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardBody, Button, Field, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

export default function Settings() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '' });

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
    if (file.size > 1_000_000) {
      toast.error('A imagem deve ter no máximo 1MB.');
      return;
    }
    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `avatars/${user.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('crm-dash')
        .upload(path, file, { upsert: true, cacheControl: '3600' });
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
                <p className="mt-2 text-xs text-muted">JPG, GIF ou PNG. Máx 1MB.</p>
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
