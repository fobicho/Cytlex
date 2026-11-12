import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, ArrowUpDown } from 'lucide-react';
import { isUnresolvedMihonSource, lib } from '../lib/library.js';
import { settings } from '../lib/settings.js';
import MangaCard from '../components/MangaCard.jsx';
import VirtualMangaGrid from '../components/VirtualMangaGrid.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { extensions, isExtensionAllowed, isUnavailableMangaSource } from '../lib/extensions.js';
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
import { discardLibraryCover, getLibraryCover, markLibraryCoverLoaded, preloadLibraryCover, requiresImageProxy, restoreLibraryCover } from '../lib/covers.js';
import { libraryScroll, recallCover } from '../lib/searchState.js';

let sessionCategoria = '';
let libraryCheckInFlight = false;
let libraryCheckCooldownUntil = 0;
let libraryCheckProgress = { current: 0, total: 0 };
const libraryCheckProgressListeners = new Set();
const UNREAD_CACHE_KEY = 'cytlex:libraryUnread:v2';
const LIBRARY_CATEGORY_KEY = 'cytlex:libraryCategory';
const libraryTitleCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const initialLibraryCategory = (categories) => {
  try {
    const saved = localStorage.getItem(LIBRARY_CATEGORY_KEY);
    if (saved && categories.some((category) => category.id === saved)) return saved;
  } catch {}
  return sessionCategoria && categories.some((category) => category.id === sessionCategoria)
    ? sessionCategoria
    : categories[0]?.id || '';
};
const unreadCountCache = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(UNREAD_CACHE_KEY) || '{}');
    return new Map(Object.entries(saved).filter(([, count]) => Number.isFinite(count) && count >= 0));
  } catch {
    return new Map();
  }
})();

const persistUnreadCountCache = () => {
  try { localStorage.setItem(UNREAD_CACHE_KEY, JSON.stringify(Object.fromEntries(unreadCountCache))); } catch {}
};
if (typeof window !== 'undefined') {
  window.addEventListener('cytlex:library-unread-reset', () => {
    unreadCountCache.clear();
    persistUnreadCountCache();
  });
}

const remainingLibraryCheckCooldown = () => Math.max(0, Math.ceil((libraryCheckCooldownUntil - Date.now()) / 1000));
const updateLibraryCheckProgress = (progress) => {
  libraryCheckProgress = progress;
  libraryCheckProgressListeners.forEach((listener) => listener(progress));
};
const sourceIdFor = (manga) => {
  const id = manga.sourceId || 'leercapitulo';
  return isUnresolvedMihonSource(id)
    ? extensions.resolveInstalledSource(id, manga.sourceName, manga.url) || id
    : id;
};
const mangaUrlKey = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return String(url || '').split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase() || '/';
  }
};
const sameMangaUrl = (left, right) => Boolean(left && right) && mangaUrlKey(left) === mangaUrlKey(right);
const unreadKeyFor = (manga, sourceId = sourceIdFor(manga)) => `${sourceId}|${manga.url}`;
const invalidateUnreadCountsForUrl = (mangaUrl) => {
  if (!mangaUrl) return;
  for (const key of unreadCountCache.keys()) {
    const separator = key.indexOf('|');
    if (separator >= 0 && sameMangaUrl(key.slice(separator + 1), mangaUrl)) unreadCountCache.delete(key);
  }
};
const compareLibraryTitles = (a, b) => libraryTitleCollator.compare(String(a.title || ''), String(b.title || ''));
const sameLibraryFavorites = (left, right) => left.length === right.length && left.every((manga, index) => {
  const next = right[index];
  return manga.url === next.url
    && manga.sourceId === next.sourceId
    && manga.title === next.title
    && manga.author === next.author
    && manga.cover === next.cover
    && (manga.coverLocal || '').length === (next.coverLocal || '').length
    && (manga.coverCached || '').length === (next.coverCached || '').length
    && manga.sourceName === next.sourceName
    && manga.sourceIcon === next.sourceIcon
    && manga.chapterTotal === next.chapterTotal
    && manga.chapterReadCount === next.chapterReadCount
    && manga.addedAt === next.addedAt
    && (manga.cats || []).join('\0') === (next.cats || []).join('\0');
});
const sortLibraryManga = (items, sortBy, unread) => items.sort((a, b) => {
  switch (sortBy) {
    case 'title-desc':
      return compareLibraryTitles(b, a);
    case 'unread-desc':
      return (unread[unreadKeyFor(b)] ?? unreadCountCache.get(unreadKeyFor(b)) ?? 0) - (unread[unreadKeyFor(a)] ?? unreadCountCache.get(unreadKeyFor(a)) ?? 0);
    case 'recent':
      return (b.addedAt || 0) - (a.addedAt || 0);
    default:
      return compareLibraryTitles(a, b);
  }
});

const unreadCountFor = (manga, sourceId) => {
  const key = unreadKeyFor(manga, sourceId);
  if (unreadCountCache.has(key)) return unreadCountCache.get(key);
  let urls = chapterIndex.peek(manga.url, sourceId);
  if (!Array.isArray(urls) || urls.length === 0) {
    const detail = api.peekDetail(manga.url, sourceId);
    if (Array.isArray(detail?.chapters) && detail.chapters.length) {
      urls = detail.chapters.map((chapter) => chapter.url).filter(Boolean);
    }
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    const readCount = Number(manga.chapterReadCount) || (manga.mihonProgress || []).filter((chapter) => chapter.read).length;
    const count = Math.max(0, (Number(manga.chapterTotal) || 0) - readCount);
    unreadCountCache.set(key, count);
    return count;
  }
  const count = urls.reduce((total, url) => total + (progress.get(url, sourceId)?.read ? 0 : 1), 0);
  unreadCountCache.set(key, count);
  return count;
};

progress.subscribe((change) => {
  if (change?.type === 'reset') unreadCountCache.clear();
  else if (change?.mangaUrl) invalidateUnreadCountsForUrl(change.mangaUrl);
  persistUnreadCountCache();
});
chapterIndex.subscribe((change) => {
  if (change?.type === 'set' || change?.type === 'drop') {
    invalidateUnreadCountsForUrl(change.mangaUrl);
  } else unreadCountCache.clear();
  persistUnreadCountCache();
});

function CachedLibraryCover({ cover, title, className, cachedOnly = false, cachedCover = '' }) {
  const coverRef = useRef(null);
  const loadedCoverKey = useRef('');
  const proxyCover = requiresImageProxy(cover);
  const localCachedCover = /^(data:|blob:)/i.test(cachedCover) ? cachedCover : '';
  const [coverState, setCoverState] = useState(() => ({
    key: cover,
    src: localCachedCover || getLibraryCover(cover) || (cachedOnly || proxyCover ? '' : cover)
  }));
  const src = coverState.key === cover
    ? coverState.src
    : localCachedCover || getLibraryCover(cover) || (cachedOnly || proxyCover ? '' : cover);

  useEffect(() => {
    if (!/^https?:\/\//i.test(cover || '')) return undefined;
    let alive = true;
    if (cachedOnly) {
      const restoreCached = () => restoreLibraryCover(cover).then((local) => local || preloadLibraryCover(cover)).then((local) => {
        if (alive && local && loadedCoverKey.current !== cover) setCoverState({ key: cover, src: local });
      });
      const target = coverRef.current;
      if (!target || !('IntersectionObserver' in window)) {
        restoreCached();
        return () => { alive = false; };
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          restoreCached();
        }
      }, { root: document.querySelector('main'), rootMargin: '220px 0px' });
      observer.observe(target);
      return () => { alive = false; observer.disconnect(); };
    }
    if (proxyCover) {
      restoreLibraryCover(cover).then((cached) => cached || preloadLibraryCover(cover)).then((local) => {
        if (alive && loadedCoverKey.current !== cover) setCoverState({ key: cover, src: local || cover });
      });
      return () => { alive = false; };
    }
    const restore = () => restoreLibraryCover(cover).then((local) => {
      if (alive && loadedCoverKey.current !== cover) setCoverState({ key: cover, src: local || cover });
    });
    const target = coverRef.current;
    if (!target || !('IntersectionObserver' in window)) {
      restore();
      return () => { alive = false; };
    }
    const root = document.querySelector('main');
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        restore();
      }
    }, { root, rootMargin: '220px 0px' });
    observer.observe(target);
    return () => { alive = false; observer.disconnect(); };
  }, [cachedOnly, cover, localCachedCover, proxyCover]);

  return (
    <div ref={coverRef} className="h-full w-full">
      {src ? (
        <img
          src={src}
          alt={title}
          loading="lazy"
          decoding="sync"
          referrerPolicy="no-referrer"
          className={className}
          onLoad={() => {
            loadedCoverKey.current = cover;
            markLibraryCoverLoaded(src);
            if (!cachedOnly && /^https?:\/\//i.test(cover || '')) preloadLibraryCover(cover);
          }}
          onError={() => {
            if (src !== cover) {
              discardLibraryCover(cover, src);
              setCoverState({ key: cover, src: cachedOnly ? '' : cover });
            } else if (!cachedOnly && /^https?:\/\//i.test(cover || '')) {
              preloadLibraryCover(cover).then((local) => {
                if (local) setCoverState({ key: cover, src: local });
              });
            }
          }}
        />
      ) : <div className="h-full w-full bg-muted/40" />}
    </div>
  );
}

const Library = memo(function Library({ active = true }) {
  const [cats, setCats] = useState(() => lib.cats());
  const [sel, setSel] = useState(() => initialLibraryCategory(lib.cats()));
  const [visitedCategoryIds, setVisitedCategoryIds] = useState(() => [initialLibraryCategory(lib.cats())]);
  const [favs, setFavs] = useState(() => lib.favs());
  const [view, setView] = useState(settings.get().libraryView);
  const [checking, setChecking] = useState(libraryCheckInFlight);
  const [checkProgress, setCheckProgress] = useState(libraryCheckProgress);
  const [checkCooldown, setCheckCooldown] = useState(remainingLibraryCheckCooldown);
  const { toast } = useToast();
  const [coverSize, setCoverSize] = useState(() => settings.get().coverSize);
  const [showUnread, setShowUnread] = useState(() => settings.get().libraryShowUnread);
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('cytlex:librarySort') || 'title-asc');
  const [unread, setUnread] = useState({});
  const unreadVersions = useRef(new Map());
  const scale = useScale();
  useEffect(
    () => settings.subscribe((s) => {
      setShowUnread(s.libraryShowUnread);
      setShowAdultExtensions(!!s.showAdultExtensions);
      setCoverSize(s.coverSize);
    }),
    []
  );
  useEffect(() => {
    const updates = [];
    const reassigned = new Set();
    favs.forEach((m) => {
      const currentId = m.sourceId || 'leercapitulo';
      const resolvedId = sourceIdFor(m);
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

  useEffect(() => {
    const reloadLibrary = () => {
      const latest = lib.favs();
      setFavs((current) => sameLibraryFavorites(current, latest) ? current : latest);
      setCats(lib.cats());
    };
    if (active) reloadLibrary();
    const onImport = () => {
      setFavs(lib.favs());
      setCats(lib.cats());
      setUnread({});
    };
    window.addEventListener('cytlex:library-unread-reset', onImport);
    return () => window.removeEventListener('cytlex:library-unread-reset', onImport);
  }, [active]);

  useEffect(() => {
    const syncProgress = (progress) => setCheckProgress(progress);
    libraryCheckProgressListeners.add(syncProgress);
    syncProgress(libraryCheckProgress);
    return () => libraryCheckProgressListeners.delete(syncProgress);
  }, []);

  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);

  const runCheck = async () => {
    if (libraryCheckInFlight || remainingLibraryCheckCooldown() > 0) return;
    libraryCheckInFlight = true;
    setChecking(true);
    updateLibraryCheckProgress({ current: 0, total: favs.length });
    try {
      const found = await checkLibrary({
        silent: true,
        force: true,
        onProgress: updateLibraryCheckProgress
      });
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
      try { localStorage.setItem(LIBRARY_CATEGORY_KEY, sel); } catch {}
      return;
    }
    const fallback = cats[0]?.id || '';
    setSel(fallback);
    if (fallback) {
      setVisitedCategoryIds((current) => current.includes(fallback) ? current : [...current, fallback]);
    }
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

  const unreadSort = sortBy === 'unread-desc' ? unread : null;
  const shown = useMemo(
    () => sortLibraryManga(inCategory.slice(), sortBy, unreadSort || {}),
    [inCategory, sortBy, unreadSort]
  );
  const visitedCategories = useMemo(() => cats
    .filter((category) => visitedCategoryIds.includes(category.id))
    .map((category) => ({
      ...category,
      items: category.id === sel
        ? shown
        : sortLibraryManga(
            favs.filter((manga) => (manga.cats || []).includes(category.id)),
            sortBy,
            unreadSort || {}
          )
    })), [cats, visitedCategoryIds, sel, shown, favs, sortBy, unreadSort]);

  const selectCategory = (categoryId) => {
    setSel(categoryId);
    setVisitedCategoryIds((current) => current.includes(categoryId) ? current : [...current, categoryId]);
  };

  useEffect(() => {
    if (!showUnread) return undefined;
    let alive = true;
    (async () => {
      const pending = inCategory.filter((manga) => extensions.isInstalled(sourceIdFor(manga)) && !unreadCountCache.has(unreadKeyFor(manga)));
      const pendingByKey = new Map();
      const startingVersions = new Map();
      pending.forEach((manga) => {
        const key = unreadKeyFor(manga);
        pendingByKey.set(key, manga);
        startingVersions.set(key, unreadVersions.current.get(key) || 0);
      });
      for (let i = 0; i < pending.length; i += 12) {
        let batch = pending.slice(i, i + 12).map((manga) => {
          const sid = sourceIdFor(manga);
          return [unreadKeyFor(manga, sid), unreadCountFor(manga, sid)];
        });
        if (!alive) return;
        batch = batch.map(([key, count]) => {
          if (unreadVersions.current.get(key) === startingVersions.get(key)) return [key, count];
          const manga = pendingByKey.get(key);
          return [key, manga ? unreadCountFor(manga, sourceIdFor(manga)) : count];
        });
        persistUnreadCountCache();
        setUnread((prev) => {
          let next = prev;
          for (const [key, count] of batch) {
            if (prev[key] === count) continue;
            if (next === prev) next = { ...prev };
            next[key] = count;
          }
          return next;
        });
        if (i + 12 < pending.length) await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    })();
    return () => { alive = false; };
  }, [inCategory, showUnread]);

  useEffect(() => {
    if (!showUnread) return undefined;
    return progress.subscribe((change) => {
      if (change?.type === 'reset') {
        const updates = [];
        inCategory.forEach((manga) => {
          const sid = sourceIdFor(manga);
          if (!extensions.isInstalled(sid)) return;
          const key = `${sid}|${manga.url}`;
          unreadVersions.current.set(key, (unreadVersions.current.get(key) || 0) + 1);
          updates.push([key, unreadCountFor(manga, sid)]);
        });
        setUnread((prev) => {
          const next = { ...prev };
          updates.forEach(([key, count]) => { next[key] = count; });
          return next;
        });
        persistUnreadCountCache();
        return;
      }
      if (change?.type !== 'read' || !change.mangaUrl) return;
      const manga = inCategory.find((item) => item.url === change.mangaUrl && sourceIdFor(item) === change.sourceId);
      if (!manga) return;
      const key = `${change.sourceId}|${manga.url}`;
      unreadVersions.current.set(key, (unreadVersions.current.get(key) || 0) + 1);
      const count = unreadCountFor(manga, change.sourceId);
      setUnread((prev) => prev[key] === count ? prev : { ...prev, [key]: count });
      persistUnreadCountCache();
    });
  }, [inCategory, showUnread]);

  useEffect(() => {
    if (!showUnread) return undefined;
    return chapterIndex.subscribe((change) => {
      const changedSourceId = change?.sourceId || 'leercapitulo';
      const affected = change?.type === 'set' || change?.type === 'drop'
        ? inCategory.filter((manga) => {
            const savedSourceId = manga.sourceId || 'leercapitulo';
            return sameMangaUrl(manga.url, change.mangaUrl)
              && (sourceIdFor(manga) === changedSourceId || savedSourceId === changedSourceId);
          })
        : inCategory;
      if (!affected.length) return;
      const updates = affected
        .filter((manga) => extensions.isInstalled(sourceIdFor(manga)))
        .map((manga) => {
          const sid = sourceIdFor(manga);
          const key = unreadKeyFor(manga, sid);
          unreadCountCache.delete(key);
          unreadCountCache.delete(unreadKeyFor(manga, manga.sourceId || 'leercapitulo'));
          unreadVersions.current.set(key, (unreadVersions.current.get(key) || 0) + 1);
          return [key, unreadCountFor(manga, sid)];
        });
      setUnread((prev) => {
        const next = { ...prev };
        updates.forEach(([key, count]) => { next[key] = count; });
        return next;
      });
      persistUnreadCountCache();
    });
  }, [inCategory, showUnread]);

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
              onClick={() => selectCategory(c.id)}
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
            disabled={!favs.length || checking || checkCooldown > 0}
            aria-busy={checking}
            onClick={runCheck}
            title={checkCooldown ? `Puedes volver a buscar en ${checkCooldown} s` : 'Buscar actualizaciones'}
            className="rounded-md"
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
            {checking ? (
              <>
                Buscando
                <span className="ml-2 tabular-nums opacity-75" aria-live="polite">
                  {checkProgress.current}/{checkProgress.total}
                </span>
              </>
            ) : 'Buscar actualizaciones'}
          </Button>
        </div>
      </div>

      {visitedCategories.map((category) => {
        const selected = category.id === sel;
        const categoryItems = category.items;
        return (
          <section key={category.id} hidden={!selected} aria-hidden={!selected}>
            {categoryItems.length === 0 ? (
              <EmptyState
                face="(っ-;)"
                tone="sad"
                title={favs.some((f) => (f.cats || []).includes(category.id)) ? 'No hay mangas visibles con este filtro' : 'Tu biblioteca está vacía'}
              />
            ) : view === 'grid' ? (
              <VirtualMangaGrid
                items={categoryItems}
                coverSize={cs}
                scale={scale}
                active={active && selected}
                overscanRows={2}
                responsiveCards
                renderCard={(m, cardWidth) => {
                  const sid = sourceIdFor(m);
                  const sourceNotOffered = isUnavailableMangaSource(sid);
                  const adultBlocked = !isExtensionAllowed(extensions.manifest(sid), showAdultExtensions);
                  const cover = m.cover || recallCover(m.url, sid);
                  return (
                    <MangaCard
                      key={`${sid}|${m.url}`}
                      m={m.cover === cover ? m : { ...m, cover }}
                      sourceId={sid}
                      unavailable={!extensions.isInstalled(sid) || adultBlocked}
                      canOpenUnavailable={sourceNotOffered}
                      unavailableLabel={sourceNotOffered ? 'Extensión no disponible' : adultBlocked ? 'Fuente bloqueada' : 'Fuente no instalada'}
                      minimal
                      from="biblioteca"
                      coverSize={cardWidth}
                      chapterCount={showUnread ? unread[unreadKeyFor(m, sid)] ?? unreadCountCache.get(unreadKeyFor(m, sid)) ?? null : null}
                    />
                  );
                }}
              />
            ) : (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${px(260, scale, 230)}), 1fr))` }}
              >
                {categoryItems.map((m) => {
                  const sid = sourceIdFor(m);
                  const cover = m.cover || recallCover(m.url, sid);
                  const unreadCount = unread[unreadKeyFor(m, sid)] ?? unreadCountCache.get(unreadKeyFor(m, sid));
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
                  const adultBlocked = !isExtensionAllowed(sourceManifest, showAdultExtensions);
                  const unavailable = !extensions.isInstalled(sid) || adultBlocked;
                  const sourceNotOffered = isUnavailableMangaSource(sid);
                  const linkDisabled = unavailable && !sourceNotOffered;
                  return (
                    <div key={`${sid}|${m.url}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
                      <a
                        href={`#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sid)}&from=biblioteca`}
                        className={cn('flex items-end gap-3 flex-1 min-w-0', unavailable && 'opacity-60', linkDisabled && 'pointer-events-none')}
                        aria-disabled={linkDisabled}
                        tabIndex={linkDisabled ? -1 : undefined}
                      >
                        <span
                          className="relative rounded-lg shrink-0 overflow-hidden bg-muted"
                          style={{ width: px(68 * coverSize / 160, scale, 56), height: px(102 * coverSize / 160, scale, 82) }}
                        >
                          {cover && (
                            <CachedLibraryCover cover={cover} title={m.title} className="w-full h-full object-cover bg-black" cachedOnly={unavailable} cachedCover={m.coverCached || m.coverLocal || ''} />
                          )}
                          {unavailable && (
                            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 px-0.5 text-center font-semibold leading-tight text-white" style={{ fontSize: px(8, scale, 7) }}>
                              <span>{sourceNotOffered ? 'Extensión no disponible' : adultBlocked ? 'Fuente bloqueada' : 'Fuente no instalada'}</span>
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
          </section>
        );
      })}
    </div>
  );
});

export default Library;

