import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, ArrowUpDown } from 'lucide-react';
import { lib } from '../lib/library.js';
import { settings } from '../lib/settings.js';
import MangaCard from '../components/MangaCard.jsx';
import VirtualMangaGrid from '../components/VirtualMangaGrid.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { extensions, isAdultExtension } from '../lib/extensions.js';
import { checkLibrary } from '../lib/notify.js';
import { progress } from '../lib/progress.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { tracking } from '../lib/tracking.js';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { Button } from '../components/ui/button.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';
import { discardLibraryCover, getLibraryCover, preloadLibraryCover } from '../lib/covers.js';
import { libraryScroll, recallCover } from '../lib/searchState.js';

let sessionCategoria = '';
let libraryCheckInFlight = false;
let libraryCheckCooldownUntil = 0;

const remainingLibraryCheckCooldown = () => Math.max(0, Math.ceil((libraryCheckCooldownUntil - Date.now()) / 1000));
const sourceIdFor = (manga) => {
  const id = manga.sourceId || 'leercapitulo';
  return extensions.resolveInstalledSource(id, manga.sourceName, manga.url) || id;
};

function CachedLibraryCover({ cover, title, className }) {
  const [coverState, setCoverState] = useState(() => ({ key: cover, src: getLibraryCover(cover) || cover }));
  const src = coverState.key === cover ? coverState.src : getLibraryCover(cover) || cover;

  return (
    <img
      src={src}
      alt={title}
      loading="lazy"
      decoding="sync"
      fetchPriority="high"
      referrerPolicy="no-referrer"
      className={className}
      onLoad={() => {
        if (src !== cover || !/^(https?:\/\/|data:image\/)/i.test(cover || '')) return;
        preloadLibraryCover(cover);
      }}
      onError={() => {
        if (src !== cover) {
          discardLibraryCover(cover, src);
          setCoverState({ key: cover, src: cover });
        }
      }}
    />
  );
}

export default function Library({ active = true }) {
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
  const unreadCheckedAt = useRef(new Map());
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
    const updates = [];
    const reassigned = new Set();
    favs.forEach((m) => {
      const currentId = m.sourceId || 'leercapitulo';
      const resolvedId = extensions.resolveInstalledSource(currentId, m.sourceName, m.url);
      if (resolvedId && resolvedId !== currentId) {
        const key = `${currentId}|${resolvedId}`;
        if (!reassigned.has(key)) {
          progress.reassignSource(currentId, resolvedId);
          tracking.reassignSource(currentId, resolvedId);
          chapterIndex.reassignSource(currentId, resolvedId);
          reassigned.add(key);
        }
        updates.push({ url: m.url, sourceId: currentId, patch: { sourceId: resolvedId } });
      }
      const manifest = extensions.manifest(resolvedId || currentId);
      const patch = {};
      if ((!m.sourceName || (/^(mihon-\d+|Fuente Mihon \d+)$/i.test(String(m.sourceName)) && !/^(mihon-|Fuente Mihon)/i.test(String(manifest.name || '')))) && manifest.name) {
        patch.sourceName = manifest.name;
      }
      if (!m.sourceIcon && manifest.icon) patch.sourceIcon = manifest.icon;
      if (Object.keys(patch).length) updates.push({ url: m.url, sourceId: currentId, patch });
    });
    if (updates.length) setFavs(lib.updateFavs(updates));
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

  useLayoutEffect(() => {
    if (!active) return undefined;
    const main = document.querySelector('main');
    if (!main) return undefined;
    const restore = () => { main.scrollTop = libraryScroll.get(sel); };
    const save = () => libraryScroll.set(sel, main.scrollTop);
    restore();
    const frame = requestAnimationFrame(restore);
    main.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      cancelAnimationFrame(frame);
      main.removeEventListener('scroll', save);
    };
  }, [sel, active]);

  const inCategory = useMemo(() => favs.filter((f) => (f.cats || []).includes(sel)), [favs, sel]);

  const shown = useMemo(
    () => {
      const list = inCategory.slice();
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
    [inCategory, sortBy, unread]
  );

  useEffect(() => {
    if (!showUnread) return undefined;
    let alive = true;
    (async () => {
      const pending = inCategory.filter((f) => {
        const sid = sourceIdFor(f);
        return extensions.isInstalled(sid) && unreadCheckedAt.current.get(`${sid}|${f.url}`) !== progressTick;
      });
      const results = [];
      for (let i = 0; i < pending.length; i += 3) {
        const batch = await Promise.all(pending.slice(i, i + 3).map(async (f) => {
          const sid = sourceIdFor(f);
          const k = `${sid}|${f.url}`;
          let urls = chapterIndex.get(f.url, sid);
          if (!urls) {
            const d = api.peekDetail(f.url, sid);
            if (!d || !Array.isArray(d.chapters)) return null;
            urls = d.chapters.map((c) => c.url);
            chapterIndex.set(f.url, sid, urls);
          }
          const n = urls.reduce((acc, u) => acc + (progress.get(u, sid)?.read ? 0 : 1), 0);
          return [k, n];
        }));
        if (!alive) return;
        results.push(...batch);
      }
      if (!alive) return;
      setUnread((prev) => {
        let next = prev;
        for (const entry of results) {
          if (!entry) continue;
          unreadCheckedAt.current.set(entry[0], progressTick);
          if (prev[entry[0]] === entry[1]) continue;
          if (next === prev) next = { ...prev };
          next[entry[0]] = entry[1];
        }
        return next;
      });
    })();
    return () => { alive = false; };
  }, [inCategory, progressTick, showUnread]);

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
        <VirtualMangaGrid
          items={shown}
          coverSize={cs}
          scale={scale}
          active={active}
          renderCard={(m) => {
            const sid = sourceIdFor(m);
            const adultBlocked = !showAdultExtensions && isAdultExtension(extensions.manifest(sid));
            const cover = recallCover(m.url) || m.cover;
            return (
              <MangaCard
                key={`${sid}|${m.url}`}
                m={m.cover === cover ? m : { ...m, cover }}
                sourceId={sid}
                unavailable={!extensions.isInstalled(sid) || adultBlocked}
                unavailableLabel={adultBlocked ? 'Fuente bloqueada' : 'Fuente no instalada'}
                minimal
                from="biblioteca"
                coverSize={cs}
                chapterCount={showUnread ? unread[`${sid}|${m.url}`] ?? null : null}
              />
            );
          }}
        />
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${px(260, scale, 230)}), 1fr))` }}
        >
          {shown.map((m) => {
            const sid = sourceIdFor(m);
            const cover = recallCover(m.url) || m.cover;
            const unreadCount = unread[`${sid}|${m.url}`];
            const sourceManifest = extensions.manifest(sid);
            const savedSourceName = String(m.sourceName || '');
            const manifestSourceName = String(sourceManifest.name || '');
            const hasSavedSourceName = savedSourceName && !/^(mihon-\d+|Fuente Mihon \d+)$/i.test(savedSourceName);
            const sourceInfo = {
              ...sourceManifest,
              name: hasSavedSourceName
                ? savedSourceName
                : (manifestSourceName && !/^(mihon-|Fuente Mihon)/i.test(manifestSourceName) ? manifestSourceName : sid),
              icon: sourceManifest.icon || m.sourceIcon
            };
            const adultBlocked = !showAdultExtensions && isAdultExtension(sourceManifest);
            const unavailable = !extensions.isInstalled(sid) || adultBlocked;
            return (
              <div key={`${sid}|${m.url}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
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
                    {cover && (
                      <CachedLibraryCover cover={cover} title={m.title} className="w-full h-full object-cover bg-black" />
                    )}
                    {unavailable && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 px-0.5 text-center text-[8px] font-semibold leading-tight text-white">
                        <span>{adultBlocked ? 'Fuente bloqueada' : 'Fuente no instalada'}</span>
                        <span className="flex max-w-full min-w-0 items-center rounded-full bg-black/80 py-0.5 pl-0.5 pr-1 text-left" style={{ gap: px(4, scale, 3) }} title={sourceInfo.name}>
                          <SourceBadge m={sourceInfo} className="rounded-full bg-white shadow-sm" style={{ width: px(18, scale, 16), height: px(18, scale, 16), fontSize: px(8, scale, 7) }} />
                          <span className="min-w-0 truncate" style={{ fontSize: px(8, scale, 7) }}>{sourceInfo.name}</span>
                        </span>
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

