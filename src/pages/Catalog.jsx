import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, ChevronRight, ChevronLeft, CircleHelp } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { isLibraryManga, lib, libraryIdentityKey, libraryKey } from '../lib/library.js';
import { extensions, isExtensionAllowed, isRetiredExtension } from '../lib/extensions.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { settings } from '../lib/settings.js';
import { lastSearch, scrollMemory, rememberCover, catalogScroll, sourceCatalogState, SOURCE_CATALOG_HOME_EVENT, MAX_SEARCH_RESULTS } from '../lib/searchState.js';
import { clearSearchCoverCache, preloadSearchCover } from '../lib/covers.js';
import MangaCard from '../components/MangaCard.jsx';
import ExtensionsPanel from '../components/ExtensionsPanel.jsx';
import SourcesCatalog from '../components/SourcesCatalog.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { Button, buttonVariants } from '../components/ui/button.jsx';
import { Dialog } from '../components/ui/dialog.jsx';
import { Input } from '../components/ui/input.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';
import { migrateSavedManga } from '../lib/mangaMigration.js';

const TABS = [
  { id: 'mangas', label: 'Mangas' },
  { id: 'extensiones', label: 'Extensiones' },
  { id: 'fuentes', label: 'Fuentes' }
];

const enabledSources = (showAdultExtensions) => extensions.sources().filter(({ manifest }) =>
  isExtensionAllowed(manifest, showAdultExtensions)
);

const normalizeMangaTitle = (title) => String(title || '').trim().normalize('NFKC').toLocaleLowerCase();

const EXT_CONFIG_KEY = 'cytlex:ext-config:v1';

const sourceLangSubtitle = (manifest) => {
  const options = Array.isArray(manifest.config?.languages) ? manifest.config.languages : null;
  if (!options || !options.length) return '';
  const defaults = Array.isArray(manifest.config.default) && manifest.config.default.length
    ? manifest.config.default
    : options.map((l) => l.code);
  let cur = null;
  try { cur = JSON.parse(localStorage.getItem(EXT_CONFIG_KEY))?.[manifest.id]?.languages; } catch {}
  const codes = Array.isArray(cur) && cur.length ? cur : defaults;
  return codes.map((c) => options.find((l) => l.code === c)?.label || c).join(' · ');
};

function SourceSection({ r, coverSize, scale = 1, first = false, animate = false, active = true, onMangaSelect, returnTo = '', savedMangaKeys, hideSavedManga = false }) {
  const trackRef = useRef(null);
  const mainRef = useRef(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useLayoutEffect(() => {
    mainRef.current = document.querySelector('main');
  }, []);

  useLayoutEffect(() => {
    if (active && scrollMemory.catalog > 0 && mainRef.current) {
      mainRef.current.scrollTop = scrollMemory.catalog;
    }
  }, [r.id, active]);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!active || !main) return undefined;
    const save = () => { scrollMemory.catalog = main.scrollTop; };
    main.addEventListener('scroll', save, { passive: true });
    return () => main.removeEventListener('scroll', save);
  }, [active]);

  const gap = Math.max(8, Math.round(12 * scale));

  const measure = () => {
    const el = trackRef.current;
    if (!el) return;
    // The catalog remains mounted while its route is hidden. Keep the last
    // usable width there; display:none reports 0 and would cause a visible
    // cover-size jump when the page becomes active again.
    if (el.clientWidth > 0) setTrackWidth(el.clientWidth);
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useLayoutEffect(() => {
    if (!active) return undefined;
    measure();
    const el = trackRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [r.items.length, coverSize, active]);

  const columns = Math.max(1, Math.floor((trackWidth + gap) / (coverSize + gap)));
  const cardWidth = trackWidth > 0
    ? Math.floor((trackWidth - gap * (columns - 1)) / columns)
    : coverSize;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollLeft = catalogScroll.get(r.id);
    measure();
  }, [r.id, r.items.length]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const save = () => catalogScroll.set(r.id, el.scrollLeft);
    el.addEventListener('scroll', save, { passive: true });
    return () => el.removeEventListener('scroll', save);
  }, [r.id]);

  const step = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (cardWidth + gap) * 2, behavior: 'smooth' });
  };

  const visibleItems = hideSavedManga
    ? r.items.filter((manga) => !isLibraryManga(manga, r.id, savedMangaKeys))
    : r.items;
  if (hideSavedManga && r.items.length && !visibleItems.length && !r.hasMore) return null;
  const visible = visibleItems.slice(0, 15);

  return (
    <motion.section
      className="mb-10"
      style={{
        marginBottom: `${Math.max(16, Math.round(24 * scale))}px`,
        marginTop: first ? `${Math.max(8, Math.round(12 * scale))}px` : undefined
      }}
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div
        className="flex items-center gap-2.5 mb-4"
        style={{ marginBottom: `${Math.max(10, Math.round(16 * scale))}px` }}
      >
        <SourceBadge m={r.manifest} />
        <div className="min-w-0">
          <h3 className="font-semibold" style={{ fontSize: `${Math.round(14 * scale)}px` }}>
            {r.manifest.name}
          </h3>
          {(() => {
            const langs = sourceLangSubtitle(r.manifest);
            if (!langs) return null;
            return (
              <div className="text-muted-foreground truncate" style={{ fontSize: `${Math.round(11 * scale)}px` }}>
                {langs}
              </div>
            );
          })()}
        </div>
        <span className="text-muted-foreground shrink-0" style={{ fontSize: `${Math.round(12 * scale)}px` }}>
          · {visibleItems.length}
        </span>
      </div>
      {!visibleItems.length ? (
        <p className="text-sm text-muted-foreground">
          {r.status === 'error'
            ? 'No se pudo buscar en esta extensión.'
            : r.items.length
              ? 'Los resultados de esta página ya están en Biblioteca.'
              : 'Sin resultados en esta extensión.'}
        </p>
      ) : (
      <div className="relative">
        <div
          ref={trackRef}
          onScroll={measure}
          className="flex overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            gap: `${gap}px`,
            scrollSnapType: 'x proximity',
            paddingBottom: `${Math.max(6, Math.round(8 * scale))}px`
          }}
        >
          {active && visible.map((m, i) => (
            <div
              key={i}
              className="shrink-0"
              style={{ scrollSnapAlign: 'start', width: cardWidth || 150 }}
            >
              <MangaCard
                m={m}
                sourceId={r.id}
                from="explorar"
                returnTo={returnTo}
                onSelect={onMangaSelect}
                coverSize={cardWidth}
                showAuthor={false}
                savedInLibrary={isLibraryManga(m, r.id, savedMangaKeys)}
              />
            </div>
          ))}
        </div>
        {canLeft && (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Ver mangas anteriores"
            className="absolute -left-3 top-[38%] z-10 grid place-items-center rounded-full border border-border bg-background/90 text-foreground shadow-md backdrop-blur-sm transition hover:bg-background"
            style={{
              width: `${Math.round(36 * scale)}px`,
              height: `${Math.round(36 * scale)}px`,
              marginLeft: `${Math.round(2 * scale)}px`
            }}
          >
            <ChevronLeft style={{ width: `${Math.round(16 * scale)}px`, height: `${Math.round(16 * scale)}px` }} />
          </button>
        )}
        {canRight && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Ver más mangas"
            className="absolute -right-3 top-[38%] z-10 grid place-items-center rounded-full border border-border bg-background/90 text-foreground shadow-md backdrop-blur-sm transition hover:bg-background"
            style={{
              width: `${Math.round(36 * scale)}px`,
              height: `${Math.round(36 * scale)}px`,
              marginRight: `${Math.round(2 * scale)}px`
            }}
          >
            <ChevronRight style={{ width: `${Math.round(16 * scale)}px`, height: `${Math.round(16 * scale)}px` }} />
          </button>
        )}
        {r.items.length > 1 && (r.items.length > 15 || r.hasMore) && (
          <a
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'absolute -top-11 right-0 hover:bg-transparent hover:text-foreground'
            )}
            href={`#/resultados?s=${encodeURIComponent(r.id)}`}
            style={{ top: `${Math.round(-44 * scale)}px`, fontSize: `${Math.round(14 * scale)}px` }}
          >
            Ver todos <ChevronRight className="w-4 h-4 ml-1.5" />
          </a>
        )}
      </div>
      )}
    </motion.section>
  );
}

let sessionTab = 'mangas';
let animateSearch = false;
let activeSearchRun = 0;
let activeMigrationSearchRun = 0;
let migrationSearchSnapshot = null;

const Catalog = memo(function Catalog({ locationOverride, tutorialPreview = false, active = true, migrationInline = null }) {
  const loc = locationOverride;
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(loc.search);
  const migrationFromUrl = searchParams.get('migrationFrom') || '';
  const migrationFromSource = searchParams.get('migrationSource') || '';
  const migrationSourceIds = (searchParams.get('migrationTargets') || '').split(',').filter(Boolean);
  const migrationSearchId = searchParams.get('migrationSearchId') || '';
  const migrationQuery = searchParams.get('q') || '';
  const migrationMode = !!(migrationFromUrl && migrationFromSource && migrationSourceIds.length);
  const migrationSearchKey = migrationMode
    ? JSON.stringify([migrationSearchId, migrationFromUrl, migrationFromSource, migrationQuery, [...migrationSourceIds].sort()])
    : '';
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(loc.search).get('tab');
    return t === 'mangas' || t === 'extensiones' || t === 'fuentes' ? t : sessionTab;
  });
  const [sources, setSources] = useState(() => enabledSources(!!settings.get().showAdultExtensions));
  const [q, setQ] = useState(() => migrationMode ? migrationQuery : lastSearch.q);
  const [results, setResults] = useState(() => migrationMode
    ? migrationSearchSnapshot?.key === migrationSearchKey ? migrationSearchSnapshot.results : null
    : lastSearch.results);
  const [coverSize, setCoverSize] = useState(() => settings.get().coverSize);
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const [hideSavedManga, setHideSavedManga] = useState(() => !!settings.get().hideSavedManga);
  const [migrationSelection, setMigrationSelection] = useState(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState('');
  const scale = useScale();

  useEffect(() => settings.subscribe((s) => {
    setShowAdultExtensions(!!s.showAdultExtensions);
    setSources(enabledSources(!!s.showAdultExtensions));
    setCoverSize(s.coverSize);
    setHideSavedManga(!!s.hideSavedManga);
  }), []);
  useEffect(() => { sessionTab = tab; }, [tab]);
  useEffect(() => {
    // Catalog stays mounted behind the manga detail page. Keep its blob URLs
    // alive while those cards are hidden so returning to Explore preserves covers.
    if (tab === 'mangas') return;
    clearSearchCoverCache();
    if (!lastSearch.results) return;
    lastSearch.results = lastSearch.results.map((result) => ({
      ...result,
      items: result.items.map(({ coverCached, ...item }) => item)
    }));
    setResults(lastSearch.results);
  }, [active, tab]);
  useEffect(() => () => {
    if (tab === 'fuentes') sourceCatalogState.requestRestore();
  }, [tab]);
  useEffect(() => () => {
    if (tutorialPreview) sessionTab = 'mangas';
  }, [tutorialPreview]);
  useEffect(() => () => { animateSearch = false; }, []);

  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);
  const savedMangaKeys = useMemo(
    () => new Set(lib.favs().flatMap((manga) => [
      libraryKey(manga.url, manga.sourceId || 'leercapitulo'),
      ...(/^mihon-\d+$/i.test(manga.sourceId || '') ? [libraryIdentityKey(manga.url)] : [])
    ])),
    [loc.pathname, loc.search, active]
  );

  useEffect(() => {
    setSources(enabledSources(!!settings.get().showAdultExtensions));
  }, [tab]);

  const catalogSources = migrationMode
    ? extensions.sources().filter(({ manifest }) => migrationSourceIds.includes(manifest.id))
    : sources;
  const searching = !!results && results.some((r) => r.status === 'loading');
  const completed = results ? results.filter((r) => r.status !== 'loading') : [];
  const visibleCompleted = migrationMode
    ? completed.filter((r) => migrationSourceIds.includes(r.id))
    : completed.filter((r) => isExtensionAllowed(r.manifest, showAdultExtensions));
  const searchItems = visibleCompleted.flatMap((result) => result.items.map((manga) => ({ manga, sourceId: result.id })));
  const visibleSearchItemCount = migrationMode || !hideSavedManga
    ? searchItems.length
    : searchItems.filter(({ manga, sourceId }) => !isLibraryManga(manga, sourceId, savedMangaKeys)).length;
  const done = !!results && !searching;

  useEffect(() => { if (done && !migrationMode) animateSearch = false; }, [done, migrationMode]);

  const updateResults = (fn) => {
    if (migrationMode) {
      const current = migrationSearchSnapshot?.key === migrationSearchKey
        ? migrationSearchSnapshot.results
        : results;
      migrationSearchSnapshot = { key: migrationSearchKey, results: fn(current) };
      setResults(migrationSearchSnapshot.results);
      return;
    }
    lastSearch.results = fn(lastSearch.results);
    setResults(lastSearch.results);
  };

  const runSearch = (query = q) => {
    const searchQuery = migrationMode ? migrationQuery : query;
    const adultExtensionsEnabled = !!settings.get().showAdultExtensions;
    const migrationSources = new Set(migrationSourceIds);
    const list = migrationMode
      ? extensions.sources().filter(({ manifest }) => migrationSources.has(manifest.id))
      : enabledSources(adultExtensionsEnabled);
    if (!list.length) return;
    if (!migrationMode) scrollMemory.catalog = 0;
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    const runId = migrationMode ? ++activeMigrationSearchRun : ++activeSearchRun;
    if (!migrationMode) {
      catalogScroll.clear();
      clearSearchCoverCache();
      animateSearch = true;
      lastSearch.q = searchQuery;
      lastSearch.genre = '';
      lastSearch.adultExtensionsEnabled = adultExtensionsEnabled;
    }
    const initialResults = list
      .map((s) => ({ id: s.manifest.id, manifest: s.manifest, status: 'loading', items: [], page: 1, totalPages: 1, hasMore: false }))
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'es', { sensitivity: 'base' }));
    if (migrationMode) migrationSearchSnapshot = { key: migrationSearchKey, results: initialResults };
    else lastSearch.results = initialResults;
    setResults(initialResults);

    list.forEach(async (s) => {
      try {
        const params = { q: searchQuery, genre: '', page: 1 };
        const r = await api.catalog(params, s.manifest.id);
        const items = (r.items || []).filter((m) =>
          (!migrationMode || migrationInline?.onConfirm || normalizeMangaTitle(m.title) === normalizeMangaTitle(migrationQuery)) &&
          (s.manifest.id !== 'mangalect' || String(m.lastChapter || '').trim())
        ).slice(0, MAX_SEARCH_RESULTS);
        const visibleCovers = await Promise.all(items.slice(0, 10).map(async (m) => [
          m.url,
          await preloadSearchCover(m.cover)
        ]));
        const cachedCovers = new Map(visibleCovers.filter(([, cover]) => cover));
        const loadedItems = items.map((m) => cachedCovers.has(m.url)
          ? { ...m, coverCached: cachedCovers.get(m.url) }
          : m);
        items.forEach((m) => rememberCover(m.url, m.cover, s.manifest.id));
        if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
        updateResults((prev) =>
          prev ? prev.map((x) => (x.id === s.manifest.id
            ? {
                ...x,
                status: 'done',
                items: loadedItems,
                page: 1,
                totalPages: r.totalPages || 1,
                hasMore: items.length < MAX_SEARCH_RESULTS && (r.hasMore ?? (r.totalPages > 1)),
                totalText: r.totalText || ''
              }
            : x)) : prev
        );
      } catch (e) {
        console.warn('[Cytlex] búsqueda falló en', s.manifest.id, e?.message || e);
        if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
        updateResults((prev) => (prev ? prev.map((x) => (x.id === s.manifest.id ? { ...x, status: 'error' } : x)) : prev));
      }
    });
  };

  const openMangaDetail = (manga, sourceId) => {
    const params = new URLSearchParams({ u: manga.url, s: sourceId, from: migrationInline?.origin || 'explorar' });
    if (migrationMode) params.set('back', migrationInline?.returnTo || `/explorar?${loc.search.replace(/^\?/, '')}`);
    setMigrationSelection(null);
    setMigrationError('');
    navigate(`/manga?${params.toString()}`);
  };

  const confirmMigration = async () => {
    if (!migrationSelection || migrationBusy || !migrationFromUrl || !migrationFromSource) return;
    setMigrationBusy(true);
    setMigrationError('');
    try {
      const targetSourceId = migrationSelection.sourceId;
      if (migrationInline?.onConfirm) {
        const targetDetail = await api.detail(migrationSelection.manga.url, targetSourceId);
        if (!targetDetail) throw new Error('No se pudo cargar el manga de destino.');
        migrationInline.onConfirm(migrationSelection.manga, targetSourceId, targetDetail);
        setMigrationSelection(null);
        return;
      }
      const originalDetail = isRetiredExtension(migrationFromSource)
        ? { chapters: (chapterIndex.peek(migrationFromUrl, migrationFromSource) || []).map((url) => ({ url })) }
        : api.detail(migrationFromUrl, migrationFromSource);
      const [fromDetail, targetDetail] = await Promise.all([
        originalDetail,
        api.detail(migrationSelection.manga.url, targetSourceId)
      ]);
      if (!fromDetail || !targetDetail) throw new Error('No se pudieron cargar los detalles para migrar este manga.');
      migrateSavedManga({
        fromUrl: migrationFromUrl,
        fromSourceId: migrationFromSource,
        fromDetail,
        targetUrl: migrationSelection.manga.url,
        targetSourceId,
        targetDetail
      });
      setMigrationSelection(null);
      navigate(`/manga?${new URLSearchParams({ u: migrationSelection.manga.url, s: targetSourceId, from: migrationInline?.origin || 'biblioteca' })}`);
    } catch (error) {
      setMigrationError(String(error?.message || error));
    } finally {
      setMigrationBusy(false);
    }
  };

  useEffect(() => {
    if (!migrationMode && tab === 'mangas' && results && (
      lastSearch.adultExtensionsEnabled !== showAdultExtensions
    )) {
      runSearch(lastSearch.q);
    }
  }, [showAdultExtensions, tab, migrationMode]);

  useEffect(() => {
    if (!migrationMode && tab !== 'fuentes' && lastSearch.results && lastSearch.results.some((r) => r.status === 'loading')) {
      runSearch(lastSearch.q);
    }
  }, [migrationMode]);

  useEffect(() => {
    const t = new URLSearchParams(loc.search).get('tab');
    if (t === 'mangas' || t === 'extensiones' || t === 'fuentes') setTab(t);
  }, [loc.search]);

  useLayoutEffect(() => {
    const params = new URLSearchParams(loc.search);
    const nq = params.get('q') || '';
    if (nq && params.get('tab') !== 'fuentes') {
      setQ(nq);
      const cached = migrationMode && migrationSearchSnapshot?.key === migrationSearchKey
        ? migrationSearchSnapshot.results
        : null;
      if (cached?.length && cached.every((result) => result.status !== 'loading')) {
        if (!migrationMode) {
          lastSearch.q = nq;
          lastSearch.results = cached;
        }
        setResults(cached);
        const main = document.querySelector('main');
        if (main) main.scrollTop = scrollMemory.catalog;
        return;
      }
      runSearch(nq);
    }
  }, [loc.search]);

  return (
    <div
      className="min-h-full flex flex-col"
      data-explore-start={tab === 'extensiones' || tab === 'fuentes' || (!q.trim() && !results) ? 'true' : 'false'}
    >
      <div
        className="-mt-1 flex flex-wrap items-center mb-3"
        style={{
          gap: `${Math.max(16, Math.round(24 * scale))}px`,
          marginBottom: `${Math.max(8, Math.round(12 * scale))}px`,
          minHeight: px(36, scale, 30)
        }}
      >
        <div className="flex items-center" style={{ gap: `${Math.max(16, Math.round(24 * scale))}px` }}>
          {migrationInline ? (
            <Button
              size="sm"
              variant="ghost"
              className="-ml-2 hover:bg-transparent hover:text-foreground"
              onClick={(e) => { e.currentTarget.blur(); migrationInline.onBack(); }}
              style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(8, scale, 6), paddingRight: px(8, scale, 6) }}
            >
              <ChevronLeft className="mr-1" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
              Volver
            </Button>
          ) : TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (active) {
                    const main = document.querySelector('main');
                    if (t.id === 'fuentes' && main?.querySelector('[data-source-catalog-selected="true"]')) {
                      window.dispatchEvent(new Event(SOURCE_CATALOG_HOME_EVENT));
                    }
                    if (t.id === 'mangas') {
                      setQ('');
                      lastSearch.q = '';
                      lastSearch.genre = '';
                      lastSearch.results = null;
                      setResults(null);
                      if (migrationMode) {
                        const params = new URLSearchParams(loc.search);
                        params.delete('q');
                        params.delete('migrationFrom');
                        params.delete('migrationSource');
                        params.delete('migrationTargets');
                        navigate({ pathname: loc.pathname, search: `?${params}` }, { replace: true });
                      }
                    }
                    main?.scrollTo({ top: 0, behavior: 'smooth' });
                    return;
                  }
                  setTab(t.id);
                  const params = new URLSearchParams(loc.search);
                  params.set('tab', t.id);
                  params.delete('source');
                  params.delete('q');
                  params.delete('quick');
                  params.delete('migrationFrom');
                  params.delete('migrationSource');
                  params.delete('migrationTargets');
                  navigate({ pathname: loc.pathname, search: `?${params}` }, { replace: true });
                }}
                className={cn(
                  'relative font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
                style={{
                  fontSize: `${Math.round(14 * scale)}px`,
                  paddingBottom: px(8, scale, 6)
                }}
              >
                {t.label}
                {active && (
                  <motion.span
                    layoutId="catalog-underline"
                    className="absolute left-0 right-0 bottom-0 rounded-full bg-primary"
                    style={{ height: `${Math.max(1.5, Math.round(2 * scale))}px` }}
                    transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
                  />
                )}
              </button>
            );
          })}
          {tab === 'extensiones' && (
            <span
              className="group relative flex self-center items-center text-muted-foreground hover:text-foreground focus-visible:outline-none"
              tabIndex={0}
              aria-describedby="extension-selection-tip"
              style={{ paddingBottom: px(8, scale, 6) }}
            >
              <CircleHelp aria-hidden="true" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
              <span
                id="extension-selection-tip"
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-56 rounded-lg border border-border bg-card px-3 py-2 text-xs text-card-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100"
              >
                Pro Tip: Puedes seleccionar varias extensiones para instalarlas o desinstalarlas juntas.
              </span>
            </span>
          )}
        </div>

        {tab === 'extensiones' && (
          <div
            id="extensions-toolbar"
            className="ml-auto self-center flex items-center"
            style={{ gap: px(8, scale, 6) }}
          />
        )}

        {tab === 'fuentes' && (
          <div
            id="sources-toolbar"
            className="ml-auto self-center flex items-center"
            style={{ gap: px(8, scale, 6) }}
          />
        )}

        {tab === 'mangas' && catalogSources.length > 0 && !migrationMode && (
          <div className="ml-auto self-center flex items-center" style={{ gap: px(12, scale, 9) }}>
            <div className="relative w-full sm:w-auto" style={{ width: px(288, scale, 190) }}>
              <Search
                className="absolute top-1/2 -translate-y-1/2 text-muted-foreground"
                style={{
                  left: px(12, scale, 9),
                  width: `${Math.round(14 * scale)}px`,
                  height: `${Math.round(14 * scale)}px`
                }}
              />
              <Input
                className="bg-muted/50 border-none"
                placeholder="Buscar en todas las extensiones..."
                value={q}
                onChange={(e) => { setQ(e.target.value); lastSearch.q = e.target.value; }}
                onKeyDown={(e) => e.key === 'Enter' && q.trim() && runSearch()}
                style={{
                  height: px(36, scale, 30),
                  fontSize: `${Math.round(14 * scale)}px`,
                  paddingLeft: px(36, scale, 30),
                  paddingRight: px(12, scale, 9)
                }}
              />
            </div>
            <Button
              size="sm"
              onClick={() => runSearch()}
              disabled={!q.trim()}
              className={cn('rounded-lg disabled:opacity-40')}
              style={{
                height: px(36, scale, 30),
                fontSize: `${Math.round(14 * scale)}px`,
                paddingLeft: px(12, scale, 9),
                paddingRight: px(12, scale, 9)
              }}
            >
              Buscar
            </Button>
          </div>
        )}
      </div>

      {tab === 'mangas' ? (
        catalogSources.length === 0 ? (
          <EmptyState
            face="（눈﹏눈）"
            title="No hay extensiones instaladas"
          />
        ) : (
          <>
            {!results && (
              <EmptyState
                face="(・_・)？"
                tone="prompt"
                title="Busca un manga para empezar"
              />
            )}

            {results && (
              <>
                  {searching && (
                  <div
                    className="flex items-center gap-2.5"
                    style={{
                      marginTop: `${Math.max(8, Math.round(12 * scale))}px`,
                      marginBottom: `${Math.max(10, Math.round(16 * scale))}px`
                    }}
                  >
                    <Loader2 className="animate-spin text-muted-foreground" style={{ width: px(20, scale, 16), height: px(20, scale, 16) }} />
                    <p className="text-sm text-muted-foreground">
                      Buscando en {catalogSources.length} {catalogSources.length === 1 ? 'extensión' : 'extensiones'}...
                    </p>
                  </div>
                )}

                {done && completed.length > 0 && visibleCompleted.length === 0 ? (
                  <EmptyState
                    face="（・_・）"
                    title="No hay extensiones visibles"
                    description="Activa «Mostrar extensiones +18» en Ajustes > Extensiones para mostrarlas."
                  />
                ) : !migrationMode && hideSavedManga && done && searchItems.length > 0 && visibleSearchItemCount === 0 ? (
                  <EmptyState
                    face="（・_・）"
                    title="No hay mangas nuevos"
                    description="Los mangas encontrados ya están en Biblioteca. Puedes desactivar «Ocultar mangas ya guardados» en Ajustes > Biblioteca."
                  />
                ) : visibleCompleted.map((r, i) => (
                  <SourceSection
                    key={r.id}
                    r={r}
                    coverSize={cs}
                    scale={scale}
                    first={i === 0}
                    animate={animateSearch}
                    active={active}
                    onMangaSelect={migrationMode ? (manga, sourceId) => { setMigrationError(''); setMigrationSelection({ manga, sourceId }); } : undefined}
                    returnTo={migrationMode ? migrationInline?.returnTo || `/explorar?${loc.search.replace(/^\?/, '')}` : ''}
                    savedMangaKeys={savedMangaKeys}
                    hideSavedManga={!migrationMode && hideSavedManga}
                  />
                ))}
              </>
            )}
          </>
        )
      ) : tab === 'extensiones' ? (
        <ExtensionsPanel tutorialPreview={tutorialPreview} />
      ) : (
        <SourcesCatalog
          sources={sources}
          initialSourceId={new URLSearchParams(loc.search).get('source') || ''}
          active={active}
          savedMangaKeys={savedMangaKeys}
          hideSavedManga={hideSavedManga}
        />
      )}

      <Dialog
        open={!!migrationSelection}
        onClose={() => { if (!migrationBusy) { setMigrationSelection(null); setMigrationError(''); } }}
        scale={scale}
        dialogStyle={{ maxWidth: px(480, scale, 380) }}
        title="Manga encontrado"
        description="Confirma que es el manga que quieres migrar o abre su ficha para revisarlo."
      >
        {migrationSelection && (
          <>
            <div className="flex items-center border-b border-border" style={{ gap: px(14, scale, 10), paddingBottom: px(16, scale, 12) }}>
              {migrationSelection.manga.cover ? (
                <img src={migrationSelection.manga.cover} alt="" className="aspect-[5/7] shrink-0 rounded-lg object-cover" style={{ width: px(72, scale, 58) }} />
              ) : <div className="aspect-[5/7] shrink-0 rounded-lg bg-muted" style={{ width: px(72, scale, 58) }} />}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-semibold" style={{ fontSize: px(17, scale, 14) }}>{migrationSelection.manga.title}</div>
                {migrationSelection.manga.author && <div className="mt-1 truncate text-muted-foreground" style={{ fontSize: px(13, scale, 11) }}>{migrationSelection.manga.author}</div>}
                <div className="mt-2"><SourceBadge m={extensions.manifest(migrationSelection.sourceId)} /></div>
              </div>
            </div>
            {migrationError && <p role="alert" className="text-destructive" style={{ marginTop: px(12, scale, 9), fontSize: px(13, scale, 11) }}>{migrationError}</p>}
            <div className="flex justify-end" style={{ gap: px(8, scale, 6), paddingTop: px(16, scale, 12) }}>
              <Button
                variant="secondary"
                disabled={migrationBusy}
                onClick={() => openMangaDetail(migrationSelection.manga, migrationSelection.sourceId)}
                style={{ height: px(38, scale, 31), padding: `0 ${px(12, scale, 10)}`, fontSize: px(14, scale, 12) }}
              >
                Ver manga
              </Button>
              <Button
                disabled={migrationBusy}
                onClick={confirmMigration}
                style={{ height: px(38, scale, 31), padding: `0 ${px(12, scale, 10)}`, fontSize: px(14, scale, 12) }}
              >
                {migrationBusy ? 'Migrando…' : 'Confirmar migración'}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
});

export default Catalog;
