import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Loader2, ChevronRight, ChevronLeft, CircleHelp } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { extensions, isAdultExtension } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { lastSearch, scrollMemory, rememberCover, catalogScroll, MAX_SEARCH_RESULTS } from '../lib/searchState.js';
import { clearSearchCoverCache, preloadSearchCover } from '../lib/covers.js';
import MangaCard from '../components/MangaCard.jsx';
import ExtensionsPanel from '../components/ExtensionsPanel.jsx';
import SourcesCatalog from '../components/SourcesCatalog.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { Button, buttonVariants } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

const TABS = [
  { id: 'mangas', label: 'Mangas' },
  { id: 'extensiones', label: 'Extensiones' },
  { id: 'fuentes', label: 'Fuentes' }
];

const enabledSources = (showAdultExtensions) => extensions.sources().filter(({ manifest }) =>
  showAdultExtensions || !isAdultExtension(manifest)
);

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

function SourceSection({ r, coverSize, scale = 1, first = false, animate = false }) {
  const trackRef = useRef(null);
  const mainRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    mainRef.current = document.querySelector('main');
  }, []);

  useEffect(() => {
    if (scrollMemory.catalog > 0 && mainRef.current) {
      mainRef.current.scrollTop = scrollMemory.catalog;
      scrollMemory.catalog = 0;
    }
  }, [r.id]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const save = () => { scrollMemory.catalog = main.scrollTop; };
    main.addEventListener('scroll', save, { passive: true });
    return () => main.removeEventListener('scroll', save);
  }, []);

  const gap = Math.max(8, Math.round(12 * scale));

  const measure = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    measure();
    const el = trackRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [r.items.length, coverSize]);

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
    el.scrollBy({ left: dir * (coverSize + 20) * 2, behavior: 'smooth' });
  };

  const visible = r.items.slice(0, 15);

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
          · {r.items.length}
        </span>
      </div>
      {!r.items.length ? (
        <p className="text-sm text-muted-foreground">
          {r.status === 'error' ? 'No se pudo buscar en esta extensión.' : 'Sin resultados en esta extensión.'}
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
          {visible.map((m, i) => (
            <div
              key={i}
              className="shrink-0"
              style={{ scrollSnapAlign: 'start', width: coverSize || 150 }}
            >
              <MangaCard m={m} sourceId={r.id} from="explorar" coverSize={coverSize} showAuthor={false} />
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
        {(r.items.length > 15 || r.hasMore) && (
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

export default function Catalog({ tutorialPreview = false }) {
  const loc = useLocation();
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(loc.search).get('tab');
    return t === 'mangas' || t === 'extensiones' || t === 'fuentes' ? t : sessionTab;
  });
  const [sources, setSources] = useState(() => enabledSources(!!settings.get().showAdultExtensions));
  const [q, setQ] = useState(() => lastSearch.q);
  const [results, setResults] = useState(() => lastSearch.results);
  const [coverSize, setCoverSize] = useState(() => Math.round(160 * (settings.get().uiScale || 1)));
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const scale = useScale();

  useEffect(() => settings.subscribe((s) => {
    setCoverSize(Math.round(160 * (s.uiScale || 1)));
    setShowAdultExtensions(!!s.showAdultExtensions);
    setSources(enabledSources(!!s.showAdultExtensions));
  }), []);
  useEffect(() => { sessionTab = tab; }, [tab]);
  useEffect(() => () => {
    if (tutorialPreview) sessionTab = 'mangas';
  }, [tutorialPreview]);
  useEffect(() => () => { animateSearch = false; }, []);

  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);

  useEffect(() => {
    setSources(enabledSources(!!settings.get().showAdultExtensions));
  }, [tab]);

  const searching = !!results && results.some((r) => r.status === 'loading');
  const completed = results ? results.filter((r) => r.status !== 'loading') : [];
  const visibleCompleted = completed.filter((r) => showAdultExtensions || !isAdultExtension(r.manifest));
  const done = !!results && !searching;

  useEffect(() => { if (done) animateSearch = false; }, [done]);

  const updateResults = (fn) => {
    lastSearch.results = fn(lastSearch.results);
    setResults(lastSearch.results);
  };

  const runSearch = (query = q) => {
    const list = enabledSources(!!settings.get().showAdultExtensions);
    if (!list.length) return;
    const runId = ++activeSearchRun;
    catalogScroll.clear();
    clearSearchCoverCache();
    animateSearch = true;
    lastSearch.q = query;
    lastSearch.genre = '';
    lastSearch.results = list
      .map((s) => ({ id: s.manifest.id, manifest: s.manifest, status: 'loading', items: [], page: 1, totalPages: 1, hasMore: false }))
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'es', { sensitivity: 'base' }));
    setResults(lastSearch.results);

    list.forEach(async (s) => {
      try {
        const r = await api.catalog({ q: query, genre: '', page: 1 }, s.manifest.id);
        const items = (r.items || []).filter((m) =>
          s.manifest.id !== 'mangalect' || String(m.lastChapter || '').trim()
        ).slice(0, MAX_SEARCH_RESULTS);
        const visibleCovers = await Promise.all(items.slice(0, 10).map(async (m) => [
          m.url,
          await preloadSearchCover(m.cover)
        ]));
        const cachedCovers = new Map(visibleCovers.filter(([, cover]) => cover));
        const loadedItems = items.map((m) => cachedCovers.has(m.url)
          ? { ...m, coverCached: cachedCovers.get(m.url) }
          : m);
        items.forEach((m) => rememberCover(m.url, m.cover));
        if (runId !== activeSearchRun) return;
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
        if (runId !== activeSearchRun) return;
        updateResults((prev) => (prev ? prev.map((x) => (x.id === s.manifest.id ? { ...x, status: 'error' } : x)) : prev));
      }
    });
  };

  useEffect(() => {
    if (tab !== 'fuentes' && lastSearch.results && lastSearch.results.some((r) => r.status === 'loading')) {
      runSearch(lastSearch.q);
    }
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(loc.search).get('tab');
    if (t === 'mangas' || t === 'extensiones' || t === 'fuentes') setTab(t);
  }, [loc.search]);

  useEffect(() => {
    const params = new URLSearchParams(loc.search);
    const nq = params.get('q') || '';
    if (nq && params.get('tab') !== 'fuentes') {
      setQ(nq);
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
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
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

        {tab === 'mangas' && sources.length > 0 && (
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
        sources.length === 0 ? (
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
                      Buscando en {sources.length} {sources.length === 1 ? 'extensión' : 'extensiones'}...
                    </p>
                  </div>
                )}

                {done && completed.length > 0 && visibleCompleted.length === 0 ? (
                  <EmptyState
                    face="（・_・）"
                    title="No hay extensiones visibles"
                    description="Activa «Mostrar extensiones +18» en Ajustes > Extensiones para mostrarlas."
                  />
                ) : visibleCompleted.map((r, i) => (
                  <SourceSection key={r.id} r={r} coverSize={cs} scale={scale} first={i === 0} animate={animateSearch} />
                ))}
              </>
            )}
          </>
        )
      ) : tab === 'extensiones' ? (
        <ExtensionsPanel tutorialPreview={tutorialPreview} />
      ) : (
        <SourcesCatalog sources={sources} />
      )}
    </div>
  );
}
