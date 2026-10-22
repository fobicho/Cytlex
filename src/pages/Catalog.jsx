import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { extensions } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { isAdultManga } from '../lib/contentRating.js';
import { lastSearch, scrollMemory, rememberCover, catalogScroll } from '../lib/searchState.js';
import { clearSearchCoverCache, preloadSearchCover } from '../lib/covers.js';
import MangaCard from '../components/MangaCard.jsx';
import ExtensionsPanel from '../components/ExtensionsPanel.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { Button, buttonVariants } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

function waitForCover(url) {
  if (!url) return Promise.resolve(false);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(loaded);
    };
    const timer = setTimeout(() => finish(false), 15000);
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (!image.naturalWidth) return finish(false);
      image.decode().then(() => finish(true)).catch(() => finish(image.naturalWidth > 0));
    };
    image.onerror = () => finish(false);
    image.src = url;
  });
}

const TABS = [
  { id: 'mangas', label: 'Mangas' },
  { id: 'extensiones', label: 'Extensiones' }
];

function SourceSection({ r, coverSize, scale = 1, first = false, animate = false, showAdult = false }) {
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

  const filteredItems = showAdult ? r.items : r.items.filter((m) => !isAdultManga(m));
  const visible = filteredItems.slice(0, 15);

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
        <h3 className="font-semibold" style={{ fontSize: `${Math.round(14 * scale)}px` }}>
          {r.manifest.name}
        </h3>
        <span className="text-muted-foreground" style={{ fontSize: `${Math.round(12 * scale)}px` }}>
          · {filteredItems.length}
        </span>
      </div>
      {!filteredItems.length ? (
        <p className="text-sm text-muted-foreground">
          {r.status === 'error' ? 'No se pudo buscar en esta extensión.' : r.items.length ? 'No hay resultados visibles con este filtro.' : 'Sin resultados en esta extensión.'}
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
              <MangaCard m={m} sourceId={r.id} from="explorar" coverSize={coverSize} />
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
        {filteredItems.length > 15 && (
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

export default function Catalog() {
  const loc = useLocation();
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(loc.search).get('tab');
    return t === 'mangas' || t === 'extensiones' ? t : sessionTab;
  });
  const [sources, setSources] = useState(() => extensions.installed());
  const [q, setQ] = useState(() => lastSearch.q);
  const [results, setResults] = useState(() => lastSearch.results);
  const [coverSize, setCoverSize] = useState(() => Math.round(160 * (settings.get().uiScale || 1)));
  const [showAdult, setShowAdult] = useState(() => !!settings.get().showAdultManga);
  const scale = useScale();

  useEffect(() => settings.subscribe((s) => {
    setCoverSize(Math.round(160 * (s.uiScale || 1)));
    setShowAdult(!!s.showAdultManga);
  }), []);
  useEffect(() => { sessionTab = tab; }, [tab]);
  useEffect(() => () => { animateSearch = false; }, []);

  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);

  useEffect(() => {
    setSources(extensions.installed());
  }, [tab]);

  const searching = !!results && results.some((r) => r.status === 'loading');
  const completed = results ? results.filter((r) => r.status !== 'loading') : [];
  const done = !!results && !searching;

  useEffect(() => { if (done) animateSearch = false; }, [done]);

  const updateResults = (fn) => {
    lastSearch.results = fn(lastSearch.results);
    setResults(lastSearch.results);
  };

  const runSearch = (query = q) => {
    const list = extensions.installed();
    if (!list.length) return;
    const runId = ++activeSearchRun;
    catalogScroll.clear();
    clearSearchCoverCache();
    animateSearch = true;
    lastSearch.q = query;
    lastSearch.genre = '';
    lastSearch.results = list
      .map((s) => ({ id: s.manifest.id, manifest: s.manifest, status: 'loading', items: [] }))
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'es', { sensitivity: 'base' }));
    setResults(lastSearch.results);

    list.forEach(async (s) => {
      try {
        const r = await api.catalog({ q: query, genre: '', page: 1 }, s.manifest.id);
        const catalogItems = (r.items || []).filter((m) =>
          s.manifest.id !== 'mangalect' || String(m.lastChapter || '').trim()
        );
        const loadedItems = await Promise.all(catalogItems.map(async (m) => {
          const coverCached = await preloadSearchCover(m.cover);
          if (!coverCached && !await waitForCover(m.cover)) return null;
          return { ...m, coverCached };
        }));
        const items = loadedItems.filter(Boolean);
        items.forEach((m) => rememberCover(m.url, m.cover));
        if (runId !== activeSearchRun) return;
        updateResults((prev) =>
          prev ? prev.map((x) => (x.id === s.manifest.id ? { ...x, status: 'done', items } : x)) : prev
        );
      } catch (e) {
        console.warn('[Cytlex] búsqueda falló en', s.manifest.id, e?.message || e);
        if (runId !== activeSearchRun) return;
        updateResults((prev) => (prev ? prev.map((x) => (x.id === s.manifest.id ? { ...x, status: 'error' } : x)) : prev));
      }
    });
  };

  useEffect(() => {
    if (lastSearch.results && lastSearch.results.some((r) => r.status === 'loading')) {
      runSearch(lastSearch.q);
    }
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(loc.search).get('tab');
    if (t === 'mangas' || t === 'extensiones') setTab(t);
  }, [loc.search]);

  useEffect(() => {
    const nq = new URLSearchParams(loc.search).get('q') || '';
    if (nq) {
      setQ(nq);
      runSearch(nq);
    }
  }, [loc.search]);

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
        </div>

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

                {completed.map((r, i) => (
                  <SourceSection key={r.id} r={r} coverSize={cs} scale={scale} first={i === 0} animate={animateSearch} showAdult={showAdult} />
                ))}
              </>
            )}
          </>
        )
      ) : (
        <ExtensionsPanel />
      )}
    </div>
  );
}

