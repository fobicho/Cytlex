import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, ArrowUpDown } from 'lucide-react';
import { lib } from '../lib/library.js';
import { settings } from '../lib/settings.js';
import MangaCard from '../components/MangaCard.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { extensions, isAdultExtension } from '../lib/extensions.js';
import { makeCoverThumb } from '../lib/covers.js';
import { checkLibrary } from '../lib/notify.js';
import { progress } from '../lib/progress.js';
import { tracking } from '../lib/tracking.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { Button } from '../components/ui/button.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

let sessionCategoria = '';
let libraryCheckInFlight = false;
let libraryCheckCooldownUntil = 0;

const remainingLibraryCheckCooldown = () => Math.max(0, Math.ceil((libraryCheckCooldownUntil - Date.now()) / 1000));

export default function Library() {
  const [cats, setCats] = useState(() => lib.cats());
  const [sel, setSel] = useState(() => {
    const list = lib.cats();
    return sessionCategoria && list.some((c) => c.id === sessionCategoria) ? sessionCategoria : list[0]?.id || '';
  });
  const [favs, setFavs] = useState(() => lib.favs());
  const [view, setView] = useState(settings.get().libraryView);
  const [checking, setChecking] = useState(libraryCheckInFlight);
  const [checkCooldown, setCheckCooldown] = useState(remainingLibraryCheckCooldown);
  const { toast } = useToast();
  const [coverSize, setCoverSize] = useState(() => Math.round(160 * (settings.get().uiScale || 1)));
  const [showUnread, setShowUnread] = useState(() => settings.get().libraryShowUnread);
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('cytlex:librarySort') || 'title-asc');
  const [unread, setUnread] = useState({});
  const scale = useScale();
  const [progressTick, setProgressTick] = useState(0);
  useEffect(() => progress.subscribe(() => setProgressTick((t) => t + 1)), []);
  useEffect(
    () => settings.subscribe((s) => {
      setCoverSize(Math.round(160 * (s.uiScale || 1)));
      setShowUnread(s.libraryShowUnread);
      setShowAdultExtensions(!!s.showAdultExtensions);
    }),
    []
  );
  useEffect(() => {
    let changed = false;
    favs.forEach((m) => {
      const manifest = extensions.manifest(m.sourceId || 'leercapitulo');
      const patch = {};
      if (!m.sourceName && manifest.name) patch.sourceName = manifest.name;
      if (!m.sourceIcon && manifest.icon) patch.sourceIcon = manifest.icon;
      if (Object.keys(patch).length) {
        lib.updateFav(m.url, patch, m.sourceId || 'leercapitulo');
        changed = true;
      }
    });
    if (changed) setFavs(lib.favs());
  }, []);

  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);

  const runCheck = async () => {
    if (libraryCheckInFlight || remainingLibraryCheckCooldown() > 0) return;
    libraryCheckInFlight = true;
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
      libraryCheckInFlight = false;
      libraryCheckCooldownUntil = Date.now() + 3_000;
      setChecking(false);
      setCheckCooldown(3);
    }
  };

  useEffect(() => {
    if (!checking && !checkCooldown) return undefined;
    const timer = window.setInterval(() => {
      setChecking(libraryCheckInFlight);
      setCheckCooldown(remainingLibraryCheckCooldown());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [checking, checkCooldown]);

  useEffect(() => settings.subscribe((s) => setView(s.libraryView)), []);
  useEffect(() => {
    if (cats.some((c) => c.id === sel)) {
      sessionCategoria = sel;
      return;
    }
    setSel(cats[0]?.id || '');
  }, [cats, sel]);

  const shown = useMemo(
    () => {
      const list = favs.filter((f) => (f.cats || []).includes(sel)).slice();
      const cmp = (a, b) => {
        switch (sortBy) {
          case 'title-desc':
            return String(b.title || '').localeCompare(String(a.title || ''), 'es', { sensitivity: 'base', numeric: true });
          case 'unread-desc':
            return (unread[`${b.sourceId || 'leercapitulo'}|${b.url}`] ?? 0) - (unread[`${a.sourceId || 'leercapitulo'}|${a.url}`] ?? 0);
          case 'recent':
            return (b.addedAt || 0) - (a.addedAt || 0);
          default:
            return String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base', numeric: true });
        }
      };
      return list.sort(cmp);
    },
    [favs, sel, sortBy, unread, progressTick]
  );

  useEffect(() => {
    if (!showUnread) return undefined;
    let alive = true;
    (async () => {
      const pending = favs.filter((f) => (f.cats || []).includes(sel)).filter((f) => extensions.isInstalled(f.sourceId || 'leercapitulo'));
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
        const next = { ...prev };
        for (const entry of results) if (entry) next[entry[0]] = entry[1];
        return next;
      });
    })();
    return () => { alive = false; };
  }, [favs, sel, progressTick, showUnread]);

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

  useEffect(() => {
    if (!settings.get().anilistCover) return undefined;
    let cancelled = false;
    (async () => {
      const pending = shown.filter((f) => {
        const t = tracking.get(f.url, f.sourceId || 'leercapitulo');
        return t?.cover && !t?.coverLocal;
      });
      const thumbs = await Promise.all(
        pending.map(async (f) => {
          const sid = f.sourceId || 'leercapitulo';
          const t = tracking.get(f.url, sid);
          return [f, sid, t?.cover, await makeCoverThumb(t?.cover)];
        })
      );
      if (cancelled) return;
      let changed = false;
      for (const [f, sid, url, local] of thumbs) {
        if (local) {
          tracking.updateCover(f.url, sid, { coverLocal: local });
          changed = true;
        }
      }
      if (changed) setFavs(lib.favs());
    })();
    return () => { cancelled = true; };
  }, [shown, settings.get().anilistCover]);

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
        <div className="ml-auto self-center flex items-center" style={{ gap: px(8, scale, 6) }}>
          <Button
            size="sm"
            variant="secondary"
            title="Ordenar"
            className="rounded-md disabled:opacity-100"
            onClick={() => {
              const order = ['title-asc', 'title-desc', 'unread-desc', 'recent'];
              const next = order[(order.indexOf(sortBy) + 1) % order.length];
              setSortBy(next);
              try { localStorage.setItem('cytlex:librarySort', next); } catch {}
            }}
            style={{
              height: px(36, scale, 30),
              fontSize: `${Math.round(14 * scale)}px`,
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          >
            <ArrowUpDown
              className="mr-2"
              style={{ width: `${Math.round(16 * scale)}px`, height: `${Math.round(16 * scale)}px` }}
            />
            {sortBy === 'title-asc' ? 'A-Z' : sortBy === 'title-desc' ? 'Z-A' : sortBy === 'unread-desc' ? 'Sin leer' : 'Recientes'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!favs.length}
            onClick={runCheck}
            title={checkCooldown ? `Puedes volver a buscar en ${checkCooldown} s` : 'Buscar actualizaciones'}
            className="rounded-md"
            style={{
              opacity: 1,
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
          title={favs.some((f) => (f.cats || []).includes(sel)) ? 'No hay mangas visibles con este filtro' : 'Tu biblioteca está vacía'}
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
            const adultBlocked = !showAdultExtensions && isAdultExtension(extensions.manifest(sid));
            return (
              <MangaCard
                key={i}
                m={m}
                sourceId={sid}
                unavailable={!extensions.isInstalled(sid) || adultBlocked}
                unavailableLabel={adultBlocked ? 'Fuente bloqueada' : 'Fuente no instalada'}
                minimal
                from="biblioteca"
                coverSize={cs}
                chapterCount={showUnread ? unread[`${sid}|${m.url}`] ?? null : null}
              />
            );
          })}
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${px(260, scale, 230)}), 1fr))` }}
        >
          {shown.map((m, i) => {
            const sid = m.sourceId || 'leercapitulo';
            const unreadCount = unread[`${sid}|${m.url}`];
            const sourceManifest = extensions.manifest(sid);
            const sourceInfo = {
              ...sourceManifest,
              name: m.sourceName || sourceManifest.name || sid,
              icon: sourceManifest.icon || m.sourceIcon
            };
            const adultBlocked = !showAdultExtensions && isAdultExtension(sourceManifest);
            const unavailable = !extensions.isInstalled(sid) || adultBlocked;
            return (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
                <a
                  href={`#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sid)}&from=biblioteca`}
                  className={cn('flex items-end gap-3 flex-1 min-w-0', unavailable && 'pointer-events-none opacity-60')}
                  aria-disabled={unavailable}
                  tabIndex={unavailable ? -1 : undefined}
                >
                  <span
                    className="relative rounded-lg shrink-0 overflow-hidden bg-muted"
                    style={{ width: px(68, scale, 56), height: px(102, scale, 82) }}
                  >
                    {m.cover && (
                      <img
                        src={m.cover}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover bg-black"
                      />
                    )}
                    {unavailable && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 px-0.5 text-center text-[8px] font-semibold leading-tight text-white">
                        <span>{adultBlocked ? 'Fuente bloqueada' : 'Fuente no instalada'}</span>
                        <SourceBadge m={sourceInfo} className="!h-5 !w-5 rounded bg-white shadow-sm" />
                      </span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate" style={{ fontSize: px(16, scale, 13) }}>{m.title}</span>
                    {showUnread && unreadCount != null && (
                      <span className="mt-1 block truncate text-muted-foreground" style={{ fontSize: px(12, scale, 10) }}>
                        {unreadCount > 0 ? `${unreadCount} sin leer` : 'Lectura al día'}
                      </span>
                    )}
                  </span>
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

