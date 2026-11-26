import { useState, useSyncExternalStore } from 'react';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { cloudSync } from '../lib/cloudSync.js';
import { useI18n } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';

const STATUS_LABELS = {
  loading: 'Conectando…',
  saving: 'Guardando cambios…',
  synced: 'Sincronizado',
  error: 'Error de sincronización',
  'needs-choice': 'Elige cómo combinar los datos',
  'signed-out': 'Sin vincular',
  unconfigured: 'Falta configurar Supabase'
};

export default function CloudSyncPanel() {
  const { t } = useI18n();
  const state = useSyncExternalStore(cloudSync.subscribe, cloudSync.getState, cloudSync.getState);
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setFormError('');
    try {
      if (mode === 'signup') {
        const hasSession = await cloudSync.signUp(email.trim(), password);
        setMessage(hasSession ? t('Cuenta creada. Preparando sincronización…') : t('Revisa tu correo para confirmar la cuenta.'));
      } else {
        await cloudSync.signIn(email.trim(), password);
      }
    } catch (error) {
      setFormError(error.message || t('No se pudo conectar con la cuenta.'));
    } finally {
      setBusy(false);
    }
  };

  const status = t(STATUS_LABELS[state.status] || 'Estado de sincronización desconocido');

  return (
    <section className="max-w-2xl rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5" aria-labelledby="cloud-sync-title">
      <div className="mb-4">
        <h2 id="cloud-sync-title" className="text-base font-semibold">{t('Cuenta y sincronización')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Vincula una cuenta para compartir tu biblioteca, progreso, categorías y extensiones entre dispositivos.')}
        </p>
      </div>

      {!state.configured ? (
        <p className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
          {t('Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY para activar las cuentas.')}
        </p>
      ) : state.email ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{state.email}</p>
              <p className="mt-1 text-xs text-muted-foreground" role="status">{status}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy || state.status === 'loading'} onClick={() => { setBusy(true); void cloudSync.syncNow().catch((error) => setFormError(error.message)).finally(() => setBusy(false)); }}>
                {t('Sincronizar ahora')}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setBusy(true); void cloudSync.signOut().catch((error) => setFormError(error.message)).finally(() => setBusy(false)); }}>
                {t('Desconectar')}
              </Button>
            </div>
          </div>

          {state.status === 'needs-choice' && (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-medium">{t('Hay datos en este dispositivo y en la cuenta. Elige cómo continuar.')}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={busy} onClick={() => { setBusy(true); void cloudSync.resolveInitialChoice('merge').catch((error) => setFormError(error.message)).finally(() => setBusy(false)); }}>
                  {t('Combinar datos')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setBusy(true); void cloudSync.resolveInitialChoice('cloud').catch((error) => setFormError(error.message)).finally(() => setBusy(false)); }}>
                  {t('Usar datos de la cuenta')}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setBusy(true); void cloudSync.resolveInitialChoice('local').catch((error) => setFormError(error.message)).finally(() => setBusy(false)); }}>
                  {t('Mantener sin vincular')}
                </Button>
              </div>
            </div>
          )}

          {(state.warning || state.error) && (
            <p className={cn('rounded-lg border p-3 text-sm', state.error ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground')} role={state.error ? 'alert' : 'status'}>
              {state.error || state.warning}
            </p>
          )}
        </div>
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1.5 text-sm">
            <span>{t('Correo electrónico')}</span>
            <Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>{t('Contraseña')}</span>
            <Input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
          {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
          <div className="flex flex-row-reverse flex-wrap items-center justify-start gap-2 pt-1">
            <Button type="submit" disabled={busy}>
              {busy ? t('Conectando…') : mode === 'signup' ? t('Crear cuenta') : t('Iniciar sesión')}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setFormError(''); setMessage(''); }}>
              {mode === 'signup' ? t('Ya tengo una cuenta') : t('Crear cuenta')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
