import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Star, ChevronDown, ArrowUp, ArrowDown, AlertTriangle, BookOpen, Check, CheckCheck, CheckCircle2, Puzzle, Link2, ArrowRightLeft, Crosshair } from 'lucide-react';
import { api } from '../lib/api.js';
import { lib } from '../lib/library.js';
import { progress } from '../lib/progress.js';
import { reconcileMihonProgress } from '../lib/mihonProgress.js';
import { extensions, isExtensionAllowed } from '../lib/extensions.js';
import { getLibraryCover, getSearchCover, hasLibraryCoverLoaded, makeCoverThumb, markLibraryCoverLoaded, preloadLibraryCover, requiresImageProxy } from '../lib/covers.js';
import { chapterOrder, detailScroll, recallCover, sourceCatalogState } from '../lib/searchState.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { reconcileChapterProgress } from '../lib/mangaMigration.js';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { Dialog } from '../components/ui/dialog.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { Dropdown } from '../components/ui/dropdown.jsx';
import AniListPanel from '../components/AniListPanel.jsx';
import { settings } from '../lib/settings.js';
import { tracking } from '../lib/tracking.js';
import Catalog from './Catalog.jsx';

const EXPAND_CTRL_H = 16;
const COVER_BASE = 184;
const norm = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const chapterNum = (chapter) => {
  const match = String(chapter?.title || '').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : NaN;
};
const byNumber = (a, b, direction = 1) => {
  const na = chapterNum(a);
  const nb = chapterNum(b);
  if (Number.isNaN(na) !== Number.isNaN(nb)) return (Number.isNaN(na) ? 1 : -1) * direction;
  if (!Number.isNaN(na) && na !== nb) return (na - nb) * direction;
  const groupOrder = String(a.group || '').localeCompare(String(b.group || ''), 'es', { sensitivity: 'base', numeric: true });
  if (groupOrder) return groupOrder * direction;
  return String(a.date).localeCompare(String(b.date), 'es', { numeric: true }) * direction;
};

function SourceLine({ sourceId, scale }) {
  const m = extensions.manifest(sourceId);
  const [ok, setOk] = useState(true);
  return (
    <span className="inline-flex items-center leading-none text-muted-foreground" style={{ gap: px(6, scale, 4), fontSize: px(12, scale, 10) }}>
      <span className="rounded bg-secondary text-secondary-foreground grid place-items-center overflow-hidden shrink-0" style={{ width: px(20, scale, 16), height: px(20, scale, 16) }}>
        {m.icon && ok ? (
          <img src={m.icon} alt="" className="w-full h-full object-cover" onError={() => setOk(false)} />
        ) : (
          <span className="font-bold" style={{ fontSize: px(9, scale, 8) }}>{(m.name?.[0] || '?').toUpperCase()}</span>
        )}
      </span>
      <span className="flex items-center self-stretch">{m.name}</span>
    </span>
  );
}

function ExtensionChoice({ manifest, current, checked, onChange, scale }) {
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  return (
    <label className={cn(
      'flex items-center rounded-lg border border-border px-3 py-2.5',
      current ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent/50',
      checked && !current && 'bg-accent/40'
    )} style={{ gap: px(12, scale, 9), minHeight: px(56, scale, 46) }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={current}
        onChange={onChange}
        aria-label={current ? `${manifest.name}, fuente actual` : `Buscar en ${manifest.name}`}
        style={{ accentColor: 'hsl(var(--primary))', width: px(16, scale, 13), height: px(16, scale, 13), flexShrink: 0 }}
      />
      <span className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-secondary text-secondary-foreground font-semibold" style={{ width: px(36, scale, 30), height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>
        {manifest.icon && !logoUnavailable
          ? <img src={manifest.icon} alt="" className="h-full w-full object-cover" onError={() => setLogoUnavailable(true)} />
          : (manifest.name?.[0] || '?').toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" style={{ fontSize: px(14, scale, 12) }}>{manifest.name}</span>
      <span className="shrink-0 text-muted-foreground" style={{ fontSize: px(12, scale, 10) }}>
        {current ? 'Fuente actual' : ''}
      </span>
    </label>
  );
}

function DuplicateRow({ cover, title, author, sourceId, scale, coverScale = 1, selected, selectable, onSelect }) {
  return (
    <div className={`flex items-center border-b border-border ${selected && selectable ? 'bg-accent/50' : ''}`} style={{ gap: px(16, scale, 12), paddingTop: px(16, scale, 12), paddingBottom: px(16, scale, 12) }}>
      {selectable && (
        <input
          type="radio"
          name="duplicate-entry"
          checked={selected}
          onChange={onSelect}
          aria-label={`Reemplazar ${title}`}
          style={{ accentColor: 'hsl(var(--primary))', flexShrink: 0 }}
        />
      )}
      {cover ? (
        <img src={cover} alt="" referrerPolicy="no-referrer" className="aspect-[5/7] object-cover shrink-0 bg-black" style={{ width: px(128 * coverScale, scale, 80), borderRadius: px(12, scale, 9) }} />
      ) : (
        <div className="aspect-[5/7] shrink-0 bg-secondary" style={{ width: px(128 * coverScale, scale, 80), borderRadius: px(12, scale, 9) }} />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-snug line-clamp-2" style={{ fontSize: px(18, scale, 15) }}>{title}</div>
        {author && <div className="text-muted-foreground truncate" style={{ marginTop: px(8, scale, 6), fontSize: px(12, scale, 10) }}>{author}</div>}
        <div style={{ marginTop: px(4, scale, 3) }}>
          <SourceLine sourceId={sourceId} scale={scale} />
        </div>
      </div>
    </div>
  );
}

function queryUrl(loc) {
  return new URLSearchParams(loc.search).get('u') || '';
}

function querySourceId(loc) {
  return new URLSearchParams(loc.search).get('s') || 'leercapitulo';
}

function backToFor(loc) {
  const params = new URLSearchParams(loc.search);
  const back = params.get('back');
  if (back?.startsWith('/explorar?') || back?.startsWith('/manga?')) return back;
  const from = params.get('from');
  if (from === 'resultados') return `/resultados?s=${encodeURIComponent(params.get('s') || 'leercapitulo')}`;
  if (from === 'fuentes') return `/explorar?tab=fuentes&source=${encodeURIComponent(params.get('s') || '')}`;
  return from === 'explorar' ? '/explorar' : '/biblioteca';
}

const Detail = memo(function Detail({ locationOverride, active, activeRef }) {
  const navigate = useNavigate();
  const loc = locationOverride;
  const mangaUrl = queryUrl(loc);
  const sourceId = querySourceId(loc);
  const sourceManifest = extensions.manifest(sourceId);
  const backTo = backToFor(loc);
  const fromParam = new URLSearchParams(loc.search).get('from') || 'biblioteca';
  const routeParams = new URLSearchParams(loc.search);
  const readerBackParam = routeParams.get('back') ? `&back=${encodeURIComponent(backTo)}` : '';
  const migrationSearchMode = routeParams.get('migrationSearch') === '1';
  const migrationSearchTargets = (routeParams.get('migrationTargets') || '').split(',').filter(Boolean);
  const migrationSearchQuery = routeParams.get('migrationQuery') || '';
  const migrationSearchId = routeParams.get('migrationSearchId') || '';
  const migrationSearchRoute = `${loc.pathname}${loc.search}`;
  const migrationReturnParams = new URLSearchParams(loc.search);
  migrationReturnParams.delete('migrationSearch');
  migrationReturnParams.delete('migrationTargets');
  migrationReturnParams.delete('migrationQuery');
  migrationReturnParams.delete('migrationSearchId');
  const migrationReturnTo = `${loc.pathname}?${migrationReturnParams}`;
  const migrationCatalogParams = new URLSearchParams({
    tab: 'mangas',
    q: migrationSearchQuery,
    migrationFrom: mangaUrl,
    migrationSource: sourceId,
    migrationTargets: migrationSearchTargets.join(','),
    migrationSearchId
  });
  useEffect(() => {
    if (fromParam === 'fuentes') sourceCatalogState.requestRestore();
  }, [fromParam]);
  const sourceAvailable = extensions.isInstalled(sourceId);
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const [coverSetting, setCoverSetting] = useState(() => settings.get().coverSize);
  const adultExtensionDisabled = !isExtensionAllowed(extensions.manifest(sourceId), showAdultExtensions);
  const detailKey = `${sourceId}|${mangaUrl}`;
  const [detailState, setDetailState] = useState(() => ({
    key: detailKey,
    data: api.peekDetail(mangaUrl, sourceId) || api.peekStaleDetail(mangaUrl, sourceId)
  }));
  const d = detailState.key === detailKey ? detailState.data : api.peekStaleDetail(mangaUrl, sourceId);
  const [err, setErr] = useState('');
  const [fav, setFav] = useState(false);
  const [asc, setAsc] = useState(() => chapterOrder.get(mangaUrl));
  const [groupFilter, setGroupFilter] = useState(() => {
    try {
      const map = JSON.parse(localStorage.getItem('cytlex:groupFilterByManga') || '{}');
      return map[`${sourceId}|${mangaUrl}`] || 'all';
    } catch { return 'all'; }
  });
  const [chapterSort, setChapterSort] = useState('chapter');
  const [chaptersPerRow, setChaptersPerRow] = useState(() => {
    try {
      const map = JSON.parse(localStorage.getItem('cytlex:chaptersPerRowByManga') || '{}');
      if (map[mangaUrl]) return map[mangaUrl];
    } catch {}
    const v = settings.get().chaptersPerRow;
    return [1, 2, 3].includes(v) ? v : 1;
  });
  const chapterWindowKey = [detailKey, groupFilter, chapterSort, asc, chaptersPerRow].join('|');
  const [chapterWindow, setChapterWindow] = useState({ key: '', count: 0 });
  const initialChapterCount = (d?.chapters?.length || 0) >= 500
    ? Math.ceil(d.chapters.length / 2)
    : (d?.chapters?.length || 0);
  const visibleChapterCount = chapterWindow.key === chapterWindowKey ? chapterWindow.count : initialChapterCount;
  const [dup, setDup] = useState(null);
  const [migration, setMigration] = useState(null);
  const [catPick, setCatPick] = useState(null);
  const catMenuRef = useRef(null);
  const coverRef = useRef(null);
  const synRef = useRef(null);
  const [availH, setAvailH] = useState(0);
  const [fullH, setFullH] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [, setProgressTick] = useState(0);
  const [coverTick, setCoverTick] = useState(0);
  const [markBefore, setMarkBefore] = useState(null);
  const [pendingChapterJump, setPendingChapterJump] = useState('');
  const [highlightedChapter, setHighlightedChapter] = useState('');
  const chapterRefs = useRef(new Map());
  const chapterHighlightTimer = useRef(null);
  const chapterJumpContext = useRef(null);
  const [aniListOpen, setAniListOpen] = useState(false);
  const [aniLinked, setAniLinked] = useState(() => !!tracking.get(mangaUrl, sourceId));
  const [anilistCover, setAnilistCover] = useState(() => !!settings.get().anilistCover);

  const scale = useScale();
  const coverSize = Math.round(COVER_BASE * scale);
  const installedExtensions = extensions.sources()
    .map(({ manifest }) => manifest)
    .filter((manifest, index, sources) => sources.findIndex((source) => source.id === manifest.id) === index);
  const migrationTargets = installedExtensions.filter((manifest) => manifest.id !== sourceId);

  const knownCover = useMemo(() => {
    const fav = lib.fav(mangaUrl, sourceId);
    const local = fav?.coverLocal;
    const t = tracking.get(mangaUrl, sourceId);
    const tLocal = t?.coverLocal;
    const tCover = t?.cover;
    if (anilistCover && tLocal) return tLocal;
    if (anilistCover && tCover) return getLibraryCover(tCover) || tCover;
    if (typeof local === 'string' && local.startsWith('data:')) return local;
    const recalled = recallCover(mangaUrl, sourceId);
    const remoteCover = fav?.cover || tCover || recalled;
    return getLibraryCover(remoteCover) || getSearchCover(remoteCover) || remoteCover || '';
  }, [mangaUrl, sourceId, anilistCover, coverTick]);

  const coverSrc = useMemo(() => {
    const t = tracking.get(mangaUrl, sourceId);
    const tLocal = t?.coverLocal;
    const tCover = t?.cover;
    if (anilistCover && tCover) return tCover;
    if (anilistCover && tLocal) return tLocal;
    if (d?.cover) return d.cover;
    const local = lib.fav(mangaUrl, sourceId)?.coverLocal;
    if (typeof local === 'string' && local.startsWith('data:')) return local;
    if (knownCover) return knownCover;
    return '';
  }, [d?.cover, knownCover, mangaUrl, sourceId, anilistCover, coverTick]);

  const [coverError, setCoverError] = useState(false);
  const coverKey = `${sourceId}|${mangaUrl}`;
  const coverKeyRef = useRef(coverKey);
  coverKeyRef.current = coverKey;
  const warmCover = getLibraryCover(knownCover)
    || getSearchCover(knownCover)
    || (hasLibraryCoverLoaded(knownCover) ? knownCover : '');
  const [displayedCover, setDisplayedCover] = useState(() => ({
    key: coverKey,
    src: getLibraryCover(coverSrc) || getSearchCover(coverSrc) || (hasLibraryCoverLoaded(coverSrc) ? coverSrc : '')
  }));
  const [failedCover, setFailedCover] = useState('');
  const visibleCover = (displayedCover.key === coverKey && displayedCover.src)
    || warmCover;
  useEffect(() => {
    setCoverError(false);
    setFailedCover('');
  }, [coverSrc]);
  const finalCover = coverError && knownCover && coverSrc !== knownCover ? knownCover : coverSrc;
  const proxyCover = requiresImageProxy(finalCover);
  useEffect(() => {
    if (!proxyCover || !finalCover) return undefined;
    let alive = true;
    const loadCover = async () => {
      const candidates = [...new Set([finalCover, knownCover].filter(Boolean))];
      for (const candidate of candidates) {
        const cached = getLibraryCover(candidate) || getSearchCover(candidate);
        const local = cached || await preloadLibraryCover(candidate);
        if (!alive) return;
        if (local) {
          setDisplayedCover({ key: coverKey, src: local });
          setFailedCover('');
          return;
        }
      }
      if (alive) setFailedCover(finalCover);
    };
    loadCover();
    return () => { alive = false; };
  }, [coverKey, finalCover, knownCover, proxyCover]);
  const coverImg = (alt) => (
    <>
      {visibleCover && visibleCover !== finalCover && (
        <img
          key={`${coverKey}|cached|${visibleCover}`}
          className="absolute inset-0 w-full h-full object-cover"
          src={visibleCover}
          alt={alt}
          referrerPolicy="no-referrer"
        />
      )}
      {finalCover && !proxyCover && failedCover !== finalCover && (
        <img
          key={`${coverKey}|source|${finalCover}`}
          className="absolute inset-0 w-full h-full object-cover"
          src={finalCover}
          alt={alt}
          referrerPolicy="no-referrer"
          onLoad={() => {
            if (coverKeyRef.current !== coverKey) return;
            if (!/^https?:\/\//i.test(finalCover || '')) markLibraryCoverLoaded(finalCover);
            setDisplayedCover({ key: coverKey, src: finalCover });
            setFailedCover('');
            if (/^https?:\/\//i.test(finalCover || '')) preloadLibraryCover(finalCover);
          }}
          onError={async () => {
            if (coverKeyRef.current !== coverKey) return;
            if (/^https?:\/\//i.test(finalCover || '')) {
              const local = await preloadLibraryCover(finalCover);
              if (coverKeyRef.current !== coverKey) return;
              if (local) {
                setDisplayedCover({ key: coverKey, src: local });
                setFailedCover('');
                return;
              }
            }
            if (knownCover && finalCover !== knownCover) setCoverError(true);
            else setFailedCover(finalCover);
          }}
        />
      )}
    </>
  );

  useEffect(() => tracking.subscribe(() => { setAniLinked(!!tracking.get(mangaUrl, sourceId)); setCoverTick((t) => t + 1); }), []);
  useEffect(() => settings.subscribe((s) => setAnilistCover(!!s.anilistCover)), []);
  useEffect(() => settings.subscribe((s) => setShowAdultExtensions(!!s.showAdultExtensions)), []);
  useEffect(() => settings.subscribe((s) => setCoverSetting(s.coverSize)), []);
  useEffect(() => settings.subscribe((s) => {
    try {
      const map = JSON.parse(localStorage.getItem('cytlex:chaptersPerRowByManga') || '{}');
      if (map[mangaUrl]) return; // per-manga override takes precedence
    } catch {}
    const v = s.chaptersPerRow;
    setChaptersPerRow([1, 2, 3].includes(v) ? v : 1);
  }), []);

  useEffect(() => {
    const main = document.querySelector('main');
    if (migrationSearchMode || !main || !active || !activeRef.current) return undefined;

    const requestedRestore = detailScroll.takeRestore(mangaUrl);
    const saved = requestedRestore;
    let restoring = saved > 0;
    const apply = () => {
      if (!activeRef.current) return;
      const max = main.scrollHeight - main.clientHeight;
      main.scrollTop = restoring ? Math.min(saved, Math.max(0, max)) : 0;
    };
    apply();
    const raf1 = requestAnimationFrame(() => requestAnimationFrame(apply));
    const cover = coverRef.current;
    cover?.addEventListener('load', apply);

    let ticks = 0;
    let lastH = -1;
    let settleTimer = null;
    const settle = () => {
      if (!activeRef.current) { restoring = false; return; }
      if (ticks > 8) { restoring = false; return; }
      ticks += 1;
      const h = main.scrollHeight;
      if (h === lastH) { restoring = false; return; }
      lastH = h;
      apply();
      settleTimer = setTimeout(settle, 120);
    };
    settleTimer = setTimeout(settle, 120);

    const save = () => { if (activeRef.current && !restoring) detailScroll.set(mangaUrl, main.scrollTop); };
    main.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(settleTimer);
      cover?.removeEventListener('load', apply);
      main.removeEventListener('scroll', save);
    };
  }, [active, mangaUrl, d?.chapters?.length, migrationSearchMode]);
  useEffect(
    () => tracking.subscribe(() => setAniLinked(!!tracking.get(mangaUrl, sourceId))),
    [mangaUrl, sourceId]
  );

  useEffect(() => {
    if (migrationSearchMode) return undefined;
    if (!mangaUrl) return undefined;
    if (!extensions.isInstalled(sourceId)) return undefined;
    setErr('');
    setExpanded(false);
    setAnimate(false);
    setAsc(chapterOrder.get(mangaUrl));
    setFav(!!lib.fav(mangaUrl, sourceId));
    setAniLinked(!!tracking.get(mangaUrl, sourceId));

    const cached = api.peekDetail(mangaUrl, sourceId) || api.peekStaleDetail(mangaUrl, sourceId);
    setDetailState({ key: `${sourceId}|${mangaUrl}`, data: cached || null });
    if (cached?.chapters?.length) reconcileMihonProgress(mangaUrl, sourceId, cached.chapters);

    let alive = true;
    api
      .detail(mangaUrl, sourceId)
      .then((r) => {
        if (!alive) return;
        if (cached && cached !== r) reconcileChapterProgress(cached.chapters, r?.chapters, sourceId, sourceId, mangaUrl);
        setDetailState({ key: `${sourceId}|${mangaUrl}`, data: r });
        reconcileMihonProgress(mangaUrl, sourceId, r?.chapters);
        const favorite = lib.fav(mangaUrl, sourceId);
        if (r?.cover && favorite && (
          r.cover !== favorite.cover
          || favorite.coverLocal
          || favorite.coverCached
        )) {
          lib.updateFav(mangaUrl, { cover: r.cover, coverLocal: '', coverCached: '' }, sourceId);
          setCoverTick((tick) => tick + 1);
        }
      })
      .catch(async (e) => {
        if (!alive) return;
        const message = String(e?.message || e);
        if (/\bHTTP 404\b/.test(message)) {
          const favorite = lib.fav(mangaUrl, sourceId);
          const title = favorite?.title || d?.title || decodeURIComponent(mangaUrl.split('/').filter(Boolean).at(-1) || '').replace(/-/g, ' ');
          if (title) {
            try {
              const recovered = await api.findManga({ url: mangaUrl, title, author: favorite?.author || d?.facts?.autor || '' }, sourceId);
              if (alive && activeRef.current && recovered) {
                const updates = { url: recovered.url };
                if (recovered.detail?.cover && !favorite?.cover && !favorite?.coverLocal) {
                  updates.cover = recovered.detail.cover;
                }
                lib.updateFav(mangaUrl, updates, sourceId);
                tracking.move(mangaUrl, recovered.url, sourceId);
                chapterOrder.move(mangaUrl, recovered.url);
                const params = new URLSearchParams(loc.search);
                params.set('u', recovered.url);
                navigate({ pathname: loc.pathname, search: params.toString() }, { replace: true });
                return;
              }
            } catch {}
          }
        }
        if (alive && !cached) setErr(message);
      });

    return () => { alive = false; };
  }, [mangaUrl, sourceId, migrationSearchMode]);

  useLayoutEffect(() => {
    if (!active) return undefined;
    const cover = coverRef.current;
    const syn = synRef.current;
    if (!cover || !syn) return undefined;

    const update = () => {
      const c = cover.getBoundingClientRect();
      const s = syn.getBoundingClientRect();
      if (c.height === 0 || s.width === 0) return;
      const avail = Math.max(0, c.bottom - s.top - EXPAND_CTRL_H);
      setFullH(syn.scrollHeight);
      setAvailH(avail);
      setOverflow(syn.scrollHeight > avail + 4);
    };

    update();
    const raf = requestAnimationFrame(update);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null;
    resizeObserver?.observe(cover);
    resizeObserver?.observe(syn);
    let raf2 = 0;
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        raf2 = requestAnimationFrame(update);
      });
    }
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [active, d, scale]);

  useEffect(() => {
    if (!synRef.current) return;
    setFullH(synRef.current.scrollHeight);
  }, [d, expanded]);

  const addToLibrary = (manga, catIds) => {
    if (!Array.isArray(catIds) || catIds.length === 0) return;
    const chapterUrls = (d?.chapters || []).map((chapter) => chapter.url).filter(Boolean);
    chapterIndex.set(manga.url, manga.sourceId, chapterUrls);
    lib.toggleFav({ ...manga, chapterTotal: chapterUrls.length }, catIds);
    setFav(true);
    makeCoverThumb(manga.cover).then((local) => {
      if (local) lib.updateFav(manga.url, { coverLocal: local }, manga.sourceId);
    });
  };

  const replaceLibraryEntry = (existing, manga) => {
    const existingSourceId = existing.sourceId || 'leercapitulo';
    const chapterUrls = (d?.chapters || []).map((chapter) => chapter.url).filter(Boolean);
    chapterIndex.drop(existing.url, existingSourceId);
    chapterIndex.set(manga.url, manga.sourceId, chapterUrls);
    lib.updateFav(existing.url, {
      ...manga,
      cats: existing.cats || [],
      savedAt: existing.savedAt || Date.now(),
      chapterTotal: chapterUrls.length,
      coverLocal: '',
      coverCached: ''
    }, existingSourceId);
    tracking.move(existing.url, manga.url, existingSourceId, manga.sourceId);
    chapterOrder.move(existing.url, manga.url);
    setFav(true);
    makeCoverThumb(manga.cover).then((local) => {
      if (local) lib.updateFav(manga.url, { coverLocal: local }, manga.sourceId);
    });
    setDup(null);
  };

  const openCatMenu = (manga, selected) => {
    const allCats = lib.cats();
    const initialSelection = selected ?? (allCats[0] ? [allCats[0].id] : []);
    setCatPick({
      list: allCats,
      selected: initialSelection.filter((id) => allCats.some((category) => category.id === id)),
      pending: manga,
      inline: true
    });
  };

  useEffect(() => {
    if (!catPick?.inline) return undefined;
    const onDown = (e) => {
      if (!catMenuRef.current?.contains(e.target)) setCatPick(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setCatPick(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [catPick?.inline]);

  const saveCatPick = () => {
    if (!catPick?.inline) return;
    const { pending, selected } = catPick;
    const alreadySaved = lib.isFav(pending.url, pending.sourceId);
    if (selected.length) {
      if (alreadySaved) {
        lib.updateFavCats(pending.url, selected, pending.sourceId);
        setFav(true);
      } else {
        addToLibrary(pending, selected);
      }
    } else if (alreadySaved) {
      lib.toggleFav(pending);
      setFav(false);
    }
    setCatPick(null);
  };

  const catPickRemoves = !!catPick?.inline
    && catPick.selected.length === 0
    && lib.isFav(catPick.pending.url, catPick.pending.sourceId);

  const onAddClick = () => {
    const manga = {
      url: mangaUrl,
      title: d.title,
      cover: d.cover,
      type: d.facts.tipo,
      genres: d.genres,
      author: d.facts.autor,
      sourceId,
      sourceName: sourceManifest.name,
      sourceIcon: sourceManifest.icon
    };
    const key = norm(d.title);
    const duplicates = lib
      .favs()
      .filter((f) => norm(f.title) === key && !lib.isFav(mangaUrl, sourceId));
    if (duplicates.length) setDup({ list: duplicates, pending: manga, selectedIndex: 0 });
    else openCatMenu(manga);
  };

  useEffect(() => () => clearTimeout(chapterHighlightTimer.current), []);
  useEffect(() => {
    if (!pendingChapterJump) return;
    const context = chapterJumpContext.current;
    if (!context || context.detailKey !== detailKey) return;
    if (context.groupFilter !== 'all' && !context.chapters.some((chapter) => chapter.url === pendingChapterJump)) return;
    const index = context.chapters.findIndex((chapter) => chapter.url === pendingChapterJump);
    if (index < 0) return;
    if (context.visibleChapterCount <= index) {
      setChapterWindow({ key: context.chapterWindowKey, count: context.chapters.length });
      return;
    }
    const element = chapterRefs.current.get(pendingChapterJump);
    if (!element) return;
    setPendingChapterJump('');
    element.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center'
    });
    setHighlightedChapter(pendingChapterJump);
    clearTimeout(chapterHighlightTimer.current);
    chapterHighlightTimer.current = setTimeout(() => setHighlightedChapter(''), 1800);
  }, [pendingChapterJump, detailKey, chapterWindow, groupFilter, d]);

  useEffect(() => {
    if (!d?.chapters?.length) return;
    chapterIndex.set(mangaUrl, sourceId, d.chapters.map((c) => c.url));
  }, [mangaUrl, sourceId, d]);

  useEffect(() => {
    if (migrationSearchMode || !active || !d?.chapters?.length) return undefined;
    const status = norm(d.facts?.estado || d.facts?.status).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const completed = /finaliz|complet|concluid|terminad|finished|ended/.test(status);
    const chapters = [...d.chapters].sort(byNumber);
    const target = completed
      ? chapters.at(-1)
      : chapters.find((chapter) => !progress.get(chapter.url, sourceId)?.read) || chapters[0];
    const saved = target && progress.get(target.url, sourceId);
    if (!target || !saved || saved.read || !Number.isInteger(saved.page) || saved.total > 0) return undefined;

    let alive = true;
    api.chapter(target.url, sourceId).then((chapter) => {
      if (!alive || !Array.isArray(chapter?.pages) || !chapter.pages.length) return;
      const latest = progress.get(target.url, sourceId);
      if (!latest || latest.read || latest.page !== saved.page || latest.total > 0) return;
      progress.savePage(target.url, sourceId, latest.page, chapter.pages.length);
      setProgressTick((tick) => tick + 1);
    }).catch(() => {});

    return () => { alive = false; };
  }, [active, d, mangaUrl, migrationSearchMode, sourceId]);

  if (migrationSearchMode)
    return (
      <Catalog
        locationOverride={{ pathname: '/explorar', search: `?${migrationCatalogParams}` }}
        active={active}
        migrationInline={{
          origin: fromParam,
          backTo: migrationReturnTo,
          returnTo: migrationSearchRoute,
          onBack: () => {
            detailScroll.requestRestore();
            navigate(migrationReturnTo);
          }
        }}
      />
    );

  if (!mangaUrl)
    return <EmptyState face="¯\\_(ツ)_/¯" title="Sin manga seleccionado." />;
  if (adultExtensionDisabled)
    return (
      <EmptyState
        face="（・_・）"
        tone="prompt"
        title="Extensión desactivada"
        description="Activa «Mostrar extensiones +18» en Ajustes > Extensiones para volver a usarla."
        action={<Button onClick={() => { window.location.hash = '#/ajustes'; }}>Ir a Ajustes</Button>}
      />
    );
  if (!sourceAvailable)
    return (
      <EmptyState
        face="（ノಠ益ಠ）ノ"
        tone="prompt"
        title="Fuente no instalada"
        action={
          <Button onClick={() => { window.location.hash = '#/explorar?tab=extensiones'; }}>
            Ir a Extensiones
          </Button>
        }
      />
    );
  if (err)
    return (
      <EmptyState
        face="（╯°□°）╯︵ ┻━┻"
        tone="error"
        title="No se pudo cargar"
        description={err}
        action={<Button variant="secondary" onClick={() => window.location.reload()}>Reintentar</Button>}
      />
    );
  if (!d)
    return (
      <div className="min-h-full flex flex-col">
        <Button
          variant="ghost"
          size="sm"
          className="self-start hover:bg-transparent hover:text-foreground"
          onClick={(e) => { e.currentTarget.blur(); navigate(backTo); }}
          style={{
            marginTop: px(-8, scale, -6),
            marginLeft: px(-8, scale, -6),
            marginBottom: px(4, scale, 3),
            fontSize: px(14, scale, 12)
          }}
        >
          <ArrowLeft className="mr-1.5" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} /> Volver
        </Button>

        <div
          className="flex flex-col md:flex-row"
          style={{ gap: px(24, scale, 19) }}
        >
          {coverSrc ? (
            <div
              className="relative aspect-[2/3] overflow-hidden rounded-xl shrink-0 self-start bg-muted/50"
              style={{ width: `${coverSize}px` }}
            >
              {!visibleCover && failedCover !== finalCover && <Skeleton className="absolute inset-0 rounded-xl" />}
              {coverImg('')}
            </div>
          ) : (
            <Skeleton className="aspect-[2/3] rounded-xl shrink-0" style={{ width: `${coverSize}px` }} />
          )}
          <div className="flex-1 min-w-0">
            <Skeleton style={{ height: px(32, scale, 25), width: '66%', maxWidth: px(448, scale, 350) }} />
            <Skeleton style={{ height: px(17, scale, 13), width: px(160, scale, 125), marginTop: px(4, scale, 3) }} />
            <Skeleton style={{ height: px(15, scale, 11), width: '100%', maxWidth: px(512, scale, 400), marginTop: px(4, scale, 3) }} />
            <div className="flex flex-wrap items-center" style={{ gap: px(8, scale, 6), marginTop: px(12, scale, 9) }}>
              <Skeleton className="rounded-full" style={{ height: px(24, scale, 19), width: px(96, scale, 75) }} />
              <Skeleton className="rounded-full" style={{ height: px(24, scale, 19), width: px(80, scale, 63) }} />
              <Skeleton className="rounded-full" style={{ height: px(24, scale, 19), width: px(112, scale, 88) }} />
              <Skeleton className="rounded-full" style={{ height: px(24, scale, 19), width: px(96, scale, 75) }} />
            </div>
            <div className="flex flex-col" style={{ gap: px(8, scale, 6), marginTop: px(12, scale, 9) }}>
              <Skeleton style={{ height: px(14, scale, 11) }} />
              <Skeleton style={{ height: px(14, scale, 11) }} />
              <Skeleton style={{ height: px(14, scale, 11), width: '80%' }} />
            </div>
          </div>
        </div>
      </div>
    );

  const chapterGroups = [...new Set((d.chapters || []).map((c) => c.group).filter(Boolean))];

  let chapters = d.chapters;
  if (groupFilter !== 'all') chapters = chapters.filter((c) => c.group === groupFilter);
  if (chapterSort === 'scanlation') {
    chapters = [...chapters].sort((a, b) => {
      const ga = a.group || '';
      const gb = b.group || '';
      if (ga !== gb) return ga.localeCompare(gb, 'es', { sensitivity: 'base', numeric: true }) * (asc ? 1 : -1);
      return byNumber(a, b, asc ? 1 : -1);
    });
  } else {
    chapters = [...chapters].sort((a, b) => byNumber(a, b, asc ? 1 : -1));
  }
  chapterJumpContext.current = { detailKey, chapters, visibleChapterCount, chapterWindowKey, groupFilter };

  const changeGroupFilter = (v) => {
    setGroupFilter(v);
    try {
      const map = JSON.parse(localStorage.getItem('cytlex:groupFilterByManga') || '{}');
      map[`${sourceId}|${mangaUrl}`] = v;
      localStorage.setItem('cytlex:groupFilterByManga', JSON.stringify(map));
    } catch {}
  };

  const chaptersOldestFirst = [...d.chapters].sort((a, b) => byNumber(a, b, 1));
  const ordered = chaptersOldestFirst;
  const saveDetailScroll = () => {
    const main = document.querySelector('main');
    if (main) detailScroll.set(mangaUrl, main.scrollTop);
  };
  const openMarkBefore = (chapter) => {
    setMarkBefore({ chapter });
  };

  const markBeforeIndex = markBefore
    ? ordered.findIndex((chapter) => chapter.url === markBefore.chapter.url)
    : -1;
  const chaptersBefore = markBeforeIndex > 0 ? ordered.slice(0, markBeforeIndex) : [];
  const chaptersToMark = chaptersBefore.filter((chapter) => !progress.get(chapter.url, sourceId)?.read);

  const mangaStatus = norm(d.facts.estado || d.facts.status).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isCompleted = /finaliz|complet|concluid|terminad|finished|ended/.test(mangaStatus);
  const pendiente = isCompleted
    ? chaptersOldestFirst.at(-1) || null
    : chaptersOldestFirst.find((c) => !progress.get(c.url, sourceId)?.read) || chaptersOldestFirst[0] || null;
  const cap = pendiente ? progress.get(pendiente.url, sourceId) : null;
  const enMarcha = !!(cap && !cap.read && Number.isInteger(cap.page));
  const resume = pendiente ? { ...pendiente, cap } : null;
  const currentChapter = chaptersOldestFirst.reduce((latest, chapter) => {
    const chapterProgress = progress.get(chapter.url, sourceId);
    if (!chapterProgress || chapterProgress.read || !Number.isInteger(chapterProgress.page)) return latest;
    return !latest || (chapterProgress.updatedAt || 0) > (latest.progress.updatedAt || 0)
      ? { chapter, progress: chapterProgress }
      : latest;
  }, null)?.chapter || resume;

  const goToCurrentChapter = () => {
    if (!currentChapter) return;
    if (groupFilter !== 'all') changeGroupFilter('all');
    setPendingChapterJump(currentChapter.url);
  };

  const fade = Math.min(48, (overflow ? availH : 0) * 0.4);
  const synMask = !expanded && overflow && fade > 4
    ? `linear-gradient(to bottom, #000 calc(100% - ${Math.round(fade)}px), rgba(0,0,0,0.55) calc(100% - ${Math.round(fade * 0.45)}px), transparent 100%)`
    : undefined;
  const badgeStyle = {
    fontSize: px(12, scale, 10),
    paddingLeft: px(10, scale, 8),
    paddingRight: px(10, scale, 8),
    paddingTop: px(2, scale, 1),
    paddingBottom: px(2, scale, 1)
  };

  return (
    <div className="min-h-full flex flex-col">
      <Button
        variant="ghost"
        size="sm"
        className="self-start hover:bg-transparent hover:text-foreground"
        onClick={() => navigate(backTo)}
        style={{
          marginTop: px(-8, scale, -6),
          marginLeft: px(-8, scale, -6),
          marginBottom: px(4, scale, 3),
          fontSize: px(14, scale, 12)
        }}
      >
        <ArrowLeft className="mr-1.5" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} /> Volver
      </Button>

      <div
        className="flex flex-col md:flex-row"
        style={{
          gap: px(24, scale, 19),
          minHeight: `calc(${Math.round(coverSize * 1.5)}px + ${px(14, scale, 10)})`,
          maxHeight: expanded || animate ? undefined : `calc(${Math.round(coverSize * 1.5)}px + ${px(14, scale, 10)})`,
          overflow: expanded || animate ? undefined : 'hidden'
        }}
      >
        <div
          ref={coverRef}
          className="relative aspect-[2/3] overflow-hidden rounded-xl shrink-0 self-start bg-muted/50"
          style={{ width: `${coverSize}px` }}
        >
          {coverSrc ? (
            <>
              {!visibleCover && failedCover !== finalCover && <Skeleton className="absolute inset-0 rounded-xl" />}
              {coverImg(d.title)}
            </>
          ) : (
            <Skeleton className="absolute inset-0 rounded-xl" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1
            className="font-extrabold tracking-tight text-foreground"
            style={{ fontSize: `${Math.round(32 * scale)}px`, lineHeight: 1.1 }}
          >
            {d.title}
          </h1>
          {d.facts.autor && (
            <div className="text-muted-foreground mt-1" style={{ fontSize: `${Math.round(17 * scale)}px` }}>
              Por {d.facts.autor}
            </div>
          )}
          <div className="mt-1">
            <SourceLine sourceId={sourceId} scale={scale} />
          </div>
          <div className="text-muted-foreground mt-1" style={{ fontSize: `${Math.round(15 * scale)}px` }}>
            {d.altTitles?.slice(0, 160)}
          </div>

          <div
            className="flex flex-wrap items-center"
            style={{ gap: px(8, scale, 6), marginTop: px(12, scale, 9) }}
          >
            {(d.facts.estado || d.facts.status) && (
              <Badge style={badgeStyle}>{(d.facts.estado || d.facts.status)}</Badge>
            )}
            {d.facts.tipo && <Badge style={badgeStyle}>{d.facts.tipo}</Badge>}
            {d.genres.slice(0, 6).map((g) => (
              <Badge key={g} variant="outline" style={badgeStyle}>
                {g}
              </Badge>
            ))}
          </div>

          {(d.facts.publicacion || d.facts.periodicidad || d.facts.proximo) && (
            <div className="mt-2 flex flex-wrap gap-x-2 text-muted-foreground" style={{ fontSize: `${Math.round(13 * scale)}px` }}>
              {d.facts.publicacion && <span>Publicado: {d.facts.publicacion}</span>}
              {d.facts.periodicidad && <span>Periodicidad: {d.facts.periodicidad}</span>}
              {d.facts.proximo && <span>Próximo capítulo: {d.facts.proximo}</span>}
            </div>
          )}

          <div style={{ marginTop: px(12, scale, 9) }}>
            <div
              ref={synRef}
              style={{
                maxHeight: expanded ? (fullH || undefined) : (availH || undefined),
                overflow: 'hidden',
                transition: animate ? 'max-height 320ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                WebkitMaskImage: synMask,
                maskImage: synMask,
                fontSize: `${Math.round(15 * scale)}px`
              }}
              className="relative text-muted-foreground leading-relaxed"
              onTransitionEnd={(event) => {
                if (event.propertyName === 'max-height') setAnimate(false);
              }}
            >
              <p>{d.sinopsis}</p>
              {!expanded && overflow && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 backdrop-blur-[3px]"
                  style={{
                    height: `${Math.round(fade)}px`,
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 55%, #000 100%)',
                    maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 55%, #000 100%)'
                  }}
                />
              )}
            </div>
            {overflow && (
              <div className="mt-1 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <button
                  type="button"
                  onClick={() => {
                    setAnimate(true);
                    setExpanded((v) => !v);
                  }}
                  aria-label={expanded ? 'Ver menos' : 'Ver más'}
                  className="grid place-items-center w-6 h-6 rounded-full text-muted-foreground transition-colors hover:bg-accent"
                >
                  <ChevronDown className={cn('w-4 h-4 transition-transform duration-300', expanded && 'rotate-180')} />
                </button>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center border-t border-border"
        style={{
          gap: px(12, scale, 8),
          marginTop: px(24, scale, 16),
          paddingTop: px(20, scale, 14)
        }}
      >
        {resume ? (
          <Button
            className="shadow-none"
            onClick={(e) => {
              e.currentTarget.blur();
              saveDetailScroll();
              window.location.hash = `#/leer?u=${encodeURIComponent(resume.url)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}&from=${fromParam}${readerBackParam}`;
            }}
            style={{
              height: px(40, scale, 33),
              minHeight: px(40, scale, 33),
              flexShrink: 0,
              paddingLeft: px(16, scale, 13),
              paddingRight: px(16, scale, 13),
              fontSize: px(14, scale, 12)
            }}
          >
            {enMarcha ? (
              <BookOpen className="mr-2 shrink-0" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
            ) : (
              <Play className="mr-2 shrink-0" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
            )}
            {enMarcha ? 'Continuar' : 'Leer'} {resume.title}
            {enMarcha && (
              <span className="opacity-70 ml-2">
                · {cap.page + 1}/{cap.total || '?'}
              </span>
            )}
          </Button>
        ) : null}
        <div className="relative" ref={catMenuRef}>
          <Button
            variant="secondary"
            className="active:scale-100"
            aria-expanded={!!catPick?.inline}
            aria-label={fav ? 'Cambiar categorías de la biblioteca' : 'Añadir a la biblioteca'}
            onClick={() => {
              if (catPick?.inline) {
                setCatPick(null);
                return;
              }
              const manga = {
                url: mangaUrl,
                title: d.title,
                cover: d.cover,
                type: d.facts.tipo,
                author: d.facts.autor,
                sourceId,
                sourceName: sourceManifest.name,
                sourceIcon: sourceManifest.icon
              };
              if (fav) {
                const saved = lib.fav(mangaUrl, sourceId);
                openCatMenu(manga, saved?.cats || []);
                return;
              }
              onAddClick();
            }}
            style={{
              height: px(40, scale, 33),
              minHeight: px(40, scale, 33),
              flexShrink: 0,
              paddingLeft: px(16, scale, 13),
              paddingRight: px(16, scale, 13),
              fontSize: px(14, scale, 12)
            }}
          >
            <span className="inline-grid shrink-0">
              <span aria-hidden="true" className="invisible col-start-1 row-start-1 inline-flex items-center whitespace-nowrap">
                <Star className="mr-2" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
                {fav ? 'En biblioteca' : 'Añadir'}
              </span>
              <span aria-hidden="true" className="col-start-1 row-start-1 inline-flex items-center whitespace-nowrap">
                <Star
                  className={cn('mr-2 shrink-0', fav && 'fill-current text-amber-400')}
                  style={{ width: px(16, scale, 14), height: px(16, scale, 14) }}
                />
                {fav ? 'En biblioteca' : 'Añadir'}
              </span>
            </span>
            <ChevronDown
              className={cn('ml-2 transition-transform duration-200', catPick?.inline && 'rotate-180')}
              style={{ width: px(14, scale, 12), height: px(14, scale, 12) }}
            />
          </Button>

          {catPick?.inline && (
            <div className="absolute left-1/2 top-full z-40 mt-2 w-max min-w-full max-w-64 -translate-x-1/2 rounded-xl border border-border bg-card shadow-2xl" style={{ padding: px(12, scale, 9) }}>
              <div className="flex flex-col" style={{ gap: px(6, scale, 4) }}>
                {catPick.list.map((c) => {
                  const on = catPick.selected.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.name}
                      onClick={() =>
                        setCatPick((p) => ({
                          ...p,
                          selected: on ? p.selected.filter((x) => x !== c.id) : [...p.selected, c.id]
                        }))
                      }
                      aria-pressed={on}
                      className={cn(
                        'relative flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border text-left font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        on
                          ? 'border-primary/40 bg-primary/10 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:bg-accent'
                      )}
                      style={{
                        paddingLeft: px(10, scale, 7),
                        paddingRight: px(10, scale, 7),
                        paddingTop: px(6, scale, 4),
                        paddingBottom: px(6, scale, 4),
                        fontSize: px(12, scale, 10)
                      }}
                    >
                      <span className="min-w-0 truncate">{c.name}</span>
                      <span className={cn('grid shrink-0 place-items-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 bg-background')} style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}>
                        {on && <Check aria-hidden="true" style={{ width: px(12, scale, 10), height: px(12, scale, 10) }} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 w-full">
                <Button
                  size="sm"
                  variant={catPickRemoves ? 'destructive' : 'default'}
                  className="w-full transition-colors duration-200 active:scale-100"
                  aria-label={catPickRemoves ? 'Eliminar manga de la biblioteca' : 'Añadir manga a la biblioteca'}
                  disabled={catPick.selected.length === 0 && !catPickRemoves}
                  style={{
                    transform: 'none',
                    height: px(32, scale, 27),
                    fontSize: px(13, scale, 11),
                    paddingLeft: px(12, scale, 9),
                    paddingRight: px(12, scale, 9)
                  }}
                  onClick={saveCatPick}
                >
                  {catPickRemoves ? 'Eliminar' : 'Añadir'}
                </Button>
              </div>
            </div>
          )}

        </div>
        {fav && migrationTargets.length > 0 && (
          <Button
            variant="secondary"
            className="active:scale-100"
            onClick={() => {
              setCatPick(null);
              setMigration({
                targetIds: migrationTargets.map((manifest) => manifest.id),
              });
            }}
            title="Migrar manga a otra extensión"
            style={{
              height: px(40, scale, 33),
              minHeight: px(40, scale, 33),
              flexShrink: 0,
              paddingLeft: px(16, scale, 13),
              paddingRight: px(16, scale, 13),
              fontSize: px(14, scale, 12)
            }}
          >
            <ArrowRightLeft className="mr-2 shrink-0" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
            Migrar fuente
          </Button>
        )}
        <Button
          variant="secondary"
          className="active:scale-100"
          onClick={() => setAniListOpen(true)}
          title="Vincular con AniList"
          style={{
            height: px(40, scale, 33),
            minHeight: px(40, scale, 33),
            flexShrink: 0,
            paddingLeft: px(16, scale, 13),
            paddingRight: px(16, scale, 13),
            fontSize: px(14, scale, 12)
          }}
        >
          <Link2
            className={cn('mr-2 shrink-0', aniLinked && 'text-primary')}
            style={{ width: px(16, scale, 14), height: px(16, scale, 14) }}
          />
          Seguimiento
        </Button>
      </div>

      <AniListPanel
        mangaUrl={mangaUrl}
        sourceId={sourceId}
        title={d.title}
        open={aniListOpen}
        onClose={() => setAniListOpen(false)}
      />

      <div className="border-t border-border pt-3" style={{ marginTop: px(20, scale, 14) }}>
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAsc((v) => { chapterOrder.set(mangaUrl, !v); return !v; })}
            title={asc ? 'Orden: más antiguos primero' : 'Orden: más recientes primero'}
            aria-label={asc ? 'Cambiar a más recientes primero' : 'Cambiar a más antiguos primero'}
            className="grid place-items-center rounded-lg text-foreground"
            style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
          >
            <span className="relative grid place-items-center" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }}>
              <ArrowUp
                className={cn(
                  'col-start-1 row-start-1 transition-all duration-200',
                  asc ? 'opacity-0 -rotate-90' : 'opacity-100 rotate-0'
                )}
                style={{ width: px(16, scale, 14), height: px(16, scale, 14) }}
              />
              <ArrowDown
                className={cn(
                  'col-start-1 row-start-1 transition-all duration-200',
                  asc ? 'opacity-100 rotate-0' : 'opacity-0 rotate-90'
                )}
                style={{ width: px(16, scale, 14), height: px(16, scale, 14) }}
              />
            </span>
          </button>
          <Button
            size="sm"
            variant="secondary"
            title="Capítulos por fila"
            className="rounded-lg"
            onClick={() => {
              const order = [1, 2, 3];
              const next = order[(order.indexOf(chaptersPerRow) + 1) % order.length];
              setChaptersPerRow(next);
              try {
                const map = JSON.parse(localStorage.getItem('cytlex:chaptersPerRowByManga') || '{}');
                map[mangaUrl] = next;
                localStorage.setItem('cytlex:chaptersPerRowByManga', JSON.stringify(map));
              } catch {}
            }}
            style={{
              height: px(32, scale, 27),
              fontSize: px(13, scale, 11),
              paddingLeft: px(10, scale, 8),
              paddingRight: px(10, scale, 8)
            }}
          >
            {chaptersPerRow} por fila
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="rounded-lg"
            title={currentChapter ? `Ir a ${currentChapter.title}` : 'No hay un capítulo actual'}
            aria-label={currentChapter ? `Ir al capítulo actual: ${currentChapter.title}` : 'No hay un capítulo actual'}
            disabled={!currentChapter}
            onClick={goToCurrentChapter}
            style={{ width: px(32, scale, 27), height: px(32, scale, 27), flexShrink: 0 }}
          >
            <Crosshair style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
          </Button>
          {chapterGroups.length > 1 && (
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground" style={{ fontSize: px(13, scale, 11) }}>
                Orden:
              </span>
              <Button
                size="sm"
                variant="secondary"
                title="Orden de los capítulos"
                className="rounded-lg"
                onClick={() => setChapterSort((v) => (v === 'chapter' ? 'scanlation' : 'chapter'))}
                style={{
                  height: px(32, scale, 27),
                  fontSize: px(13, scale, 11),
                  paddingLeft: px(10, scale, 8),
                  paddingRight: px(10, scale, 8)
                }}
              >
                {chapterSort === 'chapter' ? 'Por capítulo' : 'Por scanlation'}
              </Button>
            </span>
          )}
          {chapterGroups.length > 1 && (
            <Dropdown
              scale={scale}
              value={groupFilter}
              onChange={changeGroupFilter}
              ariaLabel="Filtrar por scanlation"
              options={[
                { value: 'all', label: `Todos (${d.chapters.length})` },
                ...chapterGroups.map((g) => ({ value: g, label: g }))
              ]}
              style={{ width: px(230, scale, 190) }}
            />
          )}
        </div>
      </div>

      <div
        className={chaptersPerRow > 1 ? 'grid gap-2' : 'flex flex-col gap-2'}
        style={chaptersPerRow > 1 ? { gridTemplateColumns: `repeat(${chaptersPerRow}, minmax(0, 1fr))` } : undefined}
      >
        {chapters.slice(0, visibleChapterCount).map((c, i) => {
          const cap = progress.get(c.url, sourceId);
          const read = !!cap?.read;
          const inCourse = !read && cap && Number.isInteger(cap?.page) && cap.page > 0;
          return (
            <a
              key={i}
              ref={(element) => {
                if (element) chapterRefs.current.set(c.url, element);
                else chapterRefs.current.delete(c.url);
              }}
              className={cn(
                'group relative flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5 hover:bg-accent/50 transition-colors',
                highlightedChapter === c.url && 'cx-chapter-pulse',
                read && 'opacity-45 hover:opacity-70'
              )}
              style={{ minHeight: `${Math.round(52 * scale)}px` }}
              onClick={(e) => { e.currentTarget.blur(); saveDetailScroll(e); }}
              href={`#/leer?u=${encodeURIComponent(c.url)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}&from=${fromParam}${readerBackParam}`}
            >
              <span className="flex-1 min-w-0">
                <span
                  className="block font-semibold truncate"
                  style={{ fontSize: `${Math.round(15 * scale)}px` }}
                >
                  {c.title}
                </span>
                <span
                  className={cn('block text-muted-foreground', chaptersPerRow === 3 && 'truncate')}
                  style={{
                    fontSize: `${Math.round(13 * scale)}px`,
                    lineHeight: `${Math.round(20 * scale)}px`,
                    minHeight: `${Math.round(20 * scale)}px`
                  }}
                >
                  {c.date}
                  {c.group ? ` · ${c.group}` : ''}
                  {inCourse && Number.isInteger(cap.total) && cap.total > 0
                    ? ` · pág. ${cap.page + 1}/${cap.total}`
                    : ''}
                </span>
              </span>
              <span className="shrink-0 flex items-center gap-2">
                {read ? (
                  <span
                    role="button"
                    tabIndex={0}
                    title="Marcar como no leído"
                    aria-label={`Marcar ${c.title} como no leído`}
                    className="order-2 shrink-0 flex items-center gap-1 text-primary rounded-md hover:bg-accent"
                    style={{ fontSize: `${Math.round(13 * scale)}px` }}
                    onClick={(e) => { e.preventDefault(); progress.markUnread(c.url, sourceId, mangaUrl); setProgressTick((t) => t + 1); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); progress.markUnread(c.url, sourceId, mangaUrl); setProgressTick((t) => t + 1); }
                    }}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Leído
                  </span>
                ) : (
                  <span
                    role="button"
                    tabIndex={0}
                    title="Marcar como leído"
                    aria-label={`Marcar ${c.title} como leído`}
                    className="order-2 shrink-0 flex items-center gap-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded-md hover:bg-accent hover:text-foreground transition-opacity"
                    style={{ fontSize: `${Math.round(13 * scale)}px` }}
                    onClick={(e) => { e.preventDefault(); progress.markRead(c.url, sourceId, cap?.total || 0, mangaUrl); setProgressTick((t) => t + 1); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); progress.markRead(c.url, sourceId, cap?.total || 0, mangaUrl); setProgressTick((t) => t + 1); }
                    }}
                  >
                    <Check className="w-4 h-4" />
                    Leído
                  </span>
                )}
                <span className="relative order-1">
                  <button
                    type="button"
                    title="Marcar todos los anteriores como leídos"
                    aria-label={`Marcar anteriores a ${c.title} como leídos`}
                    className="shrink-0 flex items-center rounded-md text-muted-foreground/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-foreground transition-opacity"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); openMarkBefore(c); }}
                  >
                    <CheckCheck className="w-4 h-4" />
                    <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                  </button>
                </span>
              </span>
            </a>
          );
        })}
      </div>

      {visibleChapterCount < chapters.length && (
        <div className="flex justify-center" style={{ paddingTop: px(16, scale, 12) }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setChapterWindow({ key: chapterWindowKey, count: chapters.length })}
          >
            Mostrar siguientes {chapters.length - visibleChapterCount} capítulos
          </Button>
        </div>
      )}

      <Dialog
        open={!!markBefore}
        onClose={() => setMarkBefore(null)}
        scale={scale}
        hideDivider
        title={chaptersToMark.length ? 'Marcar capítulos anteriores' : 'Capítulos anteriores'}
        description={chaptersToMark.length
          ? `Se marcarán como leídos todos los capítulos anteriores al ${markBefore?.chapter.title}.`
          : 'Los capítulos anteriores ya están marcados como leídos.'}
        bodyPaddingTop={8}
      >
        <div className="flex justify-end gap-2" style={{ gap: px(8, scale, 6), paddingTop: px(4, scale, 3) }}>
          {chaptersToMark.length ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                style={{ height: px(36, scale, 30), padding: `${px(4, scale, 3)}px ${px(12, scale, 10)}px`, fontSize: px(14, scale, 12), lineHeight: px(20, scale, 17) }}
                onClick={() => setMarkBefore(null)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                style={{ height: px(36, scale, 30), padding: `${px(4, scale, 3)}px ${px(12, scale, 10)}px`, fontSize: px(14, scale, 12), lineHeight: px(20, scale, 17) }}
                onClick={() => {
                  progress.markMany(chaptersToMark.map((chapter) => chapter.url), sourceId, null, mangaUrl);
                  setProgressTick((t) => t + 1);
                  setMarkBefore(null);
                }}
              >
                Marcar
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              style={{ height: px(36, scale, 30), padding: `${px(4, scale, 3)}px ${px(12, scale, 10)}px`, fontSize: px(14, scale, 12), lineHeight: px(20, scale, 17) }}
              onClick={() => setMarkBefore(null)}
            >
              Cerrar
            </Button>
          )}
        </div>
      </Dialog>

      <Dialog
        open={!!dup}
        onClose={() => setDup(null)}
        scale={scale}
        dialogStyle={{ maxWidth: px(512, scale, 400) }}
        title="Posible duplicado"
        description="Reemplaza una entrada existente; se conservarán sus categorías."
      >
        {dup && (
          <>
            <div>
              {dup.list.map((f, i) => (
                <DuplicateRow
                  key={`${f.sourceId || 'leercapitulo'}|${f.url}`}
                  cover={f.cover}
                  title={f.title}
                  author={f.author}
                  sourceId={f.sourceId}
                  scale={scale}
                  coverScale={coverSetting / 160}
                  selected={dup.selectedIndex === i}
                  selectable={dup.list.length > 1}
                  onSelect={() => setDup((current) => current ? { ...current, selectedIndex: i } : current)}
                />
              ))}
            </div>
            <div className="flex justify-end" style={{ gap: px(8, scale, 6), paddingTop: px(20, scale, 15) }}>
              <Button variant="secondary" onClick={() => replaceLibraryEntry(dup.list[dup.selectedIndex], dup.pending)} style={{ height: px(40, scale, 33), padding: `0 ${px(16, scale, 12)}`, fontSize: px(14, scale, 12) }}>
                Reemplazar
              </Button>
              <Button onClick={() => setDup(null)} style={{ height: px(40, scale, 33), padding: `0 ${px(16, scale, 12)}`, fontSize: px(14, scale, 12) }}>
                Cancelar
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={!!migration}
        onClose={() => setMigration(null)}
        scale={scale}
        dialogStyle={{ maxWidth: px(560, scale, 440) }}
      >
        {migration && (
          <>
            <div className="mb-2 flex items-center justify-between" style={{ fontSize: px(13, scale, 11) }}>
              <span className="text-muted-foreground">
                {migration.targetIds.length} de {migrationTargets.length} fuentes seleccionadas
              </span>
              <div className="flex items-center" style={{ gap: px(12, scale, 9) }}>
                <button
                  type="button"
                  className="text-primary hover:underline disabled:opacity-50"
                  disabled={migration.targetIds.length === migrationTargets.length}
                  onClick={() => setMigration((current) => current ? { ...current, targetIds: migrationTargets.map((manifest) => manifest.id) } : current)}
                >
                  Todas
                </button>
                <button
                  type="button"
                  className="text-primary hover:underline disabled:opacity-50"
                  disabled={migration.targetIds.length === 0}
                  onClick={() => setMigration((current) => current ? { ...current, targetIds: [] } : current)}
                >
                  Ninguna
                </button>
              </div>
            </div>
            <div className="dd-scroll flex flex-col overflow-y-auto pr-1" style={{ maxHeight: px(300, scale, 240), gap: px(6, scale, 4) }}>
              {installedExtensions.map((manifest) => {
                const current = manifest.id === sourceId;
                const checked = !current && migration.targetIds.includes(manifest.id);
                return (
                  <ExtensionChoice
                    key={manifest.id}
                    manifest={manifest}
                    current={current}
                    checked={checked}
                    onChange={() => setMigration((state) => state ? {
                      ...state,
                      targetIds: checked
                        ? state.targetIds.filter((id) => id !== manifest.id)
                        : [...state.targetIds, manifest.id]
                    } : state)}
                    scale={scale}
                  />
                );
              })}
            </div>
            <div className="flex justify-end" style={{ gap: px(8, scale, 6), paddingTop: px(16, scale, 12) }}>
              <Button
                variant="secondary"
                onClick={() => setMigration(null)}
                style={{ height: px(36, scale, 30), padding: `0 ${px(12, scale, 10)}`, fontSize: px(14, scale, 12) }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  const main = document.querySelector('main');
                  if (main) detailScroll.set(mangaUrl, main.scrollTop);
                  const params = new URLSearchParams(loc.search);
                  params.set('migrationSearch', '1');
                  params.set('migrationTargets', migration.targetIds.join(','));
                  params.set('migrationQuery', d.title);
                  params.set('migrationSearchId', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
                  setMigration(null);
                  navigate({ pathname: loc.pathname, search: `?${params.toString()}` });
                }}
                disabled={!migration.targetIds.length}
                style={{ height: px(36, scale, 30), padding: `0 ${px(12, scale, 10)}`, fontSize: px(14, scale, 12) }}
              >
                Buscar
              </Button>
            </div>
          </>
        )}
      </Dialog>

    </div>
  );
}, (previous, next) => previous.active === next.active
  && previous.activeRef === next.activeRef
  && previous.locationOverride.pathname === next.locationOverride.pathname
  && previous.locationOverride.search === next.locationOverride.search);

export default Detail;
