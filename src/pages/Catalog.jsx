import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, AlertTriangle, BookOpen, Filter } from 'lucide-react';
import { api } from '../lib/api.js';
import { extensions } from '../lib/extensions.js';
import MangaCard from '../components/MangaCard.jsx';
import ExtensionsPanel from '../components/ExtensionsPanel.jsx';
import { Card } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';

const GENRES = ['action', 'adventure', 'comedy', 'drama', 'fantasy', 'romance', 'shounen', 'seinen', 'isekai', 'slice-of-life'];

const TABS = [
  { id: 'mangas', label: 'Mangas' },
  { id: 'extensiones', label: 'Extensiones' }
];

export default function Catalog() {
  const loc = useLocation();
  const [tab, setTab] = useState('mangas');
  const [sources, setSources] = useState(() => extensions.installed());
  const [sourceId, setSourceId] = useState('leercapitulo');
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setSources(extensions.installed());
  }, [tab]);

  const runSearch = async (p = 1, query = q, g = genre, src = sourceId) => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.catalog({ q: query, genre: g, page: p }, src);
      setData(r);
      setPage(p);
    } catch (e) {
      console.error('[Cytlex] catalog error:', e);
      setErr(String(e?.message || e));
    }
    setLoading(false);
  };

  useEffect(() => {
    const nq = new URLSearchParams(loc.search).get('q') || '';
    if (nq) {
      setQ(nq);
      runSearch(1, nq, '');
    }
    // eslint-disable-next-line
  }, [loc.search]);

  const changeSource = (id) => {
    setSourceId(id);
    setData(null);
    setErr('');
  };

  const selectClass =
    'h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="min-h-full flex flex-col">
      <div className="flex flex-wrap items-start gap-6 mb-6">
        <div className="flex h-10 items-center gap-6">
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

        {tab === 'mangas' && (
          <div className="flex flex-1 flex-col sm:flex-row sm:items-center gap-3 sm:justify-end">
            {sources.length > 1 && (
              <select
                className={cn(selectClass, 'sm:w-56 shrink-0')}
                value={sourceId}
                onChange={(e) => changeSource(e.target.value)}
                aria-label="Fuente"
              >
                {sources.map((s) => (
                  <option key={s.manifest.id} value={s.manifest.id}>
                    {s.manifest.name}
                  </option>
                ))}
              </select>
            )}
            <div className="relative flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9 bg-muted/50 border-none"
                placeholder="Título, autor…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch(1)}
              />
            </div>
            <Button onClick={() => runSearch(1)}>Buscar</Button>
            <Button
              variant="outline"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <Filter className="w-4 h-4 mr-2" /> Filtros
            </Button>
          </div>
        )}
      </div>

      {tab === 'mangas' ? (
        <>
          {showFilters && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar mb-6" role="tablist" aria-label="Géneros">
              <Button
                size="sm"
                variant={genre === '' ? 'default' : 'outline'}
                className="shrink-0 rounded-xl"
                onClick={() => { setGenre(''); runSearch(1, q, ''); }}
              >
                Todos
              </Button>
              {GENRES.map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant={genre === g ? 'default' : 'outline'}
                  className="shrink-0 rounded-xl"
                  onClick={() => { setGenre(g); runSearch(1, q, g); }}
                >
                  {g}
                </Button>
              ))}
            </div>
          )}

          {err && (
            <Card className="mb-8 border-destructive/40 hover:shadow-sm">
              <div className="p-5">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  No se pudo buscar
                </div>
                <p className="text-sm text-muted-foreground mt-1">{err}</p>
                {!api.isBridgeOk() && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Abre con <b className="text-foreground">npm run dev:electron</b> (no solo npm run dev).
                  </p>
                )}
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => runSearch(page)}>
                  Reintentar
                </Button>
              </div>
            </Card>
          )}

          {loading && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-8">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i}>
                  <Skeleton className="w-full aspect-[5/7] rounded-xl" />
                  <Skeleton className="h-4 w-3/4 mt-2 rounded" />
                </div>
              ))}
            </div>
          )}

          {!loading && !err && !data && (
            <div className="flex-1 grid place-items-center text-center text-muted-foreground">
              <div>
                <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Busca un manga para empezar.</p>
              </div>
            </div>
          )}

          {!loading && !err && data && (
            data.items.length === 0 ? (
              <div className="flex-1 grid place-items-center">
                <EmptyState icon={BookOpen} title="Sin resultados" description="Prueba con otro título o género." />
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-8">
                {data.items.map((m, i) => (
                  <MangaCard key={i} m={m} sourceId={sourceId} />
                ))}
              </div>
            )
          )}

          {!loading && !err && data && data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-10">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => runSearch(page - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {page} / {data.totalPages}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= data.totalPages} onClick={() => runSearch(page + 1)}>
                Siguiente <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      ) : (
        <ExtensionsPanel />
      )}
    </div>
  );
}
