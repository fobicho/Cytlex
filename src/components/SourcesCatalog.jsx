import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpDown, Filter, Loader2, Search, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import MangaCard from './MangaCard.jsx';
import VirtualMangaGrid from './VirtualMangaGrid.jsx';
import { SourceBadge } from './SourceBadge.jsx';
import { api } from '../lib/api.js';
import { extensions } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { SOURCE_CATALOG_HOME_EVENT, rememberCover, sourceCatalogState } from '../lib/searchState.js';
import { Button } from './ui/button.jsx';
import { Card } from './ui/card.jsx';
import { Dropdown } from './ui/dropdown.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { Input } from './ui/input.jsx';
import { useScale, px } from '../lib/useScale.js';

const CATALOG_BATCH_SIZE = 20;

async function fetchCatalogBatch({ id, params, page, queuedItems = [], existingItems = [], apiHasMore = true, requestId }) {
  const batch = [];
  const queued = [...queuedItems];
  const knownUrls = new Set([...existingItems, ...queued].map((item) => item.url).filter(Boolean));
  let currentPage = page;
  let canFetchNextPage = apiHasMore;
  let pagesFetched = 0;

  const addUnique = (items) => {
    for (const item of items || []) {
      if (!item?.url || knownUrls.has(item.url)) continue;
      knownUrls.add(item.url);
      queued.push(item);
    }
  };

  while (batch.length < CATALOG_BATCH_SIZE && queued.length) batch.push(queued.shift());

  while (batch.length < CATALOG_BATCH_SIZE && canFetchNextPage && pagesFetched < CATALOG_BATCH_SIZE) {
    currentPage += 1;
    pagesFetched += 1;
    const result = await api.catalog({ ...params, page: currentPage, __cytlexRequestId: requestId }, id);
    const received = result.items || [];
    received.forEach((item) => rememberCover(item.url, item.cover, id));
    addUnique(received);
    canFetchNextPage = result.hasMore ?? currentPage < (result.totalPages || 1);
    while (batch.length < CATALOG_BATCH_SIZE && queued.length) batch.push(queued.shift());
  }

  return { items: batch, queuedItems: queued, page: currentPage, apiHasMore: canFetchNextPage, hasMore: queued.length > 0 || canFetchNextPage };
}

export default function SourcesCatalog({ sources, initialSourceId = '', active = true }) {
  const scale = useScale();
  const reduceMotion = useReducedMotion();
  const [restore] = useState(() => sourceCatalogState.takeRestore());
  const [sourceId, setSourceId] = useState(() => restore?.sourceId || initialSourceId);
  const [filters, setFilters] = useState(() => restore?.filters || []);
  const [filterValues, setFilterValues] = useState(() => restore?.filterValues || {});
  const [filterSearches, setFilterSearches] = useState({});
  const [loadedParams, setLoadedParams] = useState(() => restore?.loadedParams || { q: restore?.query || '', ...(restore?.filterValues || {}) });
  const [filtersOpen, setFiltersOpen] = useState(() => !!restore?.filtersOpen);
  const [query, setQuery] = useState(() => restore?.query || '');
  const [items, setItems] = useState(() => restore?.items || []);
  const [queuedItems, setQueuedItems] = useState(() => restore?.queuedItems || []);
  const [page, setPage] = useState(() => restore?.page || 1);
  const [apiHasMore, setApiHasMore] = useState(() => restore?.apiHasMore ?? !!restore?.hasMore);
  const [hasMore, setHasMore] = useState(() => !!restore?.hasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(() => !!restore?.sourceId);
  const requestId = useRef(0);
  const requestSequence = useRef(0);
  const activeHttpRequest = useRef('');
  const catalogRef = useRef(null);
  const [catalogWidth, setCatalogWidth] = useState(0);
  const initialRestore = useRef(restore);
  const pendingScrollTop = useRef(restore?.scrollTop ?? null);
  const selected = useMemo(() => sources.find((source) => source.manifest.id === sourceId), [sources, sourceId]);
  const allSources = extensions.sources();

  useLayoutEffect(() => {
    const element = catalogRef.current;
    if (!element) return undefined;
    const updateWidth = () => setCatalogWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected]);

  const cancelActiveRequest = () => {
    const request = activeHttpRequest.current;
    if (!request) return;
    window.cytlex?.cancelHttpRequest?.(request);
    activeHttpRequest.current = '';
  };

  const beginHttpRequest = () => {
    cancelActiveRequest();
    const request = `sources-catalog-${Date.now()}-${++requestSequence.current}`;
    activeHttpRequest.current = request;
    return request;
  };

  const finishHttpRequest = (request) => {
    window.cytlex?.releaseHttpRequest?.(request);
    if (activeHttpRequest.current === request) activeHttpRequest.current = '';
  };

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
    const httpRequestId = beginHttpRequest();
    setError('');
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setItems([]);
      setQueuedItems([]);
    }
    try {
      const result = await fetchCatalogBatch({
        id,
        params,
        page: append ? page : 0,
        queuedItems: append ? queuedItems : [],
        existingItems: append ? items : [],
        apiHasMore: append ? apiHasMore : true,
        requestId: httpRequestId
      });
      if (runId !== requestId.current) return;
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setQueuedItems(result.queuedItems);
      setLoadedParams({ ...params, q: params.q?.trim?.() || '' });
      setPage(result.page);
      setApiHasMore(result.apiHasMore);
      setHasMore(result.hasMore);
    } catch (loadError) {
      if (runId === requestId.current) setError(String(loadError?.message || 'No se pudo cargar el catálogo de esta fuente.'));
    } finally {
      if (runId === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
      finishHttpRequest(httpRequestId);
    }
  };

  useEffect(() => () => cancelActiveRequest(), [sourceId]);

  useEffect(() => {
    if (!sourceId) return undefined;
    if (initialRestore.current?.sourceId === sourceId) {
      const snapshot = initialRestore.current;
      initialRestore.current = null;
      if (Array.isArray(snapshot.items)) {
        setFilters(snapshot.filters || []);
        setFilterValues(snapshot.filterValues || {});
        setFiltersOpen(!!snapshot.filtersOpen);
        setQuery(snapshot.query || '');
        setItems(snapshot.items);
        setQueuedItems(snapshot.queuedItems || []);
        setLoadedParams(snapshot.loadedParams || { q: snapshot.query || '', ...(snapshot.filterValues || {}) });
        setPage(snapshot.page || 1);
        setApiHasMore(snapshot.apiHasMore ?? !!snapshot.hasMore);
        setHasMore(!!snapshot.hasMore);
        setRestoring(false);
        setLoading(false);
        setError('');
        return undefined;
      }
      let active = true;
      const runId = ++requestId.current;
      setLoading(true);
      setError('');
      const httpRequestId = beginHttpRequest();
      (async () => {
        try {
          const nextFilters = await api.catalogFilters(sourceId).catch(() => []);
          const restoredItems = [];
          const urls = new Set();
          let result = { hasMore: false, totalPages: 1 };
          const params = snapshot.loadedParams || { q: snapshot.query || '', ...(snapshot.filterValues || {}) };
          for (let nextPage = 1; nextPage <= Math.max(1, snapshot.page || 1); nextPage += 1) {
            result = await api.catalog({ ...params, page: nextPage, __cytlexRequestId: httpRequestId }, sourceId);
            (result.items || []).forEach((item) => rememberCover(item.url, item.cover, sourceId));
            for (const item of result.items || []) {
              if (item.url && !urls.has(item.url)) {
                urls.add(item.url);
                restoredItems.push(item);
              }
            }
          }
          if (!active || runId !== requestId.current) return;
          setFilters(Array.isArray(nextFilters) ? nextFilters : []);
          setItems(restoredItems.slice(0, CATALOG_BATCH_SIZE));
          setQueuedItems([...(snapshot.queuedItems || []), ...restoredItems.slice(CATALOG_BATCH_SIZE)]);
          setLoadedParams(snapshot.loadedParams || { q: snapshot.query || '', ...(snapshot.filterValues || {}) });
          setPage(Math.max(1, snapshot.page || 1));
          setApiHasMore(snapshot.apiHasMore ?? (result.hasMore ?? ((snapshot.page || 1) < (result.totalPages || 1))));
          setHasMore((snapshot.queuedItems || []).length > 0 || restoredItems.length > CATALOG_BATCH_SIZE || (snapshot.hasMore ?? (result.hasMore ?? ((snapshot.page || 1) < (result.totalPages || 1)))));
          setRestoring(false);
          setLoading(false);
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
          finishHttpRequest(httpRequestId);
        }
      })();
      return () => { active = false; if (activeHttpRequest.current === httpRequestId) cancelActiveRequest(); };
    }
    let active = true;
    requestId.current += 1;
    setQuery('');
    setFilterValues({});
    setFiltersOpen(false);
    setItems([]);
    setQueuedItems([]);
    setLoadedParams({ q: '' });
    setPage(1);
    setApiHasMore(false);
    setHasMore(false);
    setError('');
    setLoading(true);
    setFilters([]);
    const httpRequestId = beginHttpRequest();
    (async () => {
      try {
        const loadFilters = () => api.catalogFilters(sourceId).catch(() => []).then((nextFilters) => {
          const safeFilters = Array.isArray(nextFilters) ? nextFilters : [];
          if (active) setFilters(safeFilters);
          return safeFilters;
        });
        const resultPromise = fetchCatalogBatch({ id: sourceId, params: { q: '', ...(sourceId === 'leercapitulo' ? { sort: 'az' } : {}) }, page: 0, requestId: httpRequestId });
        loadFilters();
        const result = await resultPromise;
        if (!active) return;
        setItems(result.items);
        setQueuedItems(result.queuedItems);
        setLoadedParams({ q: '', ...(sourceId === 'leercapitulo' ? { sort: 'az' } : {}) });
        setPage(result.page);
        setApiHasMore(result.apiHasMore);
        setHasMore(result.hasMore);
      } catch (loadError) {
        if (active) setError(String(loadError?.message || 'No se pudo cargar el catálogo de esta fuente.'));
      } finally {
        if (active) setLoading(false);
        finishHttpRequest(httpRequestId);
      }
    })();
    return () => { active = false; if (activeHttpRequest.current === httpRequestId) cancelActiveRequest(); };
  }, [sourceId]);

  useEffect(() => {
    if (restoring) return;
    if (!sourceId) return;
    sourceCatalogState.save({ sourceId, filters, filterValues, filtersOpen, query, loadedParams, page, hasMore, apiHasMore, items, queuedItems });
  }, [sourceId, filters, filterValues, filtersOpen, query, loadedParams, page, hasMore, apiHasMore, items, queuedItems, restoring]);

  useLayoutEffect(() => {
    if (!active || restoring || loading || pendingScrollTop.current == null || !sourceId) return;
    const main = document.querySelector('main');
    if (!main) return;
    main.scrollTop = pendingScrollTop.current;
    pendingScrollTop.current = null;
  }, [active, sourceId, restoring, loading, items]);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!active || !sourceId || !main) return undefined;
    const save = () => sourceCatalogState.saveScroll(main.scrollTop);
    save();
    main.addEventListener('scroll', save, { passive: true });
    return () => {
      main.removeEventListener('scroll', save);
    };
  }, [active, sourceId]);

  const search = () => {
    setFiltersOpen(false);
    loadCatalog(sourceId, {
      q: query.trim(),
      ...filterValues,
      ...(sourceId === 'leercapitulo' ? { sort: loadedParams.sort || 'az' } : {})
    });
  };
  const hasActiveFilters = !!query.trim() || Object.values(filterValues).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
  const reset = () => {
    setQuery('');
    setFilterValues({});
    setFiltersOpen(false);
    loadCatalog(sourceId, { q: '', ...(sourceId === 'leercapitulo' ? { sort: loadedParams.sort || 'az' } : {}) });
  };
  const leercapituloSort = loadedParams.sort === 'za' ? 'za' : 'az';
  const genreFilter = sourceId === 'leercapitulo' ? filters.find((filter) => filter.id === 'genre') : null;
  const filterGroups = useMemo(() => {
    const groupFor = (filter) => {
      if (filter.group) return filter.group;
      if (sourceId !== 'zonatmo') return 'other';
      if (['searchBy', 'type', 'demography', 'status', 'author'].includes(filter.id)) return 'primary';
      if (['gender', 'excludeGender'].includes(filter.id)) return 'genres';
      if (['orderItem', 'orderDirection'].includes(filter.id)) return 'sorting';
      return 'other';
    };
    return Object.fromEntries(['primary', 'genres', 'sorting', 'other'].map((group) => [
      group,
      filters.filter((filter) => groupFor(filter) === group)
    ]));
  }, [filters, sourceId]);

  const renderFilter = (filter) => (
    <div key={filter.id} className="flex min-w-0 flex-col text-muted-foreground" style={{ gap: px(5, scale, 4), fontSize: px(12, scale, 10) }}>
      <span className="truncate">{filter.label}</span>
      {filter.type === 'text' ? (
        <Input
          value={filterValues[filter.id] ?? filter.defaultValue ?? ''}
          onChange={(event) => setFilterValues((current) => ({ ...current, [filter.id]: event.target.value }))}
          placeholder={filter.placeholder || filter.label}
          style={{ height: px(36, scale, 30), fontSize: px(13, scale, 11) }}
        />
      ) : filter.type === 'multiselect' ? (
        <div className="min-w-0 rounded-lg border border-border bg-background p-2">
          <Input
            value={filterSearches[filter.id] || ''}
            onChange={(event) => setFilterSearches((current) => ({ ...current, [filter.id]: event.target.value }))}
            placeholder="Buscar género…"
            aria-label={`Buscar en ${filter.label}`}
            className="mb-2"
            style={{ height: px(30, scale, 26), fontSize: px(12, scale, 10) }}
          />
          <div className="overflow-y-auto" style={{ maxHeight: px(150, scale, 120) }}>
            {(filter.options || [])
              .filter((option) => option.label.toLocaleLowerCase().includes((filterSearches[filter.id] || '').toLocaleLowerCase()))
              .map((option) => {
              const selectedValues = Array.isArray(filterValues[filter.id]) ? filterValues[filter.id] : [];
              return (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1 text-foreground">
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(option.value)}
                    onChange={(event) => setFilterValues((current) => {
                      const values = Array.isArray(current[filter.id]) ? current[filter.id] : [];
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
          placeholder={filter.placeholder || `Selecciona ${filter.label.toLocaleLowerCase()}`}
          menuMaxHeight={sourceId === 'leercapitulo' && filter.id === 'genre' ? 288 : 256}
          style={{ width: '100%' }}
          options={(filter.options || []).map((option) => typeof option === 'string' ? { value: option, label: option } : option)}
        />
      )}
    </div>
  );

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

  const coverSize = 160;
  const cs = Math.min(Math.max(Number(coverSize) || 160, 60), 260);
  const catalogGapX = Math.max(12, Math.round(20 * scale));
  const catalogColumns = catalogWidth > 0 ? Math.max(1, Math.floor((catalogWidth + catalogGapX) / (cs + catalogGapX))) : 1;
  const minSearchWidth = Math.max(Number.parseInt(px(420, scale, 336), 10), Math.round(520 * scale));
  const searchWidth = catalogWidth > 0
    ? Math.min(catalogWidth, Math.max(minSearchWidth, catalogColumns * cs + (catalogColumns - 1) * catalogGapX))
    : '100%';

  if (!selected) {
    return (
      <div
        className="grid items-start"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${px(240, scale, 200)}, 1fr))`, gap: px(12, scale, 9) }}
      >
        {sources.map(({ manifest }) => (
          <Card key={manifest.id} className="group hover:shadow-sm">
            <button
              type="button"
              onClick={() => {
                sourceCatalogState.clear();
                setSourceId(manifest.id);
              }}
              className="flex w-full items-center rounded-xl text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              style={{ minHeight: px(68, scale, 56), padding: px(14, scale, 11), gap: px(12, scale, 9) }}
              aria-label={`Abrir catálogo de ${manifest.name}`}
            >
              <SourceBadge m={manifest} style={{ width: px(40, scale, 32), height: px(40, scale, 32), borderRadius: px(12, scale, 9) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-foreground" style={{ fontSize: px(15, scale, 13) }}>{manifest.name}</span>
                {manifest.version && <span className="mt-0.5 block text-muted-foreground" style={{ fontSize: px(11, scale, 9) }}>v{manifest.version}</span>}
              </span>
            </button>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div ref={catalogRef} data-source-catalog-active="true" data-source-catalog-selected={sourceId ? 'true' : 'false'} className="flex min-h-full flex-col" style={{ gap: px(16, scale, 12) }}>
      {selected && (
        <>
          <div className="flex min-w-0 items-center" style={{ gap: px(10, scale, 8) }}>
            <Button type="button" variant="ghost" size="icon" onClick={() => { sourceCatalogState.clear(); setSourceId(''); }} title="Volver a Fuentes" aria-label="Volver a Fuentes" style={{ width: px(34, scale, 28), height: px(34, scale, 28) }}>
              <ArrowLeft style={{ width: px(18, scale, 15), height: px(18, scale, 15) }} />
            </Button>
            <SourceBadge m={selected.manifest} style={{ width: px(30, scale, 24), height: px(30, scale, 24) }} />
            <div className="relative flex min-w-0 items-center" style={{ gap: px(10, scale, 8) }}>
              <h2 className="min-w-0 truncate font-semibold" style={{ maxWidth: px(520, scale, 260), fontSize: px(16, scale, 13) }}>{selected.manifest.name}</h2>
              {sourceId === 'leercapitulo' && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      const sort = leercapituloSort === 'az' ? 'za' : 'az';
                      loadCatalog(sourceId, { ...loadedParams, q: query.trim(), ...filterValues, sort });
                    }}
                    disabled={loading}
                    title={`Orden actual: ${leercapituloSort.toUpperCase()}. Cambiar a ${leercapituloSort === 'az' ? 'Z-A' : 'A-Z'}`}
                    style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9), marginLeft: px(4, scale, 3) }}
                  >
                    <ArrowUpDown className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    {leercapituloSort === 'az' ? 'A-Z' : 'Z-A'}
                  </Button>
                  {genreFilter?.options?.length > 0 && (
                    <Dropdown
                      scale={scale}
                      value={filterValues.genre || ''}
                      options={[{ value: '', label: 'Todos' }, ...genreFilter.options]}
                      ariaLabel="Filtrar por género"
                      placeholder="Género"
                      menuMaxHeight={288}
                      menuWidth={190}
                      portal
                      buttonClassName="rounded-md border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      buttonStyle={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
                      style={{ width: px(190, scale, 160) }}
                      onChange={(genre) => {
                        setFilterValues((current) => ({ ...current, genre }));
                        loadCatalog(sourceId, { ...loadedParams, q: query.trim(), ...filterValues, genre, sort: leercapituloSort });
                      }}
                    />
                  )}
                </>
              )}
              {sourceId !== 'leercapitulo' && filters.length > 0 && (
                <Button type="button" variant="outline" className="shrink-0" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="source-filters" style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>
                  <Filter className="mr-2" style={{ width: px(15, scale, 12), height: px(15, scale, 12) }} />
                  Filtros
                </Button>
              )}
              <AnimatePresence initial={false}>
                {sourceId !== 'leercapitulo' && filtersOpen && filters.length > 0 && (
                  <motion.div
                    id="source-filters"
                    key="source-filters"
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute left-0 top-full z-50 rounded-xl border border-border bg-card p-3 shadow-xl"
                    style={{ width: px(360, scale, 300), maxWidth: 'calc(100vw - 32px)', marginTop: px(8, scale, 6), transformOrigin: 'top left' }}
                  >
                    <div className="grid grid-cols-1 items-start" style={{ gap: px(14, scale, 10) }}>
                      {filterGroups.primary.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5" style={{ gap: px(12, scale, 9) }}>
                          {filterGroups.primary.map(renderFilter)}
                        </div>
                      )}
                      {filterGroups.genres.length > 0 && (
                        <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2" style={{ gap: px(12, scale, 9) }}>
                          {filterGroups.genres.map(renderFilter)}
                        </div>
                      )}
                      {filterGroups.sorting.length > 0 && (
                        <div className="flex flex-wrap items-end justify-end" style={{ gap: px(10, scale, 7) }}>
                          {filterGroups.sorting.map((filter) => <div key={filter.id} className="w-full sm:w-auto" style={{ width: '100%', maxWidth: px(180, scale, 150) }}>{renderFilter(filter)}</div>)}
                          <div className="flex flex-wrap items-center justify-end" style={{ gap: px(8, scale, 6) }}>
                            <Button type="button" onClick={search} disabled={loading} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>Aplicar filtros</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={!hasActiveFilters || loading} title="Limpiar búsqueda y filtros" style={{ height: px(36, scale, 30) }}>
                              <X className="mr-1" style={{ width: px(14, scale, 12), height: px(14, scale, 12) }} />
                              Limpiar
                            </Button>
                          </div>
                        </div>
                      )}
                      {filterGroups.other.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10.625rem,1fr))]" style={{ gap: px(12, scale, 9) }}>
                          {filterGroups.other.map(renderFilter)}
                        </div>
                      )}
                      {filterGroups.sorting.length === 0 && (
                        <div className="flex flex-wrap items-center justify-end" style={{ gap: px(8, scale, 6) }}>
                          <Button type="button" onClick={search} disabled={loading} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>Aplicar filtros</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={!hasActiveFilters || loading} title="Limpiar búsqueda y filtros" style={{ height: px(36, scale, 30) }}>
                            <X className="mr-1" style={{ width: px(14, scale, 12), height: px(14, scale, 12) }} />
                            Limpiar
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card" style={{ width: searchWidth, maxWidth: '100%', padding: px(12, scale, 9) }}>
            <form className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center" onSubmit={(event) => { event.preventDefault(); if (query.trim()) search(); }} style={{ gap: px(8, scale, 6) }}>
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
              <Button type="submit" disabled={loading || !query.trim()} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>
                <Search className="mr-2" style={{ width: px(15, scale, 12), height: px(15, scale, 12) }} />
                Buscar
              </Button>
            </form>

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
              <VirtualMangaGrid
                items={items}
                sourceId={sourceId}
                coverSize={cs}
                scale={scale}
                active={active && !!sourceId}
                responsiveCards
                renderCard={(manga, cardWidth) => (
                  <MangaCard m={manga} sourceId={sourceId} from="fuentes" coverSize={cardWidth} showAuthor={false} useLibraryCoverCache />
                )}
              />
              {hasMore && (
                <div className="flex flex-col items-center" style={{ gap: px(8, scale, 6), marginTop: px(12, scale, 8) }}>
                  <Button variant="secondary" onClick={() => loadCatalog(sourceId, { ...loadedParams, q: query.trim(), ...filterValues }, true)} disabled={loadingMore} style={{ height: px(40, scale, 33), fontSize: px(14, scale, 12), paddingLeft: px(16, scale, 12), paddingRight: px(16, scale, 12), gap: px(8, scale, 6) }}>
                    {loadingMore && <Loader2 className="animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />}
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
