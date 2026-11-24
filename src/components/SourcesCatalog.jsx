import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpDown, Filter, Loader2, Search, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import MangaCard from './MangaCard.jsx';
import VirtualMangaGrid from './VirtualMangaGrid.jsx';
import { SourceBadge } from './SourceBadge.jsx';
import { api } from '../lib/api.js';
import { clearCatalogRequest, setCatalogRequestCoverUrls, sourceErrorMessage } from '../lib/browserHttp.js';
import { getLibraryCover, preloadLibraryCover, preloadLibraryCoversBatch, requiresImageProxy } from '../lib/covers.js';
import { isLibraryManga } from '../lib/library.js';
import { extensions, isSourceConfigured } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { SOURCE_CATALOG_HOME_EVENT, rememberMangaPreview, sourceCatalogState } from '../lib/searchState.js';
import { Button } from './ui/button.jsx';
import { Card } from './ui/card.jsx';
import { Dropdown } from './ui/dropdown.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { Input } from './ui/input.jsx';
import { useScale, px, fontPx, toolbarButtonStyle } from '../lib/useScale.js';
import { useResponsiveCoverSize } from '../lib/useResponsiveCoverSize.js';

const CATALOG_BATCH_SIZE = 40;
const OLYMPUS_CATALOG_PAGE_SIZE = 15;
const isMangaDex = (id) => id === 'mangadex' || id === 'mangadex-en';
const FIXED_PAGE_SOURCES = new Set(['leercapitulo', 'mangaoni', 'olympusscanlation', 'onfmangas', 'zonatmo']);

const GENRE_TRANSLATIONS = new Map([
  ['+15', 'Clasificación +15'], ['+18', 'Clasificación +18'], ['+19', 'Clasificación +19'],
  ['adaptation', 'Adaptación'], ['adaptación', 'Adaptación'],
  ['action', 'Acción'], ['acción', 'Acción'],
  ['adult cast', 'Reparto adulto'],
  ['adult', 'Adulto'], ['adulto', 'Adulto'],
  ['adventure', 'Aventura'], ['aventura', 'Aventura'],
  ['age gap', 'Diferencia de edad'], ['diferencia de edad', 'Diferencia de edad'],
  ['aliens', 'Alienígenas'], ['alienígenas', 'Alienígenas'],
  ['animation', 'Animación'], ['animación', 'Animación'],
  ['animals', 'Animales'], ['animales', 'Animales'],
  ['anthology', 'Antología'], ['antología', 'Antología'],
  ['anti-heroe', 'Antihéroe'], ['anti-hero', 'Antihéroe'], ['antihéroe', 'Antihéroe'],
  ['apocalyptic', 'Apocalíptico'], ['apocalíptico', 'Apocalíptico'],
  ['award winning', 'Premiados'], ['premiados', 'Premiados'],
  ['bl', 'Boys Love'], ['bl (boys love)', 'Boys Love'],
  ['boys love', 'Boys Love'], ['boyslove', 'Boys Love'],
  ['martial arts', 'Artes Marciales'], ['artes marciales', 'Artes Marciales'],
  ['comedy', 'Comedia'], ['comedia', 'Comedia'],
  ['cooking', 'Cocina'], ['cocina', 'Cocina'],
  ['crime', 'Crimen'], ['crimen', 'Crimen'],
  ['crossdressing', 'Travestismo'], ['travestismo', 'Travestismo'],
  ['delinquents', 'Delincuentes'], ['delincuentes', 'Delincuentes'],
  ['demons', 'Demonios'], ['demonios', 'Demonios'],
  ['childcare', 'Cuidado infantil'], ['cuidado infantil', 'Cuidado infantil'],
  ['army', 'Ejército'], ['ejercito', 'Ejército'], ['ejército', 'Ejército'],
  ['erotica', 'Erótica'], ['erótica', 'Erótica'],
  ['era', 'Época'], ['epoca', 'Época'], ['época', 'Época'],
  ['ghosts', 'Fantasmas'], ['fantasmas', 'Fantasmas'],
  ['fantasy', 'Fantasía'], ['fantasía', 'Fantasía'],
  ['fiction', 'Ficción'], ['ficcion', 'Ficción'], ['ficción', 'Ficción'],
  ['gag humor', 'Humor absurdo'], ['girls love', 'Girls Love'],
  ['gender bender', 'Cambio de género'], ['cambio de género', 'Cambio de género'],
  ['género bender', 'Cambio de género'],
  ['historical', 'Histórico'], ['histórico', 'Histórico'],
  ['history', 'Historia'], ['historia', 'Historia'],
  ['incest', 'Incesto'], ['incesto', 'Incesto'],
  ['long strip', 'Tira larga'], ['tira larga', 'Tira larga'],
  ['magical girls', 'Chicas mágicas'], ['chicas mágicas', 'Chicas mágicas'],
  ['military', 'Militar'], ['militar', 'Militar'],
  ['monsters', 'Monstruos'], ['monstruos', 'Monstruos'],
  ['music', 'Música'], ['música', 'Música'],
  ['mythology', 'Mitología'], ['mitología', 'Mitología'],
  ['horror', 'Terror'], ['terror', 'Terror'],
  ['magic', 'Magia'], ['magia', 'Magia'],
  ['mystery', 'Misterio'], ['misterio', 'Misterio'],
  ['office', 'Oficina'], ['oficina', 'Oficina'],
  ['office workers', 'Trabajadores de oficina'], ['trabajadores de oficina', 'Trabajadores de oficina'],
  ['police', 'Policial'], ['policial', 'Policial'],
  ['post-apocalyptic', 'Postapocalíptico'], ['postapocalíptico', 'Postapocalíptico'],
  ['psychological', 'Psicológico'], ['psicológico', 'Psicológico'],
  ['reincarnation', 'Reencarnación'], ['reencarnación', 'Reencarnación'],
  ['science fiction', 'Ciencia ficción'], ['sci-fi', 'Ciencia ficción'], ['ciencia ficción', 'Ciencia ficción'],
  ['school', 'Escolar'], ['escolar', 'Escolar'],
  ['school life', 'Vida escolar'], ['vida escolar', 'Vida escolar'],
  ['sexual violence', 'Violencia sexual'], ['violencia sexual', 'Violencia sexual'],
  ['showbiz', 'Espectáculo'], ['espectáculo', 'Espectáculo'],
  ['slice of life', 'Vida cotidiana'], ['vida cotidiana', 'Vida cotidiana'],
  ['shonen', 'Shōnen'], ['shounen', 'Shōnen'], ['shōnen', 'Shōnen'],
  ['shoujo', 'Shōjo'], ['shōjo', 'Shōjo'],
  ['shonen-ai', 'Shōnen-ai'], ['shounen ai', 'Shōnen-ai'], ['shonen-ai (yaoi soft)', 'Shōnen-ai'],
  ['sports', 'Deportes'], ['deporte', 'Deportes'], ['deportes', 'Deportes'], ['team sports', 'Deportes de equipo'],
  ['superhero', 'Superhéroes'], ['superhéroes', 'Superhéroes'],
  ['super natural', 'Sobrenatural'], ['supernatural', 'Sobrenatural'], ['sobre natural', 'Sobrenatural'], ['sobrenatural', 'Sobrenatural'],
  ['survival', 'Supervivencia'], ['supervivencia', 'Supervivencia'],
  ['time travel', 'Viaje en el tiempo'], ['viaje en el tiempo', 'Viaje en el tiempo'],
  ['tragedy', 'Tragedia'], ['tragedia', 'Tragedia'],
  ['traps', 'Trampas'], ['trampas', 'Trampas'],
  ['vampire', 'Vampiros'], ['vampires', 'Vampiros'], ['vampiros', 'Vampiros'],
  ['video game', 'Videojuegos'], ['video games', 'Videojuegos'], ['videojuego', 'Videojuegos'], ['videojuegos', 'Videojuegos'],
  ['villainess', 'Villana'], ['villana', 'Villana'],
  ['virtual reality', 'Realidad virtual'], ['realidad virtual', 'Realidad virtual'],
  ['workplace', 'Trabajo'], ['trabajo', 'Trabajo'],
  ['yaoi (soft)', 'Yaoi suave'], ['zombies', 'Zombis'], ['zombis', 'Zombis']
].map(([label, translated]) => [normalizeGenreLabel(label), translated]));

function normalizeGenreLabel(label) {
  return String(label || '').trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function uniqueSortedGenres(options) {
  const unique = new Map();
  for (const option of options || []) {
    const label = String(option?.label || '').trim();
    const canonicalLabel = GENRE_TRANSLATIONS.get(normalizeGenreLabel(label)) || label;
    const key = normalizeGenreLabel(canonicalLabel);
    if (!option?.value || !key) continue;
    if (!unique.has(key)) unique.set(key, { ...option, label: canonicalLabel });
  }
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
}

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

  if (['leercapitulo', 'mangaoni', 'zonatmo'].includes(id) && batch.length === CATALOG_BATCH_SIZE && queuedItems.length >= CATALOG_BATCH_SIZE) {
    await api.catalog({
      ...params,
      page: Math.max(1, currentPage),
      __cytlexRequestId: requestId,
      __cytlexForceFetch: true
    }, id);
  }

  while (batch.length < CATALOG_BATCH_SIZE && canFetchNextPage
    && pagesFetched < (id === 'komiwa' ? 1 : CATALOG_BATCH_SIZE)) {
    const startPage = currentPage + 1;
    const remainingItems = CATALOG_BATCH_SIZE - batch.length;
    const batchPages = id === 'leercapitulo' ? 4
      : id === 'onfmangas' ? Math.min(4, Math.ceil(remainingItems / 12))
      : id === 'mangaoni' ? (batch.length ? 4 : 3)
        : id === 'olympusscanlation' ? Math.ceil(remainingItems / OLYMPUS_CATALOG_PAGE_SIZE) : 2;
    const group = !window.cytlex?.httpGet && FIXED_PAGE_SOURCES.has(id)
      && (id === 'onfmangas' || id === 'mangaoni'
        || (id === 'olympusscanlation' ? remainingItems > OLYMPUS_CATALOG_PAGE_SIZE
          : remainingItems >= 20))
      && pagesFetched + batchPages <= CATALOG_BATCH_SIZE;
    const requests = Array.from({ length: group ? batchPages : 1 }, (_, index) =>
      api.catalog({
        ...params,
        page: startPage + index,
        __cytlexRequestId: requestId,
        ...(id === 'leercapitulo' ? { __cytlexForceFetch: true } : {})
      }, id));
    const results = await Promise.allSettled(requests);
    for (const result of results) {
      if (!canFetchNextPage) break;
      if (result.status === 'rejected') throw result.reason;
      currentPage += 1;
      pagesFetched += 1;
      const received = result.value.items || [];
      received.forEach((item) => rememberMangaPreview(item, id));
      addUnique(received);
      canFetchNextPage = result.value.hasMore ?? currentPage < (result.value.totalPages || 1);
      while (batch.length < CATALOG_BATCH_SIZE && queued.length) batch.push(queued.shift());
    }
  }

  return { items: batch, queuedItems: queued, page: currentPage, apiHasMore: canFetchNextPage, hasMore: queued.length > 0 || canFetchNextPage };
}

export default function SourcesCatalog({ sources, initialSourceId = '', active = true, savedMangaKeys = new Set(), hideSavedManga = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const scale = useScale();
  const reduceMotion = useReducedMotion();
  const [coverSize, setCoverSize] = useState(() => settings.get().coverSize);
  const [restore] = useState(() => sourceCatalogState.takeRestore());
  const [sourceId, setSourceId] = useState(() => initialSourceId || restore?.sourceId || '');
  const routeSourceId = useRef(initialSourceId);
  const [catalogReadySourceId, setCatalogReadySourceId] = useState(() =>
    restore?.sourceId && Array.isArray(restore.items) && (!initialSourceId || restore.sourceId === initialSourceId)
      ? restore.sourceId
      : ''
  );
  const [filters, setFilters] = useState(() => restore?.filters || []);
  const [filterValues, setFilterValues] = useState(() => restore?.filterValues || {});
  const [loadedParams, setLoadedParams] = useState(() => restore?.loadedParams || { q: restore?.query || '', ...(restore?.filterValues || {}) });
  const [filtersOpen, setFiltersOpen] = useState(() => !!restore?.filtersOpen);
  const [filterPanelPosition, setFilterPanelPosition] = useState(null);
  const filterRootRef = useRef(null);
  const filterPanelRef = useRef(null);
  const filterBodyRef = useRef(null);
  const [query, setQuery] = useState(() => restore?.query || '');
  const [items, setItems] = useState(() => restore?.items || []);
  const [queuedItems, setQueuedItems] = useState(() => restore?.queuedItems || []);
  const [page, setPage] = useState(() => restore?.page || 1);
  const [apiHasMore, setApiHasMore] = useState(() => restore?.apiHasMore ?? !!restore?.hasMore);
  const [hasMore, setHasMore] = useState(() => !!restore?.hasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [restoring, setRestoring] = useState(() => !!restore?.sourceId);
  const requestId = useRef(0);
  const filterRequestScope = useRef(0);
  const requestSequence = useRef(0);
  const activeHttpRequest = useRef('');
  const [sourceSort, setSourceSort] = useState(() => {
    try {
      const stored = localStorage.getItem('cytlex:sourcesSort');
      return ['title-asc', 'title-desc', 'added'].includes(stored) ? stored : 'title-asc';
    } catch { return 'title-asc'; }
  });
  const cs = useResponsiveCoverSize(coverSize);
  const [toolbarTarget, setToolbarTarget] = useState(null);
  const initialRestore = useRef(restore);
  const pendingScrollTop = useRef(restore?.scrollTop ?? null);
  const selected = useMemo(() => sources.find((source) => source.manifest.id === sourceId), [sources, sourceId]);
  const isZonaTmo = sourceId === 'zonatmo';
  const useCompactFilterFields = isZonaTmo || sourceId === 'mangalect';
  const filterPanelWidth = px(isZonaTmo ? 480 : 360, scale, 300);
  const getFilterRoot = () => filterRootRef.current;
  const preloadCatalogCovers = (mangas) =>
    preloadLibraryCoversBatch(mangas.map((manga) => manga.cover).filter(Boolean), { web: true, bundledOnly: true });

  const selectSource = (id) => {
    sourceCatalogState.clear();
    setSourceId(id);
    const params = new URLSearchParams(location.search);
    params.set('tab', 'fuentes');
    params.set('source', id);
    navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true });
  };

  const showSourceList = () => {
    sourceCatalogState.clear();
    setSourceId('');
    const params = new URLSearchParams(location.search);
    params.delete('source');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };

  useEffect(() => {
    if (routeSourceId.current === initialSourceId) return;
    routeSourceId.current = initialSourceId;
    sourceCatalogState.clear();
    setSourceId(initialSourceId);
  }, [initialSourceId]);

  useLayoutEffect(() => {
    if (!filtersOpen) {
      setFilterPanelPosition(null);
      return undefined;
    }
    const positionPanel = () => {
      const trigger = getFilterRoot()?.querySelector('button');
      const panel = filterPanelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const triggerTop = rect.top;
      const triggerBottom = rect.bottom;
      const width = Math.min(parseFloat(filterPanelWidth), viewportWidth - 32);
      const left = Math.max(16, Math.min(rect.left, viewportWidth - width - 16));
      const body = filterBodyRef.current;
      const overflow = body ? body.scrollHeight - body.clientHeight : 0;
      const desiredHeight = Math.min(panel.offsetHeight + overflow, viewportHeight - 32);
      const below = Math.max(0, viewportHeight - triggerBottom - 24);
      const above = Math.max(0, triggerTop - 24);
      const openAbove = below < desiredHeight && above > below;
      const maxHeight = Math.max(96, openAbove ? above : below);
      const top = Math.max(16, Math.min(
        openAbove ? triggerTop - Math.min(desiredHeight, maxHeight) - 8 : triggerBottom + 8,
        viewportHeight - Math.min(desiredHeight, maxHeight) - 16
      ));
      const next = { left: Math.round(left), top: Math.round(top), width: Math.round(width), maxHeight: Math.round(maxHeight) };
      setFilterPanelPosition((current) => current && Object.keys(next).every((key) => current[key] === next[key]) ? current : next);
    };
    positionPanel();
    const resize = new ResizeObserver(positionPanel);
    if (filterBodyRef.current) resize.observe(filterBodyRef.current);
    const closeOnPageScroll = ({ target }) => {
      if (target === document || target === window ||
        (target instanceof Element && filterRootRef.current && target.contains(filterRootRef.current))) {
        setFiltersOpen(false);
      }
    };
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', closeOnPageScroll, true);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', closeOnPageScroll, true);
    };
  }, [filtersOpen, filterPanelWidth, sourceId]);

  useEffect(() => {
    if (!filtersOpen) return undefined;
    filterPanelRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event) => {
      if (event.target instanceof Element && event.target.closest('.source-filter-menu')) return;
      if (!filterRootRef.current?.contains(event.target) && !filterPanelRef.current?.contains(event.target)) setFiltersOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !filterPanelRef.current?.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')) {
        setFiltersOpen(false);
        getFilterRoot()?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [filtersOpen]);
  const allSources = extensions.sources();
  const configuredSources = allSources.filter(({ manifest }) => isSourceConfigured(manifest));
  const sortedSources = useMemo(() => [...sources].sort((a, b) => {
    if (sourceSort === 'added') return (a.installedAt || 0) - (b.installedAt || 0);
    const order = String(a.manifest.name || '').localeCompare(String(b.manifest.name || ''), 'es', { sensitivity: 'base', numeric: true });
    return sourceSort === 'title-desc' ? -order : order;
  }), [sources, sourceSort]);

  useEffect(() => settings.subscribe((s) => setCoverSize(s.coverSize)), []);

  useLayoutEffect(() => {
    setToolbarTarget(document.getElementById('sources-toolbar'));
  }, []);

  const cancelActiveRequest = () => {
    const request = activeHttpRequest.current;
    if (!request) return;
    window.cytlex?.cancelHttpRequest?.(request);
    activeHttpRequest.current = '';
  };

  const beginHttpRequest = (coverUrls = []) => {
    cancelActiveRequest();
    const request = `sources-catalog-${Date.now()}-${++requestSequence.current}`;
    activeHttpRequest.current = request;
    if (coverUrls.length) setCatalogRequestCoverUrls(request, coverUrls);
    return request;
  };

  const finishHttpRequest = (request) => {
    clearCatalogRequest(request);
    window.cytlex?.releaseHttpRequest?.(request);
    if (activeHttpRequest.current === request) activeHttpRequest.current = '';
  };

  const loadCatalogFilters = (id) => {
    const scope = filterRequestScope.current;
    void api.catalogFilters(id).then((nextFilters) => {
      if (scope === filterRequestScope.current) setFilters(Array.isArray(nextFilters) ? nextFilters : []);
    }).catch(() => {});
  };

  useEffect(() => {
    if (sourceId && !sources.some((source) => source.manifest.id === sourceId)) setSourceId('');
  }, [sources, sourceId]);

  useEffect(() => {
    const showAllSources = () => {
      showSourceList();
    };
    window.addEventListener(SOURCE_CATALOG_HOME_EVENT, showAllSources);
    return () => window.removeEventListener(SOURCE_CATALOG_HOME_EVENT, showAllSources);
  }, [location.pathname, location.search]);

  const loadCatalog = async (id, params, append = false) => {
    if (!id) return;
    const runId = ++requestId.current;
    const backfillItems = id === 'mangaoni' && append
      ? items.filter((item) => item.cover && !getLibraryCover(item.cover)).slice(-6)
      : [];
    const httpRequestId = beginHttpRequest(['leercapitulo', 'mangaoni', 'onfmangas', 'zonatmo'].includes(id) && append
      ? [...queuedItems, ...backfillItems].map((item) => item.cover).filter(Boolean)
      : []);
    setError(null);
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
      if (isMangaDex(id) && window.cytlex?.fetchImage) {
        for (const manga of result.items) {
          if (requiresImageProxy(manga.cover)) void preloadLibraryCover(manga.cover, { web: true, priority: true });
        }
      }
      await preloadCatalogCovers([...backfillItems, ...result.items]);
      if (runId !== requestId.current) return;
      const backfilledCovers = new Set(backfillItems.map((item) => item.cover));
      setItems((current) => append
        ? [...current.map((item) => backfilledCovers.has(item.cover) ? { ...item } : item), ...result.items]
        : result.items);
      setQueuedItems(result.queuedItems);
      setLoadedParams({ ...params, q: params.q?.trim?.() || '' });
      setPage(result.page);
      setApiHasMore(result.apiHasMore);
      setHasMore(result.hasMore);
    } catch (loadError) {
      if (runId === requestId.current) setError({ cause: loadError, params, append });
    } finally {
      if (runId === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
      finishHttpRequest(httpRequestId);
    }
  };

  useEffect(() => () => {
    requestId.current += 1;
    filterRequestScope.current += 1;
    cancelActiveRequest();
  }, [sourceId]);

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
        setError(null);
        setCatalogReadySourceId(sourceId);
        return undefined;
      }
      let active = true;
      const runId = ++requestId.current;
      setLoading(true);
      setError(null);
      const httpRequestId = beginHttpRequest();
      const params = snapshot.loadedParams || { q: snapshot.query || '', ...(snapshot.filterValues || {}) };
      (async () => {
        try {
          if (!isMangaDex(sourceId)) loadCatalogFilters(sourceId);
          const restoredItems = [];
          const urls = new Set();
          let result = { hasMore: false, totalPages: 1 };
          for (let nextPage = 1; nextPage <= Math.max(1, snapshot.page || 1); nextPage += 1) {
            result = await api.catalog({ ...params, page: nextPage, __cytlexRequestId: httpRequestId }, sourceId);
            (result.items || []).forEach((item) => rememberMangaPreview(item, sourceId));
            for (const item of result.items || []) {
              if (item.url && !urls.has(item.url)) {
                urls.add(item.url);
                restoredItems.push(item);
              }
            }
          }
          if (!active || runId !== requestId.current) return;
          if (isMangaDex(sourceId) && window.cytlex?.fetchImage) restoredItems.forEach((manga) => {
            if (requiresImageProxy(manga.cover)) void preloadLibraryCover(manga.cover, { web: true, priority: true });
          });
          await preloadCatalogCovers(restoredItems.slice(0, CATALOG_BATCH_SIZE));
          if (!active || runId !== requestId.current) return;
          setItems(restoredItems.slice(0, CATALOG_BATCH_SIZE));
          setQueuedItems([...(snapshot.queuedItems || []), ...restoredItems.slice(CATALOG_BATCH_SIZE)]);
          setLoadedParams(snapshot.loadedParams || { q: snapshot.query || '', ...(snapshot.filterValues || {}) });
          setPage(Math.max(1, snapshot.page || 1));
          setApiHasMore(snapshot.apiHasMore ?? (result.hasMore ?? ((snapshot.page || 1) < (result.totalPages || 1))));
          setHasMore((snapshot.queuedItems || []).length > 0 || restoredItems.length > CATALOG_BATCH_SIZE || (snapshot.hasMore ?? (result.hasMore ?? ((snapshot.page || 1) < (result.totalPages || 1)))));
          setRestoring(false);
          setLoading(false);
          setCatalogReadySourceId(sourceId);
        } catch (loadError) {
          if (active && runId === requestId.current) {
            pendingScrollTop.current = null;
            setError({ cause: loadError, params });
          }
        } finally {
          if (active && runId === requestId.current) {
            setLoading(false);
            setRestoring(false);
            setCatalogReadySourceId(sourceId);
          }
          finishHttpRequest(httpRequestId);
        }
      })();
      return () => { active = false; if (activeHttpRequest.current === httpRequestId) cancelActiveRequest(); };
    }
    let active = true;
    const runId = ++requestId.current;
    setQuery('');
    setFilterValues({});
    setFiltersOpen(false);
    setItems([]);
    setQueuedItems([]);
    setLoadedParams({ q: '' });
    setPage(1);
    setApiHasMore(false);
    setHasMore(false);
    setError(null);
    setLoading(true);
    setFilters([]);
    const httpRequestId = beginHttpRequest();
    const params = { q: '', ...(sourceId === 'leercapitulo' ? { sort: 'az' } : {}) };
    (async () => {
      try {
        const resultPromise = fetchCatalogBatch({ id: sourceId, params, page: 0, requestId: httpRequestId });
        if (!isMangaDex(sourceId)) loadCatalogFilters(sourceId);
        const result = await resultPromise;
        if (!active || runId !== requestId.current) return;
        if (isMangaDex(sourceId) && window.cytlex?.fetchImage) result.items.forEach((manga) => {
          if (requiresImageProxy(manga.cover)) void preloadLibraryCover(manga.cover, { web: true, priority: true });
        });
        await preloadCatalogCovers(result.items);
        if (!active || runId !== requestId.current) return;
        setItems(result.items);
        setQueuedItems(result.queuedItems);
        setLoadedParams(params);
        setPage(result.page);
        setApiHasMore(result.apiHasMore);
        setHasMore(result.hasMore);
      } catch (loadError) {
        if (active && runId === requestId.current) setError({ cause: loadError, params });
      } finally {
        if (active) {
          setLoading(false);
          setCatalogReadySourceId(sourceId);
        }
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
    const main = document.querySelector('.catalog-page-scroll') || document.querySelector('main');
    if (!main) return;
    main.scrollTop = pendingScrollTop.current;
    pendingScrollTop.current = null;
  }, [active, sourceId, restoring, loading, items]);

  useEffect(() => {
    const main = document.querySelector('.catalog-page-scroll') || document.querySelector('main');
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
  const canRestoreCatalog = hasActiveFilters || !!String(loadedParams.q || '').trim();
  const reset = () => {
    setQuery('');
    setFilterValues({});
    setFiltersOpen(false);
    loadCatalog(sourceId, { q: '', ...(sourceId === 'leercapitulo' ? { sort: loadedParams.sort || 'az' } : {}) });
  };
  const leercapituloSort = loadedParams.sort === 'za' ? 'za' : 'az';
  const displayFilters = useMemo(() => filters.map((filter) => {
    const isSourceGenreFilter = sourceId === 'leercapitulo' && filter.id === 'genre'
      || sourceId === 'zonatmo' && ['gender', 'excludeGender'].includes(filter.id);
    return isSourceGenreFilter ? { ...filter, options: uniqueSortedGenres(filter.options) } : filter;
  }), [filters, sourceId]);
  const activeFilterCount = displayFilters.reduce((count, filter) => {
    if (['orderItem', 'orderDirection'].includes(filter.id)) return count;
    const value = filterValues[filter.id];
    if (Array.isArray(value)) return count + value.length;
    return count + (value != null && value !== '' && value !== filter.defaultValue ? 1 : 0);
  }, 0);
  const genreFilter = sourceId === 'leercapitulo' ? displayFilters.find((filter) => filter.id === 'genre') : null;
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
      displayFilters.filter((filter) => groupFor(filter) === group)
    ]));
  }, [displayFilters, sourceId]);

  const renderFilter = (filter) => {
    const multiple = filter.type === 'multiselect';
    const value = filterValues[filter.id] ?? filter.defaultValue;
    const selectedValues = Array.isArray(value) ? value : value ? String(value).split(',').map((item) => item.trim()).filter(Boolean) : [];
    const options = (filter.options || []).map((option) => {
      const item = typeof option === 'string' ? { value: option, label: option } : option;
      const direction = isZonaTmo && filter.id === 'orderDirection'
        ? { asc: 'Ascendente', desc: 'Descendente' }[item.value]
        : null;
      return direction ? { ...item, label: direction } : item;
    });
    return (
      <div key={filter.id} className={`flex min-w-0 flex-col text-muted-foreground ${isZonaTmo && filter.id === 'author' ? 'col-span-2' : ''}`} style={{ gap: px(5, scale, 4), fontSize: fontPx(12, scale, 10) }}>
        <span className="font-medium leading-tight">{filter.label}</span>
        {filter.type === 'text' ? (
          <Input
            aria-label={filter.label}
            value={filterValues[filter.id] ?? filter.defaultValue ?? ''}
            onChange={(event) => setFilterValues((current) => ({ ...current, [filter.id]: event.target.value }))}
            placeholder={filter.placeholder || filter.label}
            style={{ height: px(36, scale, 30), fontSize: fontPx(13, scale, 11) }}
          />
        ) : (
          <Dropdown
            scale={scale}
            multiple={multiple}
            value={multiple ? selectedValues : value ?? ''}
            onChange={(value) => setFilterValues((current) => ({ ...current, [filter.id]: value }))}
            ariaLabel={filter.label}
            placeholder={filter.placeholder || (multiple ? 'Elegir' : `Selecciona ${filter.label.toLocaleLowerCase()}`)}
            portal
            menuWidth
            menuClassName="source-filter-menu"
            menuMaxHeight={multiple ? 288 : 256}
            buttonClassName={useCompactFilterFields ? 'rounded-md border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80' : undefined}
            buttonStyle={useCompactFilterFields ? { height: px(36, scale, 30) } : undefined}
            options={options}
          />
        )}
      </div>
    );
  };
  const renderFiltersButton = (ref, className = '') => (
    <div ref={ref} className={`shrink-0 ${className}`}>
      <Button
        type="button"
        variant="secondary"
        className="source-filters-trigger shrink-0 rounded-none"
        onClick={() => {
          if (isMangaDex(sourceId) && !filters.length) loadCatalogFilters(sourceId);
          setFiltersOpen((open) => !open);
        }}
        aria-label={activeFilterCount ? `Filtros, ${activeFilterCount} seleccionados` : 'Filtros'}
        aria-expanded={filtersOpen}
        aria-controls="source-filters"
        style={{ width: px(96, scale, 88), height: px(36, scale, 30), fontSize: fontPx(14, scale, 12) }}
      >
        <Filter className="mr-2" style={{ width: px(15, scale, 12), height: px(15, scale, 12) }} />
        Filtros{activeFilterCount > 0 && <span className="ml-1 tabular-nums">{activeFilterCount}</span>}
      </Button>
    </div>
  );

  if (!sources.length) {
    const hidden = configuredSources.length > 0 && !settings.get().showAdultExtensions;
    const noneConfigured = allSources.length > 0 && !configuredSources.length;
    return (
      <EmptyState
        face={hidden ? '（・_・;）' : '(；ω；)'}
        title={hidden ? 'No hay fuentes visibles' : noneConfigured ? 'No hay fuentes disponibles' : 'No hay fuentes instaladas'}
        description={hidden
          ? 'Activa «Mostrar extensiones +18» en Ajustes > Extensiones para verlas.'
          : noneConfigured ? 'Activa al menos un idioma en la configuración de sus extensiones.' : undefined}
      />
    );
  }

  const visibleItems = hideSavedManga
    ? items.filter((manga) => !isLibraryManga(manga, sourceId, savedMangaKeys))
    : items;

  if (!selected) {
    return (
      <>
        {toolbarTarget && createPortal(
          <Button
            variant="secondary"
            size="sm"
            className="source-sort-trigger rounded-none"
            title="Ordenar fuentes"
            aria-label={`Ordenar fuentes: ${sourceSort === 'title-desc' ? 'Z-A' : sourceSort === 'added' ? 'Adición' : 'A-Z'}`}
            onClick={() => {
              const modes = ['title-asc', 'title-desc', 'added'];
              const next = modes[(modes.indexOf(sourceSort) + 1) % modes.length];
              setSourceSort(next);
              try { localStorage.setItem('cytlex:sourcesSort', next); } catch {}
            }}
            style={toolbarButtonStyle(scale)}
          >
            <ArrowUpDown className="mr-2" style={{ width: px(14, scale, 11), height: px(14, scale, 11) }} />
            {sourceSort === 'title-desc' ? 'Z-A' : sourceSort === 'added' ? 'Adición' : 'A-Z'}
          </Button>,
          toolbarTarget
        )}
        <div
          className="grid items-start"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${px(240, scale, 200)}, 1fr))`, gap: px(12, scale, 9) }}
        >
          {sortedSources.map(({ manifest }) => (
            <Card key={manifest.id} className="group rounded-lg border-border/50 shadow-none hover:shadow-none">
              <button
                type="button"
                onClick={() => selectSource(manifest.id)}
                className="flex w-full items-center rounded-lg text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                style={{ minHeight: px(68, scale, 56), padding: px(14, scale, 11), gap: px(12, scale, 9) }}
                aria-label={`Abrir catálogo de ${manifest.name}`}
              >
                <SourceBadge m={manifest} style={{ width: px(40, scale, 32), height: px(40, scale, 32), borderRadius: px(12, scale, 9) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground" style={{ fontSize: fontPx(15, scale, 13) }}>{manifest.name}</span>
                  {manifest.version && <span className="mt-0.5 block text-muted-foreground" style={{ fontSize: fontPx(11, scale, 9) }}>v{manifest.version}</span>}
                </span>
              </button>
            </Card>
          ))}
        </div>
      </>
    );
  }

  return (
    <div data-source-catalog-active="true" data-source-catalog-selected={sourceId ? 'true' : 'false'} className="flex min-h-full flex-col" style={{ gap: px(16, scale, 12) }}>
      {selected && (
        <>
          <div className="flex min-w-0 items-center" style={{ gap: px(10, scale, 8), minHeight: px(36, scale, 30) }}>
            <Button type="button" variant="ghost" size="icon" className="hover:bg-transparent hover:text-foreground" onClick={showSourceList} title="Volver a Fuentes" aria-label="Volver a Fuentes" style={{ width: px(34, scale, 28), height: px(34, scale, 28) }}>
              <ArrowLeft style={{ width: px(18, scale, 15), height: px(18, scale, 15) }} />
            </Button>
            <SourceBadge m={selected.manifest} style={{ width: px(30, scale, 24), height: px(30, scale, 24) }} />
            <h2 className="min-w-0 flex-1 truncate font-semibold" style={{ fontSize: fontPx(16, scale, 13) }}>{selected.manifest.name}</h2>
            {sourceId === 'leercapitulo' && (
              <div className="ml-auto flex shrink-0 items-center" style={{ gap: px(8, scale, 6) }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="source-sort-trigger shrink-0 rounded-none"
                  onClick={() => {
                    const sort = leercapituloSort === 'az' ? 'za' : 'az';
                    loadCatalog(sourceId, { ...loadedParams, q: query.trim(), ...filterValues, sort });
                  }}
                  disabled={loading}
                  title={`Orden actual: ${leercapituloSort.toUpperCase()}. Cambiar a ${leercapituloSort === 'az' ? 'Z-A' : 'A-Z'}`}
                  style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
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
                    buttonClassName="rounded-md border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    buttonStyle={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
                    style={{ width: px(190, scale, 160) }}
                    onChange={(genre) => {
                      setFilterValues((current) => ({ ...current, genre }));
                      loadCatalog(sourceId, { ...loadedParams, q: query.trim(), ...filterValues, genre, sort: leercapituloSort });
                    }}
                  />
                )}
              </div>
            )}
            {sourceId !== 'leercapitulo' && (filters.length > 0 || isMangaDex(sourceId)) && (
              <>
                {renderFiltersButton(filterRootRef, 'ml-auto')}
                {createPortal(
                  <AnimatePresence initial={false}>
                  {filtersOpen && (
                    <motion.div
                      ref={filterPanelRef}
                      id="source-filters"
                      key="source-filters"
                      role="dialog"
                      aria-label="Filtros de búsqueda"
                      tabIndex={-1}
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
                      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg outline-none"
                      style={{
                        width: filterPanelPosition?.width || filterPanelWidth,
                        maxWidth: filterPanelPosition ? undefined : 'calc(100vw - 32px)',
                        maxHeight: filterPanelPosition?.maxHeight || 'calc(100dvh - 32px)',
                        left: filterPanelPosition?.left ?? 16,
                        top: filterPanelPosition?.top ?? 16,
                        transformOrigin: 'top left'
                      }}
                    >
                      <div ref={filterBodyRef} className="grid min-h-0 grid-cols-1 content-start gap-4 overflow-y-auto overscroll-contain p-3 sm:p-4">
                        {filterGroups.primary.length > 0 && (
                          <div className={isZonaTmo ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}>
                            {filterGroups.primary.map(renderFilter)}
                          </div>
                        )}
                        {filterGroups.genres.length > 0 && (
                          <div className={isZonaTmo ? 'grid min-w-0 grid-cols-2 items-start gap-3' : 'grid min-w-0 gap-3'}>
                            {filterGroups.genres.map(renderFilter)}
                          </div>
                        )}
                        {filterGroups.sorting.length > 0 && (
                          <div className="grid grid-cols-2 gap-3">
                            {filterGroups.sorting.map(renderFilter)}
                          </div>
                        )}
                        {filterGroups.other.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10.625rem,1fr))]" style={{ gap: px(12, scale, 9) }}>
                            {filterGroups.other.map(renderFilter)}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-1.5 sm:px-4">
                        <Button type="button" variant="ghost" size="sm" className="h-10 sm:h-8" onClick={reset} disabled={!hasActiveFilters || loading}>
                          Limpiar
                        </Button>
                        <Button type="button" size="sm" className="h-10 sm:h-8" onClick={search} disabled={loading}>
                          Aplicar filtros
                        </Button>
                      </div>
                    </motion.div>
                  )}
                  </AnimatePresence>,
                  document.body
                )}
              </>
            )}
            </div>

          <div className="w-full">
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
                    style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(36, scale, 30), paddingRight: px(canRestoreCatalog ? 40 : 12, scale, canRestoreCatalog ? 32 : 9) }}
                  />
                  {canRestoreCatalog && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Mostrar catálogo principal de ${selected.manifest.name}`}
                      title="Mostrar catálogo principal"
                      onClick={reset}
                      disabled={loading}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      style={{ width: px(28, scale, 24), height: px(28, scale, 24) }}
                    >
                      <X style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    </Button>
                  )}
                </div>
                <Button type="submit" disabled={loading || !query.trim()} style={{ width: px(96, scale, 88), height: px(36, scale, 30), fontSize: fontPx(14, scale, 12) }}>
                  <Search className="mr-2" style={{ width: px(15, scale, 12), height: px(15, scale, 12) }} />
                  Buscar
                </Button>
              </form>
          </div>

          {error && !error.append ? (
            <EmptyState
              face="(；_；)"
              tone="error"
              title="No se pudo cargar esta fuente"
              description={sourceErrorMessage(error.cause, selected.manifest.name, 'No se pudo cargar el catálogo.')}
              action={<Button variant="secondary" onClick={() => loadCatalog(sourceId, error.params)}>Reintentar</Button>}
            />
          ) : loading ? (
            <div className="flex items-center justify-center text-muted-foreground" style={{ gap: px(10, scale, 8), padding: `${px(44, scale, 32)} 0` }}>
              <Loader2 className="animate-spin" style={{ width: px(20, scale, 16), height: px(20, scale, 16) }} />
              <span style={{ fontSize: fontPx(14, scale, 12) }}>Cargando mangas…</span>
            </div>
          ) : visibleItems.length || (hideSavedManga && hasMore) ? (
            <>
              {visibleItems.length ? (
                <VirtualMangaGrid
                  items={visibleItems}
                  sourceId={sourceId}
                  coverSize={cs}
                  scale={scale}
                  active={active && !!sourceId}
                  responsiveCards
                  renderCard={(manga, cardWidth) => (
                    <MangaCard
                      m={manga}
                      sourceId={sourceId}
                      from="fuentes"
                      useLibraryCoverCache={isMangaDex(sourceId) && requiresImageProxy(manga.cover)}
                      bundledCoverOnly={!window.cytlex?.fetchImage}
                      coverSize={cardWidth}
                      showAuthor={false}
                      savedInLibrary={isLibraryManga(manga, sourceId, savedMangaKeys)}
                    />
                  )}
                />
              ) : (
                <EmptyState face="（・_・）" title="No hay mangas nuevos" description="Los mangas guardados están ocultos en Explorar." />
              )}
              {hasMore && (
                <div className="flex flex-col items-center" style={{ gap: px(8, scale, 6), marginTop: px(12, scale, 8) }}>
                  {error?.append && <p role="status" className="max-w-full text-center text-sm text-muted-foreground [overflow-wrap:anywhere]">{sourceErrorMessage(error.cause, selected.manifest.name, 'No se pudo cargar más mangas.')}</p>}
                  <Button variant="secondary" onClick={() => loadCatalog(sourceId, loadedParams, true)} disabled={loadingMore} style={{ height: px(40, scale, 33), fontSize: fontPx(14, scale, 12), paddingLeft: px(16, scale, 12), paddingRight: px(16, scale, 12), gap: px(8, scale, 6) }}>
                    {loadingMore && <Loader2 className="animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />}
                    {loadingMore ? 'Cargando…' : error?.append ? 'Reintentar' : 'Cargar más mangas'}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              face="¯\\_(ツ)_/¯"
              title={hideSavedManga && items.length ? 'No hay mangas nuevos' : 'No se encontraron mangas'}
              description={hideSavedManga && items.length ? 'Los mangas guardados están ocultos en Explorar.' : undefined}
            />
          )}
        </>
      )}
    </div>
  );
}
