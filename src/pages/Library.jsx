import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { lib } from '../lib/library.js';
import { settings } from '../lib/settings.js';
import MangaCard from '../components/MangaCard.jsx';
import { extensions } from '../lib/extensions.js';
import { makeCoverThumb } from '../lib/covers.js';
import { checkLibrary } from '../lib/notify.js';
import { progress } from '../lib/progress.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { Button } from '../components/ui/button.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

let sessionCategoria = '';

export default function Library() {
  const [cats, setCats] = useState(() => lib.cats());
  const [sel, setSel] = useState(() => {
    const list = lib.cats();
    return sessionCategoria && list.some((c) => c.id === sessionCategoria) ? sessionCategoria : list[0]?.id || '';
  });
  const [favs, setFavs] = useState(() => lib.favs());
  const [view, setView] = useState(settings.get().libraryView);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();
  const [coverSize, setCoverSize] = useState(() => settings.get().libraryCoverSize);
  const [showUnread, setShowUnread] = useState(() => settings.get().libraryShowUnread);
  const [unread, setUnread] = useState({});
  const scale = useScale();
  const [progressTick, setProgressTick] = useState(0);
  useEffect(() => progress.subscribe(() => setProgressTick((t) => t + 1)), []);
  useEffect(
    () => settings.subscribe((s) => {
      setCoverSize(s.libraryCoverSize);
      setShowUnread(s.libraryShowUnread);
    }),
    []
  );

  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);

  const runCheck = async () => {
    setChecking(true);
    try {
      const found = await checkLibrary({ silent: true, force: true });
      const n = found.length;
      if (n === 0) {
        toast({ title: 'Todo está al día', description: 'No hay capítulos nuevos en tu biblioteca.', variant: 'info' });
      } else {
        toast({
          title: n === 1 ? '1 obra actualizada' : `${n} obras actualizadas`,
          description: 'Hay capítulos nuevos disponibles.',
          variant: 'success'
        });
      }
    } catch {
      toast({ title: 'No se pudo comprobar', description: 'Revisa tu conexión e inténtalo de nuevo.', variant: 'error' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => settings.subscribe((s) => setView(s.libraryView)), []);
  useEffect(() => {
    if (cats.some((c) => c.id === sel)) {
      sessionCategoria = sel;
      return;
    }
    setSel(cats[0]?.id || '');
  }, [cats, sel]);

  const remove = (manga) => {
    lib.toggleFav(manga);
    setFavs(lib.favs());
  };

  const shown = useMemo(
    () =>
      favs
        .filter((f) => (f.cats || []).includes(sel))
        .slice()
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base', numeric: true })),
    [favs, sel]
  );

  useEffect(() => {
    if (!showUnread) return undefined;
    let alive = true;
    (async () => {
      const pending = shown.filter((f) => extensions.isInstalled(f.sourceId || 'leercapitulo'));
      const results = await Promise.all(
        pending.map(async (f) => {
          const sid = f.sourceId || 'leercapitulo';
          const k = `${sid}|${f.url}`;
          let urls = chapterIndex.get(f.url, sid);
          if (!urls) {
            let d = api.peekDetail(f.url, sid);
            if (!d) {
              try { d = await api.detail(f.url, sid); } catch { chapterIndex.drop(f.url, sid); return null; }
            }
            if (!d || !Array.isArray(d.chapters)) return null;
            urls = d.chapters.map((c) => c.url);
            chapterIndex.set(f.url, sid, urls);
          }
          const n = urls.reduce((acc, u) => acc + (progress.get(u, sid)?.read ? 0 : 1), 0);
          return [k, n];
        })
      );
      if (!alive) return;
      setUnread((prev) => {
        const next = {};
        for (const entry of results) if (entry) next[entry[0]] = entry[1];
        return next;
      });
    })();
    return () => { alive = false; };
  }, [shown, progressTick, showUnread]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = shown.filter((f) => f.cover && !(f.coverLocal || '').startsWith('data:'));
      const thumbs = await Promise.all(
        pending.map(async (f) => [f, await makeCoverThumb(f.cover)])
      );
      if (cancelled) return;
      let changed = false;
      for (const [f, local] of thumbs) {
        if (local) {
          lib.updateFav(f.url, { coverLocal: local }, f.sourceId);
          changed = true;
        }
      }
      if (changed) setFavs(lib.favs());
    })();
    return () => { cancelled = true; };
  }, [shown]);

  return (
    <div className="min-h-full flex flex-col">
      <div
        className="-mt-1 flex flex-wrap items-center mb-3"
        style={{
          gap: `${Math.max(16, Math.round(24 * scale))}px`,
          marginBottom: `${Math.max(8, Math.round(12 * scale))}px`,
          minHeight: px(36, scale, 30)
        }}
      >
        {cats.map((c) => {
          const active = c.id === sel;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSel(c.id)}
              className={cn(
                'relative font-medium transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              style={{
                fontSize: `${Math.round(14 * scale)}px`,
                paddingBottom: px(8, scale, 6)
              }}
            >
              {c.name}
              {active && (
                <motion.span
                  layoutId="cat-underline"
                  className="absolute left-0 right-0 bottom-0 rounded-full bg-primary"
                  style={{ height: `${Math.max(1.5, Math.round(2 * scale))}px` }}
                  transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
                />
              )}
            </button>
          );
        })}
        <div className="ml-auto self-center">
          <Button
            size="sm"
            variant="secondary"
            disabled={checking || !favs.length}
            onClick={runCheck}
            title="Buscar actualizaciones"
            className="rounded-lg"
            style={{
              height: px(36, scale, 30),
              fontSize: `${Math.round(14 * scale)}px`,
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          >
            {checking ? (
              <RefreshCw
                className="mr-2 animate-spin"
                style={{ width: `${Math.round(16 * scale)}px`, height: `${Math.round(16 * scale)}px` }}
              />
            ) : (
              <RefreshCw
                className="mr-2"
                style={{ width: `${Math.round(16 * scale)}px`, height: `${Math.round(16 * scale)}px` }}
              />
            )}
            {checking ? 'Buscando…' : 'Buscar actualizaciones'}
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          face="(っ-;)"
          tone="sad"
          title="Tu biblioteca está vacía"
        />
      ) : view === 'grid' ? (
        <div
          className="grid gap-x-5 gap-y-8"
          style={{
            gridTemplateColumns: `repeat(auto-fill, ${cs}px)`,
            gap: `${Math.max(16, Math.round(20 * scale))}px ${Math.max(12, Math.round(20 * scale))}px`
          }}
        >
          {shown.map((m, i) => {
            const sid = m.sourceId || 'leercapitulo';
            return (
              <MangaCard
                key={i}
                m={m}
                sourceId={sid}
                unavailable={!extensions.isInstalled(sid)}
                minimal
                from="biblioteca"
                coverSize={cs}
                chapterCount={showUnread ? unread[`${sid}|${m.url}`] ?? null : null}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((m, i) => {
            const sid = m.sourceId || 'leercapitulo';
            const unavailable = !extensions.isInstalled(sid);
            return (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
                <a
                  href={`#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sid)}&from=biblioteca`}
                  className={cn('flex items-center gap-3 flex-1 min-w-0', unavailable && 'pointer-events-none opacity-60')}
                  aria-disabled={unavailable}
                  tabIndex={unavailable ? -1 : undefined}
                >
                  {m.cover && (
                    <img
                      src={m.cover}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-10 h-14 object-cover rounded-lg shrink-0 bg-black"
                    />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{m.title}</span>
                  </span>
                </a>
                <Button variant="ghost" size="sm" onClick={() => remove(m)} title="Quitar de biblioteca">
                  Quitar
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

