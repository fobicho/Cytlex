import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import MangaCard from './MangaCard.jsx';
import { SourceBadge } from './SourceBadge.jsx';
import { api } from '../lib/api.js';
import { extensions } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { Button } from './ui/button.jsx';
import { Dropdown } from './ui/dropdown.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { Input } from './ui/input.jsx';
import { useScale, px } from '../lib/useScale.js';

export default function SourcesCatalog({ sources }) {
  const scale = useScale();
  const [sourceId, setSourceId] = useState(() => sources[0]?.manifest.id || '');
  const [filters, setFilters] = useState([]);
  const [filterValues, setFilterValues] = useState({});
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalText, setTotalText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const selected = useMemo(() => sources.find((source) => source.manifest.id === sourceId), [sources, sourceId]);
  const allSources = extensions.sources();

  useEffect(() => {
    if (sources.some((source) => source.manifest.id === sourceId)) return;
    setSourceId(sources[0]?.manifest.id || '');
  }, [sources, sourceId]);

  const loadCatalog = async (id, params, append = false) => {
    if (!id) return;
    const runId = ++requestId.current;
    setError('');
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setItems([]);
    }
    try {
      const nextPage = append ? page + 1 : 1;
      const result = await api.catalog({ ...params, page: nextPage }, id);
      if (runId !== requestId.current) return;
      const received = result.items || [];
      const merged = append
        ? [...items, ...received.filter((item) => !items.some((old) => old.url === item.url))]
        : received;
      setItems(merged);
      setPage(nextPage);
      setTotalText(result.totalText || '');
      setHasMore(result.hasMore ?? nextPage < (result.totalPages || 1));
    } catch (loadError) {
      if (runId === requestId.current) setError(String(loadError?.message || 'No se pudo cargar el catálogo de esta fuente.'));
    } finally {
      if (runId === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    if (!sourceId) return undefined;
    let active = true;
    requestId.current += 1;
    setQuery('');
    setFilterValues({});
    setItems([]);
    setPage(1);
    setHasMore(false);
    setTotalText('');
    setError('');
    setLoading(true);
    setFilters([]);
    Promise.all([
      api.catalogFilters(sourceId).catch(() => []),
      api.catalog({ q: '', page: 1 }, sourceId)
    ]).then(([nextFilters, result]) => {
      if (!active) return;
      setFilters(Array.isArray(nextFilters) ? nextFilters : []);
      setItems(result.items || []);
      setPage(1);
      setTotalText(result.totalText || '');
      setHasMore(result.hasMore ?? (result.totalPages > 1));
    }).catch((loadError) => {
      if (active) setError(String(loadError?.message || 'No se pudo cargar el catálogo de esta fuente.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [sourceId]);

  const search = () => loadCatalog(sourceId, { q: query.trim(), ...filterValues });
  const reset = () => {
    setQuery('');
    setFilterValues({});
    loadCatalog(sourceId, { q: '' });
  };

  if (!sources.length) {
    const hidden = allSources.length > 0 && !settings.get().showAdultExtensions;
    return (
      <EmptyState
        face={hidden ? '（・_・;）' : '(；ω；)'}
        title={hidden ? 'No hay fuentes visibles' : 'No hay fuentes instaladas'}
        description={hidden ? 'Activa «Mostrar extensiones +18» en Ajustes > Extensiones para verlas.' : undefined}
      />
    );
  }

  const coverSize = Math.round(160 * (settings.get().uiScale || 1));
  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);

  return (
    <div className="flex min-h-full flex-col" style={{ gap: px(20, scale, 14) }}>
      <div className="flex flex-wrap items-center" role="tablist" aria-label="Fuentes" style={{ gap: px(8, scale, 6) }}>
        {sources.map(({ manifest }) => {
          const active = manifest.id === sourceId;
          return (
            <button
              key={manifest.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSourceId(manifest.id)}
              className={`flex items-center rounded-lg border transition-colors ${active ? 'border-primary/40 bg-accent text-foreground' : 'border-border bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
              style={{ gap: px(8, scale, 6), padding: `${px(6, scale, 4)} ${px(10, scale, 8)}`, fontSize: px(13, scale, 11) }}
            >
              <SourceBadge m={manifest} style={{ width: px(24, scale, 20), height: px(24, scale, 20) }} />
              <span>{manifest.name}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <>
          <div className="flex flex-wrap items-center" style={{ gap: px(10, scale, 8) }}>
            <div className="relative min-w-[200px] flex-1">
              <Search
                className="absolute top-1/2 -translate-y-1/2 text-muted-foreground"
                style={{ left: px(12, scale, 9), width: px(16, scale, 13), height: px(16, scale, 13) }}
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') search(); }}
                placeholder={`Buscar en ${selected.manifest.name}…`}
                aria-label={`Buscar mangas en ${selected.manifest.name}`}
                className="bg-muted/50 border-none"
                style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(36, scale, 30), paddingRight: px(12, scale, 9) }}
              />
            </div>
            <Button onClick={search} disabled={loading} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>
              <Search className="mr-2" style={{ width: px(15, scale, 12), height: px(15, scale, 12) }} />
              Buscar
            </Button>
          </div>

          {!!filters.length && (
            <div className="flex flex-wrap items-end" style={{ gap: px(12, scale, 9) }}>
              {filters.map((filter) => (
                <label key={filter.id} className="flex flex-col text-muted-foreground" style={{ gap: px(5, scale, 4), fontSize: px(12, scale, 10), minWidth: px(150, scale, 120) }}>
                  {filter.label}
                  {filter.type === 'text' ? (
                    <Input
                      value={filterValues[filter.id] || ''}
                      onChange={(event) => setFilterValues((current) => ({ ...current, [filter.id]: event.target.value }))}
                      onKeyDown={(event) => { if (event.key === 'Enter') search(); }}
                      placeholder={filter.placeholder || filter.label}
                      style={{ height: px(34, scale, 28), fontSize: px(13, scale, 11) }}
                    />
                  ) : (
                    <Dropdown
                      scale={scale}
                      value={filterValues[filter.id] || ''}
                      onChange={(value) => setFilterValues((current) => ({ ...current, [filter.id]: value }))}
                      ariaLabel={filter.label}
                      style={{ width: px(180, scale, 142) }}
                      options={(filter.options || []).map((option) => typeof option === 'string'
                        ? { value: option, label: option }
                        : option
                      )}
                    />
                  )}
                </label>
              ))}
              <Button variant="ghost" size="sm" onClick={reset} title="Limpiar búsqueda y filtros" style={{ height: px(34, scale, 28) }}>
                <X className="mr-1" style={{ width: px(14, scale, 12), height: px(14, scale, 12) }} />
                Limpiar
              </Button>
            </div>
          )}

          <div className="flex items-center" style={{ gap: px(10, scale, 8), marginTop: filters.length ? 0 : px(2, scale, 1) }}>
            <SourceBadge m={selected.manifest} style={{ width: px(28, scale, 22), height: px(28, scale, 22) }} />
            <h2 className="font-semibold" style={{ fontSize: px(15, scale, 13) }}>{selected.manifest.name}</h2>
            <span className="text-muted-foreground" style={{ fontSize: px(12, scale, 10) }}>
              · {totalText || items.length}
            </span>
          </div>

          {error ? (
            <EmptyState face="(；_；)" tone="error" title="No se pudo cargar esta fuente" description={error} />
          ) : loading ? (
            <div className="flex items-center justify-center text-muted-foreground" style={{ gap: px(10, scale, 8), padding: `${px(44, scale, 32)} 0` }}>
              <Loader2 className="animate-spin" style={{ width: px(20, scale, 16), height: px(20, scale, 16) }} />
              <span style={{ fontSize: px(14, scale, 12) }}>Cargando mangas…</span>
            </div>
          ) : items.length ? (
            <>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, ${cs}px)`,
                  gap: `${Math.max(16, Math.round(20 * scale))}px ${Math.max(12, Math.round(20 * scale))}px`
                }}
              >
                {items.map((manga) => (
                  <MangaCard key={manga.url} m={manga} sourceId={sourceId} from="explorar" coverSize={cs} showAuthor={false} />
                ))}
              </div>
              {hasMore && (
                <div className="flex flex-col items-center" style={{ gap: px(8, scale, 6), marginTop: px(12, scale, 8) }}>
                  <Button variant="secondary" onClick={() => loadCatalog(sourceId, { q: query.trim(), ...filterValues }, true)} disabled={loadingMore}>
                    {loadingMore && <Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />}
                    {loadingMore ? 'Cargando…' : 'Cargar más mangas'}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState face="¯\\_(ツ)_/¯" title="No se encontraron mangas" />
          )}
        </>
      )}
    </div>
  );
}
