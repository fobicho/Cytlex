import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { extensions } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { lastSearch, testCover, scrollMemory, rememberCover } from '../lib/searchState.js';
import MangaCard from '../components/MangaCard.jsx';
import ExtensionsPanel from '../components/ExtensionsPanel.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { Button, buttonVariants } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';

const TABS = [
  { id: 'mangas', label: 'Mangas' },
  { id: 'extensiones', label: 'Extensiones' }
];

function SourceSection({ r, coverSize }) {
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
    if (el) el.scrollLeft = 0;
  }, [r.id, r.items.length]);

  const step = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (coverSize + 20) * 2, behavior: 'smooth' });
  };

  const visible = r.items.slice(0, 15);

  return (
    <motion.section
      className="mb-10"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div className="flex items-center gap-2.5 mb-4">
        <SourceBadge m={r.manifest} />
        <h3 className="text-sm font-semibold">{r.manifest.name}</h3>
        <span className="text-xs text-muted-foreground">· {r.items.length}</span>
      </div>
      <div className="relative">
        <div
          ref={trackRef}
          onScroll={measure}
          className="flex gap-5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollSnapType: 'x proximity' }}
        >
          {visible.map((m, i) => (
            <div key={i} className="shrink-0" style={{ scrollSnapAlign: 'start', width: coverSize || 150 }}>
              <MangaCard m={m} sourceId={r.id} from="explorar" coverSize={coverSize} />
            </div>
          ))}
        </div>
        {canLeft && (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Ver mangas anteriores"
            className="absolute -left-3 top-[38%] z-10 grid h-9 w-9 place-items-center rounded-full border border-border bg-background/90 text-foreground shadow-md backdrop-blur-sm transition hover:bg-background"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {canRight && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Ver más mangas"
            className="absolute -right-3 top-[38%] z-10 grid h-9 w-9 place-items-center rounded-full border border-border bg-background/90 text-foreground shadow-md backdrop-blur-sm transition hover:bg-background"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
        {r.items.length > 15 && (
          <a
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'absolute -top-11 right-0 hover:bg-transparent hover:text-foreground'
            )}
            href={`#/resultados?s=${encodeURIComponent(r.id)}`}
          >
            Ver todos <ChevronRight className="w-4 h-4 ml-1.5" />
          </a>
        )}
      </div>
    </motion.section>
  );
}

export default function Catalog() {
  const loc = useLocation();
  const [tab, setTab] = useState(() => (new URLSearchParams(loc.search).get('tab') === 'extensiones' ? 'extensiones' : 'mangas'));
  const [sources, setSources] = useState(() => extensions.installed());
  const [q, setQ] = useState(() => lastSearch.q);
  const [results, setResults] = useState(() => lastSearch.results);
  const [coverSize, setCoverSize] = useState(() => settings.get().libraryCoverSize);

  useEffect(() => settings.subscribe((s) => setCoverSize(s.libraryCoverSize)), []);

  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);

  useEffect(() => {
    setSources(extensions.installed());
  }, [tab]);

  const searching = !!results && results.some((r) => r.status === 'loading');
  const withResults = results ? results.filter((r) => r.items.length > 0) : [];
  const done = !!results && !searching;

  const updateResults = (fn) => {
    lastSearch.results = fn(lastSearch.results);
    setResults(lastSearch.results);
  };

  const runSearch = (query = q) => {
    const list = extensions.installed();
    if (!list.length) return;
    lastSearch.q = query;
    lastSearch.genre = '';
    lastSearch.results = list
      .map((s) => ({ id: s.manifest.id, manifest: s.manifest, status: 'loading', items: [] }))
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'es', { sensitivity: 'base' }));
    setResults(lastSearch.results);

    list.forEach((s) => {
      api
        .catalog({ q: query, genre: '', page: 1 }, s.manifest.id)
        .then(async (r) => {
          const items = r.items || [];
          const okFlags = await Promise.all(items.map((m) => testCover(m.cover)));
          const anyOk = okFlags.some(Boolean);
          const good = anyOk ? items.filter((_, i) => okFlags[i]) : items;
          good.forEach((m) => rememberCover(m.url, m.cover));
          updateResults((prev) =>
            prev ? prev.map((x) => (x.id === s.manifest.id ? { ...x, status: 'done', items: good } : x)) : prev
          );
        })
        .catch((e) => {
          console.warn('[Cytlex] búsqueda falló en', s.manifest.id, e?.message || e);
          updateResults((prev) => (prev ? prev.map((x) => (x.id === s.manifest.id ? { ...x, status: 'error' } : x)) : prev));
        });
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
      <div className="-mt-1 flex flex-wrap items-center gap-6 mb-3 min-h-9">
        <div className="flex items-center gap-6">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative pb-2 text-sm font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
                {active && (
                  <motion.span
                    layoutId="catalog-underline"
                    className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-primary"
                    transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {tab === 'mangas' && sources.length > 0 && (
          <div className="ml-auto self-center flex items-center gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                className="h-9 pl-9 bg-muted/50 border-none"
                placeholder="Buscar en todas las extensiones..."
                value={q}
                onChange={(e) => { setQ(e.target.value); lastSearch.q = e.target.value; }}
                onKeyDown={(e) => e.key === 'Enter' && q.trim() && runSearch()}
              />
            </div>
            <Button
              size="sm"
              onClick={() => runSearch()}
              disabled={!q.trim()}
              className={cn('rounded-lg disabled:opacity-40')}
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
            action={
              <Button onClick={() => { window.location.hash = '#/explorar?tab=extensiones'; }}>
                Ir a Extensiones
              </Button>
            }
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
                  <p className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Buscando en {sources.length} {sources.length === 1 ? 'extensión' : 'extensiones'}...
                  </p>
                )}

                {withResults.map((r) => (
                  <SourceSection key={r.id} r={r} coverSize={cs} />
                ))}

                {done && withResults.length === 0 && (
                  <EmptyState
                    face="（・_・）"
                    title="Sin resultados"
                  />
                )}
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

