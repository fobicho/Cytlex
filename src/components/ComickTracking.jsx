import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ExternalLink, Loader2, LogOut, RefreshCw, Settings2 } from 'lucide-react';
import { Badge } from './ui/badge.jsx';
import { Button } from './ui/button.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { comickList, COMICK_STATUS } from '../lib/comick.js';
import { comickSession } from '../lib/comickSession.js';
import { lib } from '../lib/library.js';
import { tracking } from '../lib/tracking.js';
import { cn } from '../lib/utils.js';
import { useScale, px, fontPx } from '../lib/useScale.js';
import { settings } from '../lib/settings.js';
import { useResponsiveCoverSize } from '../lib/useResponsiveCoverSize.js';
import { useI18n } from '../lib/i18n.js';

function titleOf(entry) {
  return entry?.title || entry?.titles?.find((item) => item.is_default)?.title || entry?.titles?.[0]?.title || 'Título sin nombre';
}

function progressLabel(entry, t) {
  const value = entry?.progress?.number;
  return value == null ? t('Progreso sin registrar') : `${t('Capítulo')} ${value}`;
}

export default function ComickTracking({ embedded = false, onProviderChange, onBack }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [auth, setAuth] = useState(() => comickSession.status());
  const [profile, setProfile] = useState(null);
  const [entries, setEntries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [coverSize, setCoverSize] = useState(() => settings.get().coverSize);
  const scale = useScale();
  const coverScale = useResponsiveCoverSize(coverSize) / 160;
  const returnToSettings = () => embedded ? onBack?.() : navigate('/ajustes?section=seguimiento');

  useEffect(() => settings.subscribe((value) => setCoverSize(value.coverSize)), []);
  useEffect(() => comickSession.subscribe(() => setAuth(comickSession.status())), []);

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const [who, list] = await Promise.all([comickSession.profile(), comickList.myLibrary({ fresh: true })]);
      setProfile(who);
      setEntries(list);
    } catch (error) {
      setErr(String(error?.message || error));
      setEntries(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const current = comickSession.status();
    setAuth(current);
    if (current.connected) void load();
  }, [load, auth.connected]);

  const localByComick = useMemo(() => {
    const map = new Map();
    for (const manga of lib.favs()) {
      const linked = tracking.get(manga.url, manga.sourceId || 'leercapitulo');
      if (linked?.comickId && !map.has(linked.comickId)) map.set(linked.comickId, manga);
    }
    return map;
  }, [entries]);

  const groups = Object.entries(COMICK_STATUS).map(([id, label]) => ({
    id: Number(id),
    label,
    items: (entries || []).filter((entry) => Number(entry.status) === Number(id))
  })).filter((group) => group.items.length);

  const providerNav = (
    <div className="flex gap-2 mb-5" role="tablist" aria-label={t('Apps de seguimiento')}>
      <Button variant="secondary" size="sm" role="tab" aria-selected="false" onClick={() => onProviderChange?.('anilist')}>AniList</Button>
      <Button size="sm" role="tab" aria-selected="true" onClick={() => onProviderChange?.('comick')}>Comick</Button>
    </div>
  );

  if (!auth.connected) {
    return (
      <div className="min-h-full flex flex-col">
        {providerNav}
        <div className="min-h-[55vh] -translate-y-6 grid place-items-center">
          <EmptyState
            face="（・_・）"
            tone="prompt"
            title={t('Conecta tu cuenta de Comick')}
            action={(
              <Button onClick={returnToSettings}>
                {embedded && <ArrowLeft className="mr-2 h-4 w-4" />}
                {t(embedded ? 'Volver' : 'Ir a Ajustes')}
              </Button>
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      {providerNav}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="rounded-full shrink-0" style={{ width: px(36, scale, 30), height: px(36, scale, 30) }} /> : <span className="rounded-full bg-secondary grid place-items-center font-bold shrink-0" style={{ width: px(36, scale, 30), height: px(36, scale, 30) }}>C</span>}
          <div className="min-w-0">
            <h1 className="font-bold tracking-tight leading-tight" style={{ fontSize: fontPx(18, scale) }}>{t('Tu lista en Comick')}</h1>
            <p className="truncate text-muted-foreground" style={{ fontSize: fontPx(12, scale) }}>{profile?.username || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={returnToSettings}>
            {embedded ? <ArrowLeft className="mr-2 h-4 w-4" /> : <Settings2 className="mr-2 h-4 w-4" />}
            {t(embedded ? 'Volver' : 'Ajustes')}
          </Button>
          <Button variant="secondary" size="sm" onClick={load} disabled={busy}><RefreshCw className={cn('mr-2 h-4 w-4', busy && 'animate-spin')} />{t('Actualizar')}</Button>
          <Button variant="outline" size="sm" className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={async () => { await comickSession.logout(); setAuth(comickSession.status()); setProfile(null); setEntries(null); }}><LogOut className="mr-2 h-4 w-4" />{t('Desconectar')}</Button>
        </div>
      </div>
      {!auth.canWrite && <p className="mb-4 text-sm text-muted-foreground">{t('Permiso de escritura no concedido. Comick no recibirá cambios de progreso.')}</p>}
      {err && <p role="alert" className="mb-4 text-sm text-destructive">{err}</p>}
      {busy && !entries && <div className="grid place-items-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      {!busy && !entries && !err && <EmptyState face="（・_・）" tone="error" title={t('No se pudo cargar tu lista')} action={<Button variant="secondary" onClick={load}>{t('Reintentar')}</Button>} />}
      {entries?.length === 0 && !busy && <EmptyState face="（　´_ゝ`）" tone="prompt" title={t('Tu lista de manga está vacía')} />}
      {groups.map((group) => (
        <section key={group.id} className="mb-8">
          <div className="mb-3 flex items-center gap-2 border-b border-border/70 pb-2">
            <h2 className="text-sm font-semibold tracking-tight">{t(group.label)}</h2>
            <Badge variant="outline">{group.items.length}</Badge>
          </div>
          <div className="flex flex-col gap-2">
            {group.items.map((entry) => {
              const local = localByComick.get(entry.hid);
              const row = (
                <>
                  {entry.cover_url ? (
                    <img
                      src={entry.cover_url}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="manga-cover-corners shrink-0 rounded-md bg-black object-cover shadow-sm ring-1 ring-border/70"
                      style={{ width: px(52 * coverScale, scale, 35), height: px(72 * coverScale, scale, 49) }}
                    />
                  ) : (
                    <div className="manga-cover-corners grid shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground" style={{ width: px(52 * coverScale, scale, 35), height: px(72 * coverScale, scale, 49) }}>
                      <BookOpen className="h-5 w-5 opacity-40" />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                    <div className="truncate font-semibold leading-snug" style={{ fontSize: fontPx(15, scale) }}>{titleOf(entry)}</div>
                    <div className="truncate text-muted-foreground" style={{ fontSize: fontPx(12, scale) }}>{progressLabel(entry, t)}</div>
                  </div>
                  {local && <Badge variant="outline" className="hidden shrink-0 items-center gap-1 sm:inline-flex"><BookOpen className="h-3 w-3" />{t('Vinculado')}</Badge>}
                  {entry.url && (
                    <button
                      type="button"
                      aria-label={t('Abrir en Comick')}
                      title={t('Abrir en Comick')}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(event) => { event.preventDefault(); event.stopPropagation(); window.open(entry.url, '_blank', 'noopener,noreferrer'); }}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  )}
                </>
              );
              const className = 'group flex min-w-0 items-center gap-4 rounded-xl border border-border bg-card/70 px-3 py-3 transition-colors sm:px-4 hover:border-primary/40 hover:bg-accent/40';
              return local ? (
                <Link
                  key={entry.hid}
                  to={`/manga?u=${encodeURIComponent(local.url)}&s=${encodeURIComponent(local.sourceId || 'leercapitulo')}&from=seguimiento`}
                  className={cn(className, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}
                >
                  {row}
                </Link>
              ) : (
                <div key={entry.hid} className={className}>{row}</div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
