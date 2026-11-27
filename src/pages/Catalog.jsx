import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { api } from '../lib/api.js';
import { beginCatalogSearchBatch, browserImageUrl, finishCatalogSearchBatchSource, sourceErrorMessage } from '../lib/browserHttp.js';
import { isLibraryManga, lib, libraryIdentityKey, libraryKey } from '../lib/library.js';
import { extensions, isExtensionAllowed, isSourceConfigured, isUnavailableMangaSource, SOURCE_CONFIG_CHANGE_EVENT } from '../lib/extensions.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { settings } from '../lib/settings.js';
import { lastSearch, scrollMemory, rememberMangaPreview, catalogScroll, sourceCatalogState, MANGA_CATALOG_HOME_EVENT, SOURCE_CATALOG_HOME_EVENT, rememberExploreTab, rememberExploreLocation, MAX_SEARCH_RESULTS } from '../lib/searchState.js';
import { clearSearchCoverCache, createSearchCoverBatch, preloadSearchCover } from '../lib/covers.js';
import MangaCard from '../components/MangaCard.jsx';
import ExtensionsPanel from '../components/ExtensionsPanel.jsx';
import SourcesCatalog from '../components/SourcesCatalog.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { Button, buttonVariants } from '../components/ui/button.jsx';
import { Dialog } from '../components/ui/dialog.jsx';
import { Input } from '../components/ui/input.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px, fontPx } from '../lib/useScale.js';
import SubrouteTabLabel from '../components/SubrouteTabLabel.jsx';
import { useResponsiveCoverSize } from '../lib/useResponsiveCoverSize.js';
import { useI18n } from '../lib/i18n.js';
import { migrateSavedManga } from '../lib/mangaMigration.js';
import { attachHorizontalScrollFade } from '../lib/horizontalScrollFade.js';

const TABS = [
  { id: 'mangas', label: 'Mangas' },
  { id: 'extensiones', label: 'Extensiones' },
  { id: 'fuentes', label: 'Catálogos' }
];

const catalogScroller = () => Array.from(document.querySelectorAll('.catalog-page-scroll')).find((element) => element.offsetParent !== null) || document.querySelector('main');

const enabledSources = (showAdultExtensions) => extensions.sources().filter(({ manifest }) =>
  isExtensionAllowed(manifest, showAdultExtensions) && isSourceConfigured(manifest)
);

const normalizeMangaTitle = (title) => String(title || '').trim().normalize('NFKC').toLocaleLowerCase();

function waitForDirectCover(url) {
  if (!url) return Promise.resolve(false);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    const timer = setTimeout(() => finish(false), 10_000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

const EXT_CONFIG_KEY = 'cytlex:ext-config:v1';

const sourceLangSubtitle = (manifest) => {
  const options = Array.isArray(manifest.config?.languages) ? manifest.config.languages : null;
  if (!options || !options.length) return '';
  const defaults = Array.isArray(manifest.config.default) && manifest.config.default.length
    ? manifest.config.default
    : options.map((l) => l.code);
  let cur = null;
  try { cur = JSON.parse(localStorage.getItem(EXT_CONFIG_KEY))?.[manifest.id]?.languages; } catch {}
  const codes = Array.isArray(cur) ? cur : defaults;
  return codes.map((c) => options.find((l) => l.code === c)?.label || c).join(' · ');
};

function SourceSection({ r, coverSize, scale = 1, animate = false, active = true, onMangaSelect, returnTo = '', savedMangaKeys, hideSavedManga = false }) {
  const { t: tr } = useI18n();
  const prefersReducedMotion = useReducedMotion();
  const trackRef = useRef(null);
  const mainRef = useRef(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useLayoutEffect(() => {
    mainRef.current = catalogScroller();
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
    ? (trackWidth - gap * (columns - 1)) / columns
    : coverSize;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || !active) return;
    el.scrollLeft = catalogScroll.get(r.id);
    measure();
  }, [r.id, r.items.length, active]);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const save = () => { if (active) catalogScroll.set(r.id, el.scrollLeft); };
    el.addEventListener('scroll', save, { passive: true });
    return () => el.removeEventListener('scroll', save);
  }, [r.id, active]);

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
  const hasCarousel = trackWidth > 0 && visible.length > columns;

  return (
    <motion.section
      className="mb-[var(--source-gap)] last:mb-0"
      style={{
        '--source-gap': `${Math.max(16, Math.round(24 * scale))}px`,
        marginTop: 0
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
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate font-semibold" style={{ fontSize: fontPx(14, scale) }}>
              {r.manifest.name}
            </h3>
            <span className="shrink-0 text-muted-foreground" style={{ fontSize: fontPx(12, scale) }}>
              · {visibleItems.length}
            </span>
          </div>
          {(() => {
            const langs = sourceLangSubtitle(r.manifest);
            if (!langs) return null;
            return (
              <div className="text-muted-foreground truncate" style={{ fontSize: fontPx(11, scale) }}>
                {langs}
              </div>
            );
          })()}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {(visibleItems.length > 15 || (r.hasMore && canRight)) && (
            <a
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hover:bg-transparent hover:text-foreground')}
              href={`#/resultados?s=${encodeURIComponent(r.id)}`}
              style={{ fontSize: fontPx(14, scale) }}
            >
              Ver todos <ChevronRight className="w-4 h-4 ml-1.5" />
            </a>
          )}
        </div>
      </div>
      {!visibleItems.length ? (
        <p className="text-sm text-muted-foreground">
          {r.status === 'error'
            ? r.errorMessage || 'No se pudo buscar en esta extensión.'
            : r.items.length
              ? 'Los resultados de esta página ya están en Biblioteca.'
              : 'Sin resultados en esta extensión.'}
        </p>
      ) : (
      <div className="relative">
        <div className="min-w-0">
          <div
            ref={trackRef}
            id={`source-results-${r.id}`}
            onScroll={measure}
            className="flex w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              gap: `${gap}px`,
              scrollSnapType: 'x proximity'
            }}
          >
            {visible.map((m, i) => (
              <div
                key={i}
                className="shrink-0"
                style={{ scrollSnapAlign: 'start', width: cardWidth || 150 }}
              >
                <MangaCard
                  m={m}
                  sourceId={r.id}
                  from="explorar"
                  bundledCoverOnly={!window.cytlex?.fetchImage}
                  returnTo={returnTo}
                  onSelect={(manga, sourceId) => {
                    catalogScroll.set(r.id, trackRef.current?.scrollLeft || 0);
                    onMangaSelect?.(manga, sourceId);
                  }}
                  coverSize={cardWidth}
                  showAuthor={false}
                  savedInLibrary={isLibraryManga(m, r.id, savedMangaKeys)}
                />
              </div>
            ))}
          </div>
        </div>
          {hasCarousel && (
            <div className="pointer-events-none absolute inset-0 z-10 hidden md:block">
              <AnimatePresence initial={false}>
                {canLeft && (
                  <motion.button key="left" type="button" onClick={() => step(-1)} aria-label={tr('Desplazar resultados a la izquierda')} aria-controls={`source-results-${r.id}`} title={tr('Ver mangas anteriores')}
                    initial={{ opacity: 0, transform: `translateY(-50%) translateX(${prefersReducedMotion ? 0 : -4}px)` }}
                    animate={{ opacity: 1, transform: 'translateY(-50%) translateX(0)' }}
                    exit={{ opacity: 0, transform: `translateY(-50%) translateX(${prefersReducedMotion ? 0 : -4}px)` }}
                    transition={{ duration: prefersReducedMotion ? 0.1 : 0.16, ease: [0.23, 1, 0.32, 1] }}
                    className="catalog-scroll-button pointer-events-auto grid shrink-0 place-items-center bg-transparent focus-visible:outline-none"
                    style={{ position: 'absolute', left: 0, top: '50%', width: `${Math.max(48, Math.round(40 * scale))}px`, height: `${Math.max(48, Math.round(40 * scale))}px` }}>
                    <span className="catalog-scroll-control" style={{ width: `${Math.max(32, Math.round(32 * scale))}px`, height: `${Math.max(32, Math.round(32 * scale))}px` }}>
                      <ChevronLeft aria-hidden="true" strokeWidth={2.25} style={{ width: `${Math.max(18, Math.round(18 * scale))}px`, height: `${Math.max(18, Math.round(18 * scale))}px` }} />
                    </span>
                  </motion.button>
                )}
                {canRight && (
                  <motion.button key="right" type="button" onClick={() => step(1)} aria-label={tr('Desplazar resultados a la derecha')} aria-controls={`source-results-${r.id}`} title={tr('Ver más mangas')}
                    initial={{ opacity: 0, transform: `translateY(-50%) translateX(${prefersReducedMotion ? 0 : 4}px)` }}
                    animate={{ opacity: 1, transform: 'translateY(-50%) translateX(0)' }}
                    exit={{ opacity: 0, transform: `translateY(-50%) translateX(${prefersReducedMotion ? 0 : 4}px)` }}
                    transition={{ duration: prefersReducedMotion ? 0.1 : 0.16, ease: [0.23, 1, 0.32, 1] }}
                    className="catalog-scroll-button pointer-events-auto grid shrink-0 place-items-center bg-transparent focus-visible:outline-none"
                    style={{ position: 'absolute', right: 0, top: '50%', width: `${Math.max(48, Math.round(40 * scale))}px`, height: `${Math.max(48, Math.round(40 * scale))}px` }}>
                    <span className="catalog-scroll-control" style={{ width: `${Math.max(32, Math.round(32 * scale))}px`, height: `${Math.max(32, Math.round(32 * scale))}px` }}>
                      <ChevronRight aria-hidden="true" strokeWidth={2.25} style={{ width: `${Math.max(18, Math.round(18 * scale))}px`, height: `${Math.max(18, Math.round(18 * scale))}px` }} />
                    </span>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
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
let activeSearchKey = '';

const Catalog = memo(function Catalog({ locationOverride, tutorialPreview = false, active = true, migrationInline = null }) {
  const { language, t: tr } = useI18n();
  const loc = locationOverride;
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(loc.search);
  const excludedSourceId = searchParams.get('excludeSource') || '';
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
  const tabsRef = useRef(null);
  const toolbarRef = useRef(null);
  const searchRef = useRef(null);
  const [searchWrapped, setSearchWrapped] = useState(false);
  const scrollAreaRef = useRef(null);
  const coverBatchRef = useRef(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
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
  const prefersReducedMotion = useReducedMotion();
  const isBrowserApp = typeof window !== 'undefined' && (!window.cytlex || !!migrationInline);

  useLayoutEffect(() => {
    const area = scrollAreaRef.current;
    if (!isBrowserApp || !active || !area) return undefined;
    const measure = () => setScrollbarWidth(area.offsetWidth - area.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    measure();
    return () => observer.disconnect();
  }, [active, isBrowserApp, tab, results]);

  useEffect(() => settings.subscribe((s) => {
    setShowAdultExtensions(!!s.showAdultExtensions);
    setSources(enabledSources(!!s.showAdultExtensions));
    setCoverSize(s.coverSize);
    setHideSavedManga(!!s.hideSavedManga);
  }), []);
  useEffect(() => {
    if (migrationMode) return;
    sessionTab = tab;
    rememberExploreTab(tab);
    rememberExploreLocation(loc);
  }, [migrationMode, tab, loc.pathname, loc.search]);
  useEffect(() => {
    // Catalog stays mounted behind the manga detail page. Keep its blob URLs
    // alive while those cards are hidden so returning to Explore preserves covers.
    if (tab === 'mangas') return;
    coverBatchRef.current?.cancel();
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

  const cs = useResponsiveCoverSize(coverSize);
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
    ? extensions.sources().filter(({ manifest }) => migrationSourceIds.includes(manifest.id) && isSourceConfigured(manifest))
    : sources;
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const tabs = tabsRef.current;
    const search = searchRef.current;
    if (!toolbar || !tabs || !search) return undefined;
    const measure = () => setSearchWrapped(search.getBoundingClientRect().top >= tabs.getBoundingClientRect().bottom - 1);
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    observer.observe(tabs);
    observer.observe(search);
    measure();
    return () => observer.disconnect();
  }, [tab, catalogSources.length, migrationMode, active]);
  const searching = !!results && results.some((r) => r.status === 'loading');
  const completed = results ? results.filter((r) => r.status !== 'loading') : [];
  const visibleCompleted = migrationMode
    ? completed.filter((r) => migrationSourceIds.includes(r.id) && isSourceConfigured(r.manifest))
    : completed.filter((r) => isExtensionAllowed(r.manifest, showAdultExtensions) && isSourceConfigured(r.manifest));
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
      ? extensions.sources().filter(({ manifest }) => migrationSources.has(manifest.id) && isSourceConfigured(manifest))
      : enabledSources(adultExtensionsEnabled).filter(({ manifest }) => manifest.id !== excludedSourceId);
    if (!list.length && !excludedSourceId) return;
    const searchKey = JSON.stringify([searchQuery, adultExtensionsEnabled, list.map(({ manifest }) => manifest.id).sort()]);
    if (!migrationMode && activeSearchKey === searchKey && lastSearch.results?.some((result) => result.status === 'loading')) return;
    if (!migrationMode) activeSearchKey = searchKey;
    if (!migrationMode) scrollMemory.catalog = 0;
    const main = catalogScroller();
    if (main) main.scrollTop = 0;
    const runId = migrationMode ? ++activeMigrationSearchRun : ++activeSearchRun;
    const searchBatchId = `catalog-search:${migrationMode ? 'migration' : 'global'}:${runId}:${Date.now()}`;
    beginCatalogSearchBatch(searchBatchId, list.map(({ manifest }) => manifest.id));
    coverBatchRef.current?.cancel();
    if (!migrationMode) {
      catalogScroll.clear();
      clearSearchCoverCache();
      animateSearch = true;
      lastSearch.q = searchQuery;
      lastSearch.genre = '';
      lastSearch.adultExtensionsEnabled = adultExtensionsEnabled;
    }
    const coverBatch = createSearchCoverBatch();
    coverBatchRef.current = coverBatch;
    const initialResults = list
      .map((s) => ({ id: s.manifest.id, manifest: s.manifest, status: 'loading', items: [], page: 1, totalPages: 1, hasMore: false }))
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'es', { sensitivity: 'base' }));
    if (migrationMode) migrationSearchSnapshot = { key: migrationSearchKey, results: initialResults };
    else lastSearch.results = initialResults;
    setResults(initialResults);

    const coverJobs = [];
    const sourceJobs = list.map(async (s) => {
      try {
        await extensions.source(s.manifest.id);
        if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
        const params = { q: searchQuery, genre: '', page: 1, __cytlexGlobalSearch: true, __cytlexSearchBatchId: searchBatchId };
        const r = await api.catalog(params, s.manifest.id);
        if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
        const items = (r.items || []).filter((m) =>
          (!migrationMode || isUnavailableMangaSource(migrationFromSource) || normalizeMangaTitle(m.title) === normalizeMangaTitle(migrationQuery)) &&
          (s.manifest.id !== 'mangalect' || String(m.lastChapter || '').trim())
        ).slice(0, MAX_SEARCH_RESULTS);
        const coverPromises = items.map((m) => window.cytlex?.fetchImage
          ? preloadSearchCover(m.cover)
          : coverBatch.preload(m.cover));
        const directCoverPromises = [];
        items.forEach((m) => {
          if (!window.cytlex?.fetchImage && m.cover && browserImageUrl(m.cover) === m.cover) {
            directCoverPromises.push(waitForDirectCover(m.cover));
          }
        });
        coverBatch.flushBundled();
        items.forEach((m) => rememberMangaPreview(m, s.manifest.id));
        coverJobs.push((async () => {
          const loadedCovers = await Promise.all(coverPromises);
          await Promise.all(directCoverPromises);
          if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
          const readyItems = items.map((item, index) => loadedCovers[index]
            ? { ...item, coverCached: loadedCovers[index] }
            : item);
          updateResults((prev) => prev ? prev.map((result) => (result.id === s.manifest.id
            ? {
                ...result,
                status: 'done',
                items: readyItems,
                page: r.page || 1,
                totalPages: r.totalPages || 1,
                hasMore: items.length < MAX_SEARCH_RESULTS && (r.hasMore ?? (r.totalPages > 1)),
                totalText: r.totalText || ''
              }
            : result)) : prev);
        })().catch((error) => {
          if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
          const errorMessage = sourceErrorMessage(error, s.manifest.name);
          updateResults((prev) => prev ? prev.map((result) => result.id === s.manifest.id ? { ...result, status: 'error', errorMessage } : result) : prev);
        }));
      } catch (e) {
        console.warn('[Cytlex] búsqueda falló en', s.manifest.id, e?.message || e);
        if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
        const errorMessage = sourceErrorMessage(e, s.manifest.name);
        updateResults((prev) => (prev ? prev.map((x) => (x.id === s.manifest.id ? { ...x, status: 'error', errorMessage } : x)) : prev));
        return null;
      } finally {
        finishCatalogSearchBatchSource(searchBatchId, s.manifest.id);
      }
    });
    void Promise.allSettled(sourceJobs).then(async () => {
      if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
      const coverFlush = coverBatch.flush();
      await Promise.allSettled(coverJobs);
      await coverFlush;
      if (runId !== (migrationMode ? activeMigrationSearchRun : activeSearchRun)) return;
      if (!migrationMode && activeSearchKey === searchKey) activeSearchKey = '';
    });
  };

  useEffect(() => {
    const onSourceConfigChange = () => {
      setSources(enabledSources(!!settings.get().showAdultExtensions));
      if (!active) return;
      if (migrationMode) runSearch();
      else if (tab === 'mangas' && lastSearch.q) runSearch(lastSearch.q);
    };
    window.addEventListener(SOURCE_CONFIG_CHANGE_EVENT, onSourceConfigChange);
    return () => window.removeEventListener(SOURCE_CONFIG_CHANGE_EVENT, onSourceConfigChange);
  }, [active, migrationMode, tab, migrationSearchKey]);

  const openMangaDetail = (manga, sourceId) => {
    const params = new URLSearchParams({ u: manga.url, s: sourceId, from: migrationInline?.origin || 'explorar' });
    if (migrationMode) params.set('back', migrationInline?.returnTo || `/explorar?${loc.search.replace(/^\?/, '')}`);
    setMigrationSelection(null);
    setMigrationError('');
    navigate(`/manga?${params.toString()}`);
  };

  const navigateToTab = (nextTab) => {
    if (!nextTab || nextTab === tab) return;
    setTab(nextTab);
    const params = new URLSearchParams(loc.search);
    params.set('tab', nextTab);
    params.delete('source');
    params.delete('q');
    params.delete('quick');
    params.delete('migrationFrom');
    params.delete('migrationSource');
    params.delete('migrationTargets');
    navigate({ pathname: loc.pathname, search: `?${params}` }, { replace: true });
  };

  const returnWithinActiveTab = () => {
    if (tab === 'fuentes' && searchParams.has('source')) {
      window.dispatchEvent(new Event(SOURCE_CATALOG_HOME_EVENT));
      return;
    }
    if (tab !== 'mangas' || migrationMode || (!q.trim() && !results)) return;

    activeSearchRun += 1;
    activeSearchKey = '';
    coverBatchRef.current?.cancel();
    lastSearch.q = '';
    lastSearch.genre = '';
    lastSearch.results = null;
    setQ('');
    setResults(null);
    const params = new URLSearchParams(loc.search);
    params.delete('q');
    params.delete('quick');
    const search = params.toString();
    navigate({ pathname: loc.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };

  useEffect(() => {
    const onMangaCatalogHome = () => returnWithinActiveTab();
    window.addEventListener(MANGA_CATALOG_HOME_EVENT, onMangaCatalogHome);
    return () => window.removeEventListener(MANGA_CATALOG_HOME_EVENT, onMangaCatalogHome);
  }, [loc.pathname, loc.search, q, results, tab, migrationMode]);

  const confirmMigration = async () => {
    if (!migrationSelection || migrationBusy || !migrationFromUrl || !migrationFromSource) return;
    setMigrationBusy(true);
    setMigrationError('');
    try {
      const targetSourceId = migrationSelection.sourceId;
      const originalDetail = isUnavailableMangaSource(migrationFromSource)
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
    if (!migrationMode && !searchParams.get('q') && tab !== 'fuentes' && lastSearch.results?.some((r) => r.status === 'loading')) {
      runSearch(lastSearch.q);
    }
  }, [migrationMode]);

  useEffect(() => {
    const t = new URLSearchParams(loc.search).get('tab');
    if (t === 'mangas' || t === 'extensiones' || t === 'fuentes') setTab(t);
  }, [loc.search]);

  const revealCatalogTab = (tabElement) => {
    const nav = tabsRef.current;
    if (!nav || !tabElement) return;

    const navBounds = nav.getBoundingClientRect();
    const tabBounds = tabElement.getBoundingClientRect();
    const safeInset = Number.parseFloat(px(16, scale, 12));
    const leftEdge = navBounds.left + safeInset;
    const rightEdge = navBounds.right - safeInset;
    const scrollOptions = { behavior: prefersReducedMotion ? 'auto' : 'smooth' };

    if (tabBounds.left < leftEdge) {
      nav.scrollBy({ ...scrollOptions, left: tabBounds.left - leftEdge });
    } else if (tabBounds.right > rightEdge) {
      nav.scrollBy({ ...scrollOptions, left: tabBounds.right - rightEdge });
    }
  };

  useEffect(() => {
    revealCatalogTab(tabsRef.current?.querySelector('[aria-current="page"]'));
  }, [tab, prefersReducedMotion, scale]);

  useLayoutEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return undefined;
    const revealActive = () => revealCatalogTab(nav.querySelector('[aria-current="page"]'), 'auto');
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(revealActive) : null;
    observer?.observe(nav);
    window.addEventListener('resize', revealActive);
    revealActive();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', revealActive);
    };
  }, [tab, scale]);

  useEffect(() => attachHorizontalScrollFade(tabsRef.current), []);

  useLayoutEffect(() => {
    const main = catalogScroller();
    if (main) main.scrollLeft = 0;
  }, [tab, loc.pathname]);

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
        const main = catalogScroller();
        if (main) main.scrollTop = scrollMemory.catalog;
        return;
      }
      runSearch(nq);
    }
  }, [loc.search]);

  return (
    <div
      className={isBrowserApp ? 'flex h-full min-h-0 min-w-0 flex-col' : 'min-h-full min-w-0 flex flex-col'}
      data-explore-start={tab === 'extensiones' || tab === 'fuentes' || (!q.trim() && !results) ? 'true' : 'false'}
      style={isBrowserApp ? { padding: `var(--web-page-padding, 16px) ${px(16, scale, 12)} 0` } : undefined}
    >
      <div
        ref={toolbarRef}
        className={cn(
          'catalog-toolbar -mt-2 max-md:-mt-3 shrink-0 items-center border-b border-border/70 bg-sidebar mb-3',
          'flex flex-wrap',
          tab !== 'mangas' && 'flex-nowrap'
        )}
        style={{
          columnGap: `${Math.max(16, Math.round(24 * scale))}px`,
          rowGap: 0,
          alignContent: 'flex-start',
          marginBottom: isBrowserApp ? 0 : `${Math.max(8, Math.round(12 * scale))}px`,
          minHeight: px(38, scale, 34),
          height: tab !== 'mangas' ? px(38, scale, 34) : undefined,
          marginTop: isBrowserApp ? 'calc(-1 * var(--web-page-padding, 0px))' : undefined,
          marginLeft: isBrowserApp ? `-${px(16, scale, 12)}` : undefined,
          marginRight: isBrowserApp ? `-${px(16, scale, 12)}` : undefined,
          paddingLeft: px(16, scale, 12),
          paddingRight: px(16, scale, 12),
          paddingBottom: tab === 'mangas' && searchWrapped && catalogSources.length > 0 && !migrationMode ? px(3, scale, 3) : 0
        }}
      >
        <div
          ref={tabsRef}
          data-catalog-subroutes
          className={cn(
            'flex w-max max-w-full flex-nowrap items-center overflow-x-auto overscroll-x-contain whitespace-nowrap no-scrollbar',
            tab === 'mangas' && 'shrink-0'
          )}
          style={{
            gap: px(24, scale, 16),
            height: tab === 'mangas' ? `calc(${px(38, scale, 34)} - 1px)` : undefined,
            minHeight: tab === 'mangas' ? undefined : px(38, scale, 34)
          }}
        >
          {migrationInline ? (
            <Button
              size="sm"
              variant="ghost"
              className="subroute-back-button -ml-3 hover:bg-transparent hover:text-foreground"
              onClick={(e) => { e.currentTarget.blur(); migrationInline.onBack(); }}
              style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(8, scale, 6), paddingRight: px(8, scale, 6) }}
            >
              <ChevronLeft className="mr-1" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
              {tr('Volver')}
            </Button>
          ) : TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={(event) => {
                  if (active) {
                    revealCatalogTab(event.currentTarget);
                    const main = catalogScroller();
                    if (main?.scrollTop > 1) {
                      main.scrollTo({ top: 0, behavior: 'smooth' });
                      return;
                    }
                    returnWithinActiveTab();
                    return;
                  }
                  navigateToTab(t.id);
                }}
                className={cn(
                  'group relative shrink-0 p-0 transition-colors'
                )}
                aria-current={active ? 'page' : undefined}
                style={{ fontSize: fontPx(14, scale), scrollMarginInline: px(16, scale, 12) }}
              >
                <SubrouteTabLabel active={active}>{tr(t.label)}</SubrouteTabLabel>
              </button>
            );
          })}
        </div>

        {tab === 'extensiones' && (
          <div
            id="extensions-toolbar"
            className="ml-auto flex shrink-0 items-center self-center empty:hidden max-md:justify-end"
            style={{ gap: px(8, scale, 6) }}
          />
        )}

        {tab === 'fuentes' && (
          <div
            id="sources-toolbar"
            className="ml-auto flex shrink-0 items-center self-center empty:hidden max-md:justify-end"
            style={{ gap: px(8, scale, 6) }}
          />
        )}

        {tab === 'mangas' && catalogSources.length > 0 && !migrationMode && (
          <div
            ref={searchRef}
            className="catalog-search ml-auto flex min-w-0 flex-1 items-center self-center"
            style={{
              flexBasis: px(280, scale, 240),
              minWidth: `min(100%, ${px(280, scale, 240)})`,
              height: px(32, scale, 28),
              gap: px(12, scale, 9)
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Input
                className="bg-card border-border/70"
                placeholder={tr('Buscar en todas las extensiones...')}
                value={q}
                onChange={(e) => { setQ(e.target.value); lastSearch.q = e.target.value; }}
                enterKeyHint="search"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && q.trim()) {
                    e.preventDefault();
                    e.currentTarget.blur();
                    runSearch();
                  }
                }}
                style={{
                  height: px(32, scale, 28),
                  fontSize: fontPx(14, scale),
                  paddingLeft: px(12, scale, 9),
                  paddingRight: px(40, scale, 34)
                }}
              />
              <button
                type="button"
                aria-label={tr('Buscar en todas las extensiones')}
                onClick={() => runSearch()}
                disabled={!q.trim()}
                className="absolute inset-y-0 right-0 grid place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-40"
                style={{ width: px(36, scale, 30) }}
              >
                <Search aria-hidden="true" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        ref={scrollAreaRef}
        className={isBrowserApp ? 'page-content-scroll catalog-page-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain' : ''}
        style={isBrowserApp ? { marginRight: `-${px(16, scale, 12)}`, paddingRight: `max(0px, ${px(16, scale, 12)} - ${scrollbarWidth}px)`, paddingTop: px(12, scale, 10), paddingBottom: px(12, scale, 10) } : undefined}
        onScroll={isBrowserApp ? (event) => {
          const scrollArea = event.currentTarget;
          scrollArea.classList.add('is-scrolling');
          window.clearTimeout(scrollArea._scrollbarTimer);
          scrollArea._scrollbarTimer = window.setTimeout(() => scrollArea.classList.remove('is-scrolling'), 700);
        } : undefined}
      >
      {tab === 'mangas' ? (
        catalogSources.length === 0 ? (
          <EmptyState
            face="（눈﹏눈）"
            title={tr('No hay extensiones instaladas')}
          />
        ) : (
          <>
            {!results && (
              <EmptyState
                face="(・_・)？"
                tone="prompt"
                title={tr('Busca un manga para empezar')}
              />
            )}

            {results && (
              <>
                  {searching && (
                  <div
                    className="flex items-center gap-2.5 text-muted-foreground"
                    style={{
                      minHeight: px(32, scale, 28),
                      marginBottom: `${Math.max(10, Math.round(16 * scale))}px`
                    }}
                    role="status"
                  >
                    <Loader2 className="animate-spin" style={{ width: px(20, scale, 16), height: px(20, scale, 16) }} />
                    <p className="text-sm">
                      {language === 'en' ? `Searching ${catalogSources.length} ${catalogSources.length === 1 ? 'extension' : 'extensions'}...` : `Buscando en ${catalogSources.length} ${catalogSources.length === 1 ? 'extensión' : 'extensiones'}...`}
                    </p>
                  </div>
                )}

                {done && completed.length > 0 && visibleCompleted.length === 0 ? (
                  <EmptyState
                    face="（・_・）"
                    title={tr('No hay extensiones visibles')}
                    description={tr('Activa «Mostrar extensiones +18» en Ajustes > Extensiones para mostrarlas.')}
                  />
                ) : !migrationMode && hideSavedManga && done && searchItems.length > 0 && visibleSearchItemCount === 0 ? (
                  <EmptyState
                    face="（・_・）"
                    title={tr('No hay mangas nuevos')}
                    description={tr('Los mangas encontrados ya están en Biblioteca. Puedes desactivar «Ocultar mangas ya guardados» en Ajustes > Biblioteca.')}
                  />
                ) : visibleCompleted.map((r) => (
                  <SourceSection
                    key={r.id}
                    r={r}
                    coverSize={cs}
                    scale={scale}
                    animate={animateSearch || migrationMode}
                    active={active}
                    onMangaSelect={(manga, sourceId) => {
                      if (migrationMode) {
                        setMigrationError('');
                        setMigrationSelection({ manga, sourceId });
                        return;
                      }
                      const main = catalogScroller();
                      if (main) scrollMemory.catalog = main.scrollTop;
                      openMangaDetail(manga, sourceId);
                    }}
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
        <ExtensionsPanel tutorialPreview={tutorialPreview} active={active} />
      ) : (
        <SourcesCatalog
          sources={sources}
          initialSourceId={new URLSearchParams(loc.search).get('source') || ''}
          active={active}
          savedMangaKeys={savedMangaKeys}
          hideSavedManga={hideSavedManga}
        />
      )}
      </div>

      <Dialog
        open={!!migrationSelection}
        onClose={() => { if (!migrationBusy) { setMigrationSelection(null); setMigrationError(''); } }}
        scale={scale}
        dialogStyle={{ maxWidth: px(480, scale, 380) }}
        title={tr('Manga encontrado')}
        description={tr('Confirma que es el manga que quieres migrar o abre su ficha para revisarlo.')}
      >
        {migrationSelection && (
          <>
            <div className="flex items-center border-b border-border" style={{ gap: px(14, scale, 10), paddingBottom: px(16, scale, 12) }}>
              {migrationSelection.manga.cover ? (
                <img src={migrationSelection.manga.cover} alt="" className="manga-cover-corners aspect-[5/7] shrink-0 rounded-sm object-cover" style={{ width: px(72, scale, 58) }} />
              ) : <div className="manga-cover-corners aspect-[5/7] shrink-0 rounded-lg bg-muted" style={{ width: px(72, scale, 58) }} />}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-semibold" style={{ fontSize: fontPx(17, scale, 14) }}>{migrationSelection.manga.title}</div>
                {migrationSelection.manga.author && <div className="mt-1 truncate text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11) }}>{migrationSelection.manga.author}</div>}
                <div className="mt-2"><SourceBadge m={extensions.manifest(migrationSelection.sourceId)} /></div>
              </div>
            </div>
            {migrationError && <p role="alert" className="text-destructive" style={{ marginTop: px(12, scale, 9), fontSize: fontPx(13, scale, 11) }}>{migrationError}</p>}
            <div className="flex justify-end" style={{ gap: px(8, scale, 6), paddingTop: px(16, scale, 12) }}>
              <Button
                variant="secondary"
                disabled={migrationBusy}
                onClick={() => openMangaDetail(migrationSelection.manga, migrationSelection.sourceId)}
                style={{ height: px(38, scale, 31), padding: `0 ${px(12, scale, 10)}`, fontSize: fontPx(14, scale, 12) }}
              >
                {tr('Ver manga')}
              </Button>
              <Button
                disabled={migrationBusy}
                onClick={confirmMigration}
                style={{ height: px(38, scale, 31), padding: `0 ${px(12, scale, 10)}`, fontSize: fontPx(14, scale, 12) }}
              >
                {tr(migrationBusy ? 'Migrando…' : 'Confirmar migración')}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
});

export default Catalog;
