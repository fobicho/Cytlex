import { useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, AlertTriangle, LogOut, BookOpen } from 'lucide-react';
import { session } from '../lib/session.js';
import { anilistList, setScoreScale } from '../lib/anilist.js';
import { lib } from '../lib/library.js';
import { tracking } from '../lib/tracking.js';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';

const STATUS_ES = {
  CURRENT: 'Leyendo',
  PLANNING: 'Planeando',
  COMPLETED: 'Completado',
  DROPPED: 'Abandonado',
  PAUSED: 'En pausa',
  REPEATING: 'Repitiendo'
};

const STATUS_ORDER = ['CURRENT', 'PLANNING', 'PAUSED', 'REPEATING', 'COMPLETED', 'DROPPED'];

export default function Tracking() {
  const [auth, setAuth] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [entries, setEntries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
      <div className="min-h-[60vh] grid place-items-center">
        <EmptyState
          face="（・_・）"
          tone="prompt"
          title="Conecta tu cuenta de AniList"
          action={
            <Button onClick={() => { window.location.hash = '#/ajustes'; }}>
              Ir a Ajustes
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {viewer?.avatar?.medium ? (
            <img src={viewer.avatar.medium} alt="" className="w-9 h-9 rounded-full" />
          ) : (
            <span className="w-9 h-9 rounded-full bg-secondary grid place-items-center font-bold">A</span>
          )}
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-tight">Tu lista en AniList</h1>
            {viewer?.name && <p className="text-xs text-muted-foreground">{viewer.name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { window.location.hash = '#/ajustes'; }}>
            Ajustes
          </Button>
          <Button variant="secondary" size="sm" onClick={load} disabled={busy}>
            <Loader2 className="w-4 h-4 mr-2" />
            Actualizar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await session.logout();
              setAuth({ connected: false });
              setEntries(null);
              setViewer(null);
            }}
          >
            <LogOut className="w-4 h-4 mr-2" /> Desconectar
          </Button>
        </div>
      </div>

      {auth?.expired && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          La sesión anterior caducó. Vuelve a conectar tu cuenta en Ajustes.
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
          title="No se pudo cargar tu lista"
          action={
            <Button variant="secondary" onClick={load} disabled={busy}>
              Reintentar
            </Button>
          }
        />
      )}

      {entries && entries.length === 0 && !busy && (
        <EmptyState
          face="（　´_ゝ`）"
          tone="prompt"
          title="Tu lista de manga está vacía"
        />
      )}

      {grouped.map((g) => (
        <section key={g.status} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold">{STATUS_ES[g.status] || g.status}</h2>
            <span className="text-xs text-muted-foreground">· {g.items.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {g.items.map((e) => {
              const local = localByAnilist.get(e.mediaId);
              const row = (
                <>
                  {e.cover ? (
                    <img src={e.cover} alt="" referrerPolicy="no-referrer" className="w-10 h-14 object-cover rounded-lg bg-black shrink-0" />
                  ) : (
                    <div className="w-10 h-14 rounded-lg bg-secondary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{e.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.progress} {e.progress === 1 ? 'capítulo' : 'capítulos'}
                      {e.startedAt && ` · desde ${e.startedAt}`}
                    </div>
                  </div>
                  {e.score != null && (
                    <Badge variant="outline" className="shrink-0">{e.score}/10</Badge>
                  )}
                  {local && <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />}
                </>
              );
              const cls = 'flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5 transition-colors';
              return local ? (
                <a
                  key={e.mediaId}
                  href={`#/manga?u=${encodeURIComponent(local.url)}&s=${encodeURIComponent(local.sourceId || 'leercapitulo')}&from=seguimiento`}
                  className={cn(cls, 'hover:bg-accent/50')}
                >
                  {row}
                </a>
              ) : (
                <div key={e.mediaId} className={cn(cls, 'opacity-70')}>
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

