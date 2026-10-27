import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Filter, Loader2, Search, X } from 'lucide-react';
import VirtualMangaGrid from './VirtualMangaGrid.jsx';
import { SourceBadge } from './SourceBadge.jsx';
import { api } from '../lib/api.js';
import { extensions } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { SOURCE_CATALOG_HOME_EVENT, rememberCover, sourceCatalogState } from '../lib/searchState.js';
import { Button } from './ui/button.jsx';
import { Dropdown } from './ui/dropdown.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { Input } from './ui/input.jsx';
import { useScale, px } from '../lib/useScale.js';

export default function SourcesCatalog({ sources, initialSourceId = '' }) {
  const scale = useScale();
  const [restore] = useState(() => sourceCatalogState.takeRestore());
  const [sourceId, setSourceId] = useState(() => restore?.sourceId || initialSourceId);
  const [filters, setFilters] = useState(() => restore?.filters || []);
  const [filterValues, setFilterValues] = useState(() => restore?.filterValues || {});
  const [filterSearches, setFilterSearches] = useState({});
  const [loadedParams, setLoadedParams] = useState(() => restore?.loadedParams || { q: restore?.query || '', ...(restore?.filterValues || {}) });
  const [filtersOpen, setFiltersOpen] = useState(() => !!restore?.filtersOpen);
  const [query, setQuery] = useState(() => restore?.query || '');
  const [items, setItems] = useState(() => restore?.items || []);
  const [page, setPage] = useState(() => restore?.page || 1);
  const [hasMore, setHasMore] = useState(() => !!restore?.hasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(() => !!restore?.sourceId);
  const requestId = useRef(0);
  const initialRestore = useRef(restore);
  const pendingScrollTop = useRef(restore?.scrollTop ?? null);
  const selected = useMemo(() => sources.find((source) => source.manifest.id === sourceId), [sources, sourceId]);
  const allSources = extensions.sources();

  useEffect(() => {
    if (sourceId && !sources.some((source) => source.manifest.id === sourceId)) setSourceId('');
  }, [sources, sourceId]);

  useEffect(() => {
    const showAllSources = () => {
      sourceCatalogState.clear();
      setSourceId('');
    };
    window.addEventListener(SOURCE_CATALOG_HOME_EVENT, showAllSources);
    return () => window.removeEventListener(SOURCE_CATALOG_HOME_EVENT, showAllSources);
  }, []);

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
      received.forEach((item) => rememberCover(item.url, item.cover));
      const merged = append ? [...items] : [];
      const urls = new Set(merged.map((item) => item.url));
      for (const item of received) {
        if (item.url && !urls.has(item.url)) {
          urls.add(item.url);
          merged.push(item);
        }
      }
      setItems(merged);
      setLoadedParams({ ...params, q: params.q?.trim?.() || '' });
      setPage(nextPage);
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
    if (initialRestore.current?.sourceId === sourceId) {
      const snapshot = initialRestore.current;
      initialRestore.current = null;
      let active = true;
      const runId = ++requestId.current;
      setLoading(true);
      setError('');
      (async () => {
        try {
          const [nextFilters, restored] = await Promise.all([
            api.catalogFilters(sourceId).catch(() => []),
            (async () => {
              const items = [];
              const urls = new Set();
              let result = { hasMore: false, totalPages: 1 };
              const params = snapshot.loadedParams || { q: snapshot.query || '', ...(snapshot.filterValues || {}) };
              for (let nextPage = 1; nextPage <= Math.max(1, snapshot.page || 1); nextPage += 1) {
                result = await api.catalog({ ...params, page: nextPage }, sourceId);
                (result.items || []).forEach((item) => rememberCover(item.url, item.cover));
                for (const item of result.items || []) {
                  if (item.url && !urls.has(item.url)) {
                    urls.add(item.url);
                    items.push(item);
                  }
                }
              }
              return { items, result };
            })()
          ]);
          if (!active || runId !== requestId.current) return;
          setFilters(Array.isArray(nextFilters) ? nextFilters : []);
          setItems(restored.items);
          setLoadedParams(snapshot.loadedParams || { q: snapshot.query || '', ...(snapshot.filterValues || {}) });
          setPage(Math.max(1, snapshot.page || 1));
          setHasMore(restored.result.hasMore ?? ((snapshot.page || 1) < (restored.result.totalPages || 1)));
          setRestoring(false);
        } catch (loadError) {
          if (active && runId === requestId.current) {
            pendingScrollTop.current = null;
            setError(String(loadError?.message || 'No se pudo restaurar el catálogo de esta fuente.'));
          }
        } finally {
          if (active && runId === requestId.current) {
            setLoading(false);
            setRestoring(false);
          }
        }
      })();
      return () => { active = false; };
    }
    let active = true;
    requestId.current += 1;
    setQuery('');
    setFilterValues({});
    setFiltersOpen(false);
    setItems([]);
    setLoadedParams({ q: '' });
    setPage(1);
    setHasMore(false);
    setError('');
    setLoading(true);
    setFilters([]);
    Promise.all([
      api.catalogFilters(sourceId).catch(() => []),
      api.catalog({ q: '', page: 1 }, sourceId)
    ]).then(([nextFilters, result]) => {
      if (!active) return;
      (result.items || []).forEach((item) => rememberCover(item.url, item.cover));
      setFilters(Array.isArray(nextFilters) ? nextFilters : []);
      setItems(result.items || []);
      setLoadedParams({ q: '' });
      setPage(1);
      setHasMore(result.hasMore ?? (result.totalPages > 1));
    }).catch((loadError) => {
      if (active) setError(String(loadError?.message || 'No se pudo cargar el catálogo de esta fuente.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [sourceId]);

  useEffect(() => {
    if (restoring) return;
    if (!sourceId) return;
    sourceCatalogState.save({ sourceId, filters, filterValues, filtersOpen, query, loadedParams, page, hasMore });
  }, [sourceId, filters, filterValues, filtersOpen, query, loadedParams, page, hasMore, restoring]);

  useLayoutEffect(() => {
    if (restoring || loading || pendingScrollTop.current == null || !sourceId) return;
    const main = document.querySelector('main');
    if (!main) return;
    main.scrollTop = pendingScrollTop.current;
    pendingScrollTop.current = null;
  }, [sourceId, restoring, loading, items]);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!sourceId || !main) return undefined;
    const save = () => sourceCatalogState.saveScroll(main.scrollTop);
    save();
    main.addEventListener('scroll', save, { passive: true });
    return () => main.removeEventListener('scroll', save);
  }, [sourceId]);

  const search = () => loadCatalog(sourceId, { q: query.trim(), ...filterValues });
  const hasActiveFilters = !!query.trim() || Object.values(filterValues).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
  const reset = () => {
    setQuery('');
    setFilterValues({});
    setFiltersOpen(false);
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

  if (!selected) {
    return (
      <div
        className="grid items-start"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${px(250, scale, 210)}px, 1fr))`, gap: px(12, scale, 9) }}
      >
        {sources.map(({ manifest }) => (
          <button
            key={manifest.id}
            type="button"
            onClick={() => {
              sourceCatalogState.clear();
              setSourceId(manifest.id);
            }}
            className="group rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={`Abrir catálogo de ${manifest.name}`}
          >
            <div className="flex items-center rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-colors group-hover:border-primary/40 group-hover:bg-accent/30" style={{ minHeight: px(78, scale, 64), padding: px(14, scale, 11), gap: px(12, scale, 9) }}>
              <SourceBadge m={manifest} style={{ width: px(40, scale, 32), height: px(40, scale, 32), borderRadius: px(12, scale, 9) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-foreground" style={{ fontSize: px(15, scale, 13) }}>{manifest.name}</span>
                {manifest.version && <span className="mt-0.5 block text-muted-foreground" style={{ fontSize: px(11, scale, 9) }}>v{manifest.version}</span>}
              </span>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div data-source-catalog-active="true" className="flex min-h-full flex-col" style={{ gap: px(16, scale, 12) }}>
      {selected && (
        <>
          <div className="flex min-w-0 items-center" style={{ gap: px(10, scale, 8) }}>
            <Button type="button" variant="ghost" size="icon" onClick={() => { sourceCatalogState.clear(); setSourceId(''); }} title="Volver a Fuentes" aria-label="Volver a Fuentes" style={{ width: px(34, scale, 28), height: px(34, scale, 28) }}>
              <ArrowLeft style={{ width: px(18, scale, 15), height: px(18, scale, 15) }} />
            </Button>
            <SourceBadge m={selected.manifest} style={{ width: px(30, scale, 24), height: px(30, scale, 24) }} />
            <h2 className="min-w-0 truncate font-semibold" style={{ fontSize: px(16, scale, 13) }}>{selected.manifest.name}</h2>
          </div>

          <div className="rounded-xl border border-border bg-card" style={{ padding: px(12, scale, 9) }}>
            <form className="flex min-w-0 items-center" onSubmit={(event) => { event.preventDefault(); search(); }} style={{ gap: px(8, scale, 6) }}>
              <div className="relative min-w-0 flex-1">
                <Search
                  className="absolute top-1/2 -translate-y-1/2 text-muted-foreground"
                  style={{ left: px(12, scale, 9), width: px(16, scale, 13), height: px(16, scale, 13) }}
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Buscar en ${selected.manifest.name}…`}
                  aria-label={`Buscar mangas en ${selected.manifest.name}`}
                  className="bg-muted/50 border-none"
                  style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(36, scale, 30), paddingRight: px(12, scale, 9) }}
                />
              </div>
              <Button type="submit" disabled={loading} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>
                <Search className="mr-2" style={{ width: px(15, scale, 12), height: px(15, scale, 12) }} />
                Buscar
              </Button>
              {filters.length > 0 && (
                <Button type="button" variant={filtersOpen ? 'secondary' : 'outline'} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="source-filters" style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>
                  <Filter className="mr-2" style={{ width: px(15, scale, 12), height: px(15, scale, 12) }} />
                  Filtros
                </Button>
              )}
            </form>

            {filtersOpen && filters.length > 0 && (
              <div id="source-filters" className="flex flex-wrap items-end border-t border-border/70" style={{ gap: px(12, scale, 9), marginTop: px(12, scale, 9), paddingTop: px(12, scale, 9) }}>
                {filters.map((filter) => (
                  <div key={filter.id} className="flex min-w-[150px] flex-[1_1_160px] flex-col text-muted-foreground" style={{ gap: px(5, scale, 4), fontSize: px(12, scale, 10) }}>
                    <span>{filter.label}</span>
                    {filter.type === 'text' ? (
                      <Input
                        value={filterValues[filter.id] ?? filter.defaultValue ?? ''}
                        onChange={(event) => setFilterValues((current) => ({ ...current, [filter.id]: event.target.value }))}
                        placeholder={filter.placeholder || filter.label}
                        style={{ height: px(36, scale, 30), fontSize: px(13, scale, 11) }}
                      />
                    ) : filter.type === 'multiselect' ? (
                      <div className="min-w-[190px] rounded-lg border border-border bg-background p-2">
                        <Input
                          value={filterSearches[filter.id] || ''}
                          onChange={(event) => setFilterSearches((current) => ({ ...current, [filter.id]: event.target.value }))}
                          placeholder="Buscar género…"
                          aria-label={`Buscar en ${filter.label}`}
                          className="mb-2"
                          style={{ height: px(30, scale, 26), fontSize: px(12, scale, 10) }}
                        />
                        <div className="overflow-y-auto" style={{ maxHeight: px(150, scale, 120) }}>
                          {(filter.options || []).filter((option) => option.label.toLocaleLowerCase().includes((filterSearches[filter.id] || '').toLocaleLowerCase())).map((option) => {
                            const selected = filterValues[filter.id] || [];
                            return (
                              <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1 text-foreground">
                                <input
                                  type="checkbox"
                                  checked={selected.includes(option.value)}
                                  onChange={(event) => setFilterValues((current) => {
                                    const values = current[filter.id] || [];
                                    return { ...current, [filter.id]: event.target.checked ? [...values, option.value] : values.filter((value) => value !== option.value) };
                                  })}
                                />
                                <span className="truncate">{option.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <Dropdown
                        scale={scale}
                        value={filterValues[filter.id] ?? filter.defaultValue ?? ''}
                        onChange={(value) => setFilterValues((current) => ({ ...current, [filter.id]: value }))}
                        ariaLabel={filter.label}
                        style={{ width: px(180, scale, 142) }}
                        options={(filter.options || []).map((option) => typeof option === 'string'
                          ? { value: option, label: option }
                          : option
                        )}
                      />
                    )}
                  </div>
                ))}
                <Button type="button" onClick={search} disabled={loading} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>Aplicar filtros</Button>
                <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={!hasActiveFilters || loading} title="Limpiar búsqueda y filtros" style={{ height: px(36, scale, 30) }}>
                <X className="mr-1" style={{ width: px(14, scale, 12), height: px(14, scale, 12) }} />
                Limpiar
                </Button>
              </div>
            )}
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
              <VirtualMangaGrid items={items} sourceId={sourceId} coverSize={cs} scale={scale} />
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
