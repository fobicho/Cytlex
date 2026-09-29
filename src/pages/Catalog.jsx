import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, BookOpen, Loader2, Puzzle, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { extensions } from '../lib/extensions.js';
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

const GRID_CLS = 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-8';

function SourceSection({ r }) {
  const gridRef = useRef(null);
  const mainRef = useRef(null);
  const [cols, setCols] = useState(0);

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

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const compute = () => setCols(getComputedStyle(el).gridTemplateColumns.split(' ').length);
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [r.items.length]);

  const overflow = cols > 0 && r.items.length > cols;
  const visible = overflow ? r.items.slice(0, cols) : r.items;

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
        <div ref={gridRef} className={GRID_CLS}>
          {visible.map((m, i) => (
            <MangaCard key={i} m={m} sourceId={r.id} from="explorar" />
          ))}
        </div>
        {overflow && (
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
    lastSearch.results = list.map((s) => ({ id: s.manifest.id, manifest: s.manifest, status: 'loading', items: [] }));
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
      <div className="flex flex-wrap items-start gap-6 mb-6">
        <div className="flex items-center gap-6">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'pb-2 text-sm font-medium border-b-2 transition-colors',
                  active
                    ? 'text-foreground border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground'
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'mangas' && sources.length > 0 && (
          <div className="flex flex-1 flex-col sm:flex-row sm:items-center gap-3 sm:justify-end">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9 bg-muted/50 border-none"
                placeholder="Buscar en todas las extensiones..."
                value={q}
                onChange={(e) => { setQ(e.target.value); lastSearch.q = e.target.value; }}
                onKeyDown={(e) => e.key === 'Enter' && q.trim() && runSearch()}
              />
            </div>
            <Button
              onClick={() => runSearch()}
              disabled={!q.trim()}
              className={cn('disabled:opacity-40')}
            >
              Buscar
            </Button>
          </div>
        )}
      </div>

      {tab === 'mangas' ? (
        sources.length === 0 ? (
          <div className="flex-1 grid place-items-center">
            <EmptyState icon={Puzzle} title="No hay extensiones instaladas" />
          </div>
        ) : (
          <>
            {!results && (
              <div className="flex-1 grid place-items-center text-center text-muted-foreground">
                <div>
                  <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Busca un manga para empezar.</p>
                </div>
              </div>
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
                  <SourceSection key={r.id} r={r} />
                ))}

                {done && withResults.length === 0 && (
                  <div className="flex-1 grid place-items-center">
                    <EmptyState
                      icon={BookOpen}
                      title="Sin resultados"
                      description="Ninguna extensión encontró coincidencias. Prueba con otro título."
                    />
                  </div>
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

