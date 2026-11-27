import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, AlertTriangle, LogOut, BookOpen, ArrowLeft } from 'lucide-react';
import { session } from '../lib/session.js';
import { anilistList, setScoreScale } from '../lib/anilist.js';
import { lib } from '../lib/library.js';
import { tracking } from '../lib/tracking.js';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px, fontPx } from '../lib/useScale.js';
import { settings } from '../lib/settings.js';
import { useResponsiveCoverSize } from '../lib/useResponsiveCoverSize.js';
import { useI18n } from '../lib/i18n.js';
import ComickTracking from '../components/ComickTracking.jsx';

const STATUS_ES = {
  CURRENT: 'Leyendo',
  PLANNING: 'Planeando',
  COMPLETED: 'Completado',
  DROPPED: 'Abandonado',
  PAUSED: 'En pausa',
  REPEATING: 'Repitiendo'
};

const STATUS_ORDER = ['CURRENT', 'PLANNING', 'PAUSED', 'REPEATING', 'COMPLETED', 'DROPPED'];
const SCORE_DENOMINATOR = {
  POINT_100: 100,
  POINT_10: 10,
  POINT_10_DECIMAL: 10,
  POINT_5: 5,
  POINT_3: 3
};

export default function Tracking({ embedded = false, provider: embeddedProvider, onProviderChange, onBack }) {
  const location = useLocation();
  const navigate = useNavigate();
  const provider = embedded ? embeddedProvider : new URLSearchParams(location.search).get('provider');
  const changeProvider = (nextProvider) => {
    if (embedded) onProviderChange?.(nextProvider);
    else navigate(nextProvider === 'comick' ? '/seguimiento?provider=comick' : '/seguimiento');
  };
  return provider === 'comick'
    ? <ComickTracking embedded={embedded} onProviderChange={changeProvider} onBack={onBack} />
    : <AniListTracking embedded={embedded} onProviderChange={changeProvider} onBack={onBack} />;
}

function AniListTracking({ embedded = false, onProviderChange, onBack }) {
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [auth, setAuth] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [entries, setEntries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [coverSize, setCoverSize] = useState(() => settings.get().coverSize);
  const coverScale = useResponsiveCoverSize(coverSize) / 160;
  const scale = useScale();
  const scoreDenominator = SCORE_DENOMINATOR[viewer?.scoreFormat] || 10;
  const returnToSettings = () => embedded ? onBack?.() : navigate('/ajustes');
  const providerNav = (
    <div className="flex gap-2 mb-5" role="tablist" aria-label={t('Apps de seguimiento')}>
      <Button size="sm" role="tab" aria-selected="true" onClick={() => onProviderChange?.('anilist')}>AniList</Button>
      <Button variant="secondary" size="sm" role="tab" aria-selected="false" onClick={() => onProviderChange?.('comick')}>Comick</Button>
    </div>
  );

  useEffect(() => settings.subscribe((s) => setCoverSize(s.coverSize)), []);

  const load = async () => {
    setBusy(true);
    setErr('');
    try {
      const v = await session.viewer();
      if (!v) throw new Error('No se pudo leer tu usuario de AniList. Vuelve a conectar la cuenta.');
      if (v.scoreFormat) setScoreScale(v.scoreFormat);
      const list = await anilistList.myList();
      setEntries(list);
    } catch (e) {
      setErr(String(e?.message || e));
      setEntries(null);
    }
    setBusy(false);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await session.status();
      if (!alive) return;
      setAuth(s);
      if (!s.connected) return;
      const v = await session.viewer();
      if (!alive) return;
      setViewer(v);
      await load();
    })();
    return () => { alive = false; };
  }, []);

  const localByAnilist = useMemo(() => {
    const map = new Map();
    for (const f of lib.favs()) {
      const linked = tracking.get(f.url, f.sourceId || 'leercapitulo');
      if (linked?.id && !map.has(linked.id)) map.set(linked.id, f);
    }
    return map;
  }, [entries]);

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: (entries || []).filter((e) => e.status === status)
  })).filter((g) => g.items.length);

  if (auth && !auth.connected) {
    return (
      <div className="min-h-full flex flex-col">
        {providerNav}
        <div className="min-h-[55vh] flex-1 -translate-y-6 grid place-items-center">
          <EmptyState
            face="（・_・）"
            tone="prompt"
            title={t('Conecta tu cuenta de AniList')}
            action={
              <Button
                onClick={returnToSettings}
                style={{
                  height: px(40, scale, 33),
                  fontSize: fontPx(14, scale, 12),
                  paddingLeft: px(16, scale, 12),
                  paddingRight: px(16, scale, 12)
                }}
              >
                {embedded && <ArrowLeft className="mr-2 h-4 w-4" />}
                {t(embedded ? 'Volver' : 'Ir a Ajustes')}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      {providerNav}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {viewer?.avatar?.medium ? (
            <img
              src={viewer.avatar.medium}
              alt=""
              className="rounded-full shrink-0"
              style={{ width: `${Math.round(36 * scale)}px`, height: `${Math.round(36 * scale)}px` }}
            />
          ) : (
            <span
              className="rounded-full bg-secondary grid place-items-center font-bold shrink-0"
              style={{ width: `${Math.round(36 * scale)}px`, height: `${Math.round(36 * scale)}px` }}
            >
              A
            </span>
          )}
          <div>
            <h1 className="font-bold tracking-tight leading-tight" style={{ fontSize: fontPx(18, scale) }}>
              {language === 'en' ? 'Your AniList list' : 'Tu lista en AniList'}
            </h1>
            <p className="text-muted-foreground" style={{ fontSize: fontPx(12, scale) }}>
              {viewer?.name || '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={returnToSettings}>
            {embedded && <ArrowLeft className="mr-2 h-4 w-4" />}
            {t(embedded ? 'Volver' : 'Ajustes')}
          </Button>
          <Button variant="secondary" size="sm" onClick={load} disabled={busy}>
            <Loader2 className="w-4 h-4 mr-2" />
            {t('Actualizar')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={async () => {
              await session.logout();
              setAuth({ connected: false });
              setEntries(null);
              setViewer(null);
            }}
          >
            <LogOut className="w-4 h-4 mr-2" /> {t('Desconectar')}
          </Button>
        </div>
      </div>

      {auth?.expired && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {t('La sesión anterior caducó. Vuelve a conectar tu cuenta en Ajustes.')}
        </p>
      )}

      {err && (
        <p className="flex items-center gap-2 text-sm text-destructive mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {err}
        </p>
      )}

      {busy && !entries && (
        <div className="grid place-items-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {!busy && !entries && !err && (
        <EmptyState
          face="（・_・）"
          tone="error"
          title={t('No se pudo cargar tu lista')}
          action={
            <Button variant="secondary" onClick={load} disabled={busy}>
              {t('Reintentar')}
            </Button>
          }
        />
      )}

      {entries && entries.length === 0 && !busy && (
        <EmptyState
          face="（　´_ゝ`）"
          tone="prompt"
          title={t('Tu lista de manga está vacía')}
        />
      )}

      {grouped.map((g) => (
        <section key={g.status} className="mb-8">
          <div className="mb-3 flex items-center gap-2 border-b border-border/70 pb-2">
            <h2 className="text-sm font-semibold tracking-tight">{t(STATUS_ES[g.status] || g.status)}</h2>
            <Badge variant="outline">{g.items.length}</Badge>
          </div>
          <div className="flex flex-col gap-2">
            {g.items.map((e) => {
              const local = localByAnilist.get(e.mediaId);
              const row = (
                <>
                  {e.cover ? (
                    <img
                      src={e.cover}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="manga-cover-corners shrink-0 rounded-md bg-black object-cover shadow-sm ring-1 ring-border/70"
                      style={{ width: px(52 * coverScale, scale, 35), height: px(72 * coverScale, scale, 49) }}
                    />
                  ) : (
                    <div
                      className="manga-cover-corners grid shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"
                      style={{ width: px(52 * coverScale, scale, 35), height: px(72 * coverScale, scale, 49) }}
                    ><BookOpen className="h-5 w-5 opacity-40" /></div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                    <div className="truncate font-semibold leading-snug" style={{ fontSize: fontPx(15, scale) }}>
                      {e.title}
                    </div>
                    <div className="truncate text-muted-foreground" style={{ fontSize: fontPx(12, scale) }}>
                      {e.progress} {e.progress === 1 ? t('capítulo') : t('capítulos')}{e.startedAt && ` · desde ${e.startedAt}`}
                    </div>
                  </div>
                  {e.score != null && (
                    <Badge variant="default" className="shrink-0">{e.score}/{scoreDenominator}</Badge>
                  )}
                  {local && (
                    <Badge variant="outline" className="hidden shrink-0 items-center gap-1 sm:inline-flex">
                      <BookOpen className="h-3 w-3" />{t('En biblioteca')}
                    </Badge>
                  )}
                </>
              );
              const cls = 'group flex min-w-0 items-center gap-4 rounded-xl border border-border bg-card/70 px-3 py-3 transition-colors sm:px-4 hover:border-primary/40 hover:bg-accent/40';
              return local ? (
                <Link
                  key={e.mediaId}
                  to={`/manga?u=${encodeURIComponent(local.url)}&s=${encodeURIComponent(local.sourceId || 'leercapitulo')}&from=seguimiento`}
                  className={cn(cls, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}
                >
                  {row}
                </Link>
              ) : (
                <div key={e.mediaId} className={cls}>
                  {row}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

