import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { cloudSync } from '../lib/cloudSync.js';
import { useI18n } from '../lib/i18n.js';
import { useScale, fontPx } from '../lib/useScale.js';
import { cn } from '../lib/utils.js';
import BackupProgress from './BackupProgress.jsx';
import { Dialog } from './ui/dialog.jsx';

const STATUS_LABELS = {
  loading: 'Conectando…',
  syncing: 'Sincronizando datos…',
  saving: 'Guardando cambios…',
  synced: 'Sincronizado',
  connected: 'Conectado',
  'local-pending': 'Hay cambios pendientes de sincronizar',
  error: 'Error de sincronización',
  'needs-choice': 'Elige cómo combinar los datos',
  'age-confirmation': 'Confirmación de edad pendiente',
  'signed-out': 'Sin vincular',
  unconfigured: 'Falta configurar Supabase'
};

const FIELD_LABELS = {
  title: 'título',
  author: 'autor',
  cover: 'portada',
  description: 'descripción',
  type: 'tipo',
  genres: 'géneros',
  chapterTotal: 'cantidad de capítulos',
  chapterReadCount: 'capítulos leídos',
  sourceId: 'fuente',
  sourceName: 'nombre de la fuente',
  sourceIcon: 'icono de la fuente',
  cats: 'categorías',
  version: 'versión',
  page: 'página',
  total: 'total de páginas',
  read: 'estado de lectura'
};

function ChangeSummary({ groups, t, scale }) {
  if (!groups?.length) return null;
  return (
    <ul className="min-w-0 space-y-2" style={{ fontSize: fontPx(13, scale, 12), lineHeight: 1.45 }}>
      {groups.map((group) => (
        <li key={group.label} className="min-w-0 break-words [overflow-wrap:anywhere]">
          <p className="font-medium" style={{ fontSize: fontPx(14, scale, 13), lineHeight: 1.35 }}>{t(group.label)}{group.count > 0 ? ` · ${group.count}` : ''}</p>
          {group.message ? (
            <p className="ml-3 mt-1 text-muted-foreground">{t(group.message)}</p>
          ) : group.items.length > 0 ? (
            <ul className="ml-3 mt-1 min-w-0 space-y-1 text-muted-foreground">
              {group.items.map((item, index) => (
                <li key={`${item.action}-${item.name}-${index}`}>
                  {item.action ? `${t(item.action)}: ` : ''}{group.label === 'Ajustes' ? t(item.name) : item.name}
                  {group.label !== 'Biblioteca' && item.fields?.length > 0 && <span className="text-muted-foreground"> · {item.fields.map((field) => t(FIELD_LABELS[field] || field)).join(', ')}</span>}
                </li>
              ))}
              {group.more > 0 && <li>{t('+{count} más', { count: group.more })}</li>}
            </ul>
          ) : (
            <p className="ml-3 mt-1 text-muted-foreground">{t('{count} capítulos con diferencias', { count: group.count })}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function CloudSyncPanel() {
  const { t } = useI18n();
  const scale = useScale();
  const state = useSyncExternalStore(cloudSync.subscribe, cloudSync.getState, cloudSync.getState);
  const manualSyncRef = useRef(false);
  useEffect(() => () => {
    if (manualSyncRef.current) cloudSync.cancelAccountViewSync();
  }, []);
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [choiceConfirmation, setChoiceConfirmation] = useState(null);
  const [showSyncPreview, setShowSyncPreview] = useState(false);
  useEffect(() => { if (state.status !== 'needs-choice') setChoiceConfirmation(null); }, [state.status]);
  const submit = async (event) => {
    event.preventDefault();
    if (mode === 'signup' && password !== confirmPassword) {
      setFormError(t('Las contraseñas no coinciden.'));
      return;
    }
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
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setShowConfirmation(false);
    } catch (error) {
      setFormError(error.message?.toLowerCase() === 'invalid login credentials'
        ? t('Credenciales de inicio de sesión no válidas.')
        : error.message || t('No se pudo conectar con la cuenta.'));
    } finally {
      setBusy(false);
    }
  };

  const changeMode = () => {
    setMode((current) => current === 'signup' ? 'signin' : 'signup');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmation(false);
    setFormError('');
    setMessage('');
  };

  const status = t(STATUS_LABELS[state.status] || 'Estado de sincronización desconocido');

  return (
    <section className="w-full rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5" aria-labelledby="cloud-sync-title">
      <div className="mb-4">
        <h2 id="cloud-sync-title" className="text-base font-semibold">{t('Cuenta y sincronización')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Vincula una cuenta para compartir tu biblioteca, progreso, categorías, extensiones y ajustes entre dispositivos.')}
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
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setBusy(true); void cloudSync.signOut().catch((error) => setFormError(error.message)).finally(() => setBusy(false)); }}>
                {t('Desconectar')}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy || state.status === 'loading' || state.status === 'syncing' || (state.status === 'needs-choice' && showSyncPreview) || state.status === 'age-confirmation' || Boolean(state.restoreProgress)} onClick={() => { manualSyncRef.current = true; setShowSyncPreview(true); setFormError(''); if (state.pendingChoice) return; setBusy(true); void cloudSync.syncNow().catch((error) => setFormError(error.message)).finally(() => setBusy(false)); }}>
                {t('Sincronizar ahora')}
              </Button>
            </div>
          </div>

          <BackupProgress progress={state.restoreProgress} scale={scale} compact />

          <Dialog open={Boolean(choiceConfirmation)} onClose={() => setChoiceConfirmation(null)}
            title={choiceConfirmation === 'cloud' ? 'Cargar datos de la cuenta' : 'Guardar datos en tu cuenta'}
            description={choiceConfirmation === 'cloud'
              ? 'La biblioteca, el progreso, las categorías, las extensiones y los ajustes de este dispositivo se reemplazarán con los datos de tu cuenta.'
              : 'La biblioteca, el progreso, las categorías, las extensiones y los ajustes de tu cuenta se reemplazarán con los datos de este dispositivo.'}
            hideDivider bodyClassName="pb-6" scrollableBody={false} scale={scale}>
            <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setChoiceConfirmation(null)}>{t('Cancelar')}</Button>
              <Button type="button" onClick={() => {
                const choice = choiceConfirmation;
                setChoiceConfirmation(null);
                manualSyncRef.current = false;
                setBusy(true);
                void cloudSync.resolveInitialChoice(choice).catch((error) => setFormError(error.message)).finally(() => setBusy(false));
              }}>{choiceConfirmation === 'cloud' ? t('Cargar datos') : t('Guardar datos')}</Button>
            </div>
          </Dialog>

          {showSyncPreview && state.status === 'needs-choice' && state.pendingChoice && (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <p className="text-sm font-medium">{t(state.pendingChoice.localChanges?.length ? 'Hay cambios distintos en este dispositivo y en tu cuenta' : 'No se encontraron diferencias visibles entre este dispositivo y tu cuenta.')}</p>
              {state.pendingChoice.localChanges?.length > 0 && <p className="text-muted-foreground">{t('Cambios que se aplicarían al cargar los datos de la cuenta en este dispositivo:')}</p>}
              <ChangeSummary groups={state.pendingChoice.localChanges} t={t} scale={scale} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setChoiceConfirmation('cloud')}>
                  {t('Cargar datos')}
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => setChoiceConfirmation('backup')}>
                  {t('Guardar datos')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setShowSyncPreview(false); manualSyncRef.current = false; void cloudSync.resolveInitialChoice('cancel'); }}>
                  {t('Cancelar')}
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
            <Input type="email" autoComplete="email" required disabled={busy} value={email} onChange={(event) => { setEmail(event.target.value); setFormError(''); }} />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>{t('Contraseña')}</span>
            <span className="relative block">
              <Input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 6 : undefined} required disabled={busy} value={password} onChange={(event) => { setPassword(event.target.value); setFormError(''); }} className="pr-11" />
              <button type="button" aria-label={t(showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </span>
          </label>
          {mode === 'signup' && (
            <label className="block space-y-1.5 text-sm">
              <span>{t('Confirmar contraseña')}</span>
              <span className="relative block">
                <Input type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" minLength={6} required disabled={busy} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setFormError(''); }} className="pr-11" aria-invalid={!!formError && password !== confirmPassword} aria-describedby={formError ? 'cloud-auth-error' : undefined} />
                <button type="button" aria-label={t(showConfirmation ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña')} aria-pressed={showConfirmation} onClick={() => setShowConfirmation((value) => !value)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  {showConfirmation ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </span>
            </label>
          )}
          {formError && <p id="cloud-auth-error" className="text-sm text-destructive" role="alert">{formError}</p>}
          {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
          <div className="flex flex-row-reverse flex-wrap items-center justify-start gap-2 pt-1">
            <Button type="submit" disabled={busy}>
              {busy ? t('Conectando…') : mode === 'signup' ? t('Crear cuenta') : t('Iniciar sesión')}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={changeMode}>
              {mode === 'signup' ? t('Ya tengo una cuenta') : t('Crear cuenta')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
