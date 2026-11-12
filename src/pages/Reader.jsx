import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { extensions, isExtensionAllowed } from '../lib/extensions.js';
import { settings } from '../lib/settings.js';
import { progress } from '../lib/progress.js';
import { lib } from '../lib/library.js';
import { tracking } from '../lib/tracking.js';
import { chapterOrder, detailScroll } from '../lib/searchState.js';
import { sync } from '../lib/sync.js';
import { appWindow } from '../lib/appWindow.js';
import { browserImageUrl, fetchImage } from '../lib/browserHttp.js';
import { Button } from '../components/ui/button.jsx';
import { Dropdown } from '../components/ui/dropdown.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

const chapterUrlKey = (value) => {
  try {
    const url = new URL(value, window.location.href);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(value || '').replace(/\/+$/, '');
  }
};

const chapterNumberFrom = (value) => {
  const match = String(value || '').match(/[\d.]+/);
  return match ? Number(match[0]) : NaN;
};

const pageImages = 'img[alt^="Página "]';

function visiblePageBounds(stage) {
  return [...stage.querySelectorAll(pageImages)]
    .filter((img) => img.naturalWidth > 0)
    .map((img) => {
      const rect = img.getBoundingClientRect();
      const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
      const insetX = (rect.width - img.naturalWidth * scale) / 2;
      const insetY = (rect.height - img.naturalHeight * scale) / 2;
      return { left: rect.left + insetX, right: rect.right - insetX, top: rect.top + insetY, bottom: rect.bottom - insetY };
    });
}

function pageBounds(stage) {
  const panels = visiblePageBounds(stage);
  if (!panels.length) return null;
  return {
    left: Math.min(...panels.map((panel) => panel.left)),
    right: Math.max(...panels.map((panel) => panel.right)),
    top: Math.min(...panels.map((panel) => panel.top)),
    bottom: Math.max(...panels.map((panel) => panel.bottom)),
  };
}

function clampPagePan(pan, start, end, viewportStart, viewportEnd) {
  const min = viewportEnd - end;
  const max = viewportStart - start;
  return min <= max ? Math.max(min, Math.min(max, pan)) : (min + max) / 2;
}

function zoomPanAtPointer(stage, content, bounds, targetScale, { clientX, clientY }) {
  const viewport = stage.getBoundingClientRect();
  const rendered = content.getBoundingClientRect();
  if (!bounds || !rendered.width || !viewport.width || !stage.clientWidth) return { x: 0, y: 0 };
  const ratio = targetScale * viewport.width / rendered.width;
  const cssZoom = viewport.width / stage.clientWidth;
  const centerX = (viewport.left + viewport.right) / 2;
  const centerY = (viewport.top + viewport.bottom) / 2;
  const renderedX = (rendered.left + rendered.right) / 2;
  const renderedY = (rendered.top + rendered.bottom) / 2;
  const projectX = (x) => centerX + (x - renderedX) * ratio;
  const projectY = (y) => centerY + (y - renderedY) * ratio;
  return {
    x: clampPagePan(clientX - projectX(clientX), projectX(bounds.left), projectX(bounds.right), viewport.left, viewport.right) / cssZoom,
    y: clampPagePan(clientY - projectY(clientY), projectY(bounds.top), projectY(bounds.bottom), viewport.top, viewport.bottom) / cssZoom,
  };
}

const imageMimeFor = (mime, src, base64) => {
  const normalized = String(mime || '').split(';', 1)[0].trim().toLowerCase();
  if (normalized.startsWith('image/')) return normalized;
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.startsWith('AAAAIGZ0eXBhdmlm')) return 'image/avif';
  try {
    const extension = new URL(src, window.location.href).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' })[extension] || 'image/webp';
  } catch {
    return 'image/webp';
  }
};

function ReaderPanel({ id, src, displaySrc = '', fallbackSrc = '', alt, loading = 'eager', imageReferer, imageCookie, imageClassName, wrapperClassName, placeholderStyle, onContextMenu, onLoaded, onRetry }) {
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [usingFallback, setUsingFallback] = useState(false);
  const [srcOverride, setSrcOverride] = useState('');
  const [displaySrcFailed, setDisplaySrcFailed] = useState(false);
  const [cachedDisplaySrc, setCachedDisplaySrc] = useState(displaySrc);
  const imageFallback = useRef(null);
  const autoRetried = useRef(false);
  const imageRef = useRef(null);
  const imageSrc = srcOverride || (!usingFallback && !displaySrcFailed ? cachedDisplaySrc : '')
    || browserImageUrl(usingFallback ? fallbackSrc : src, imageReferer);

  useEffect(() => () => {
    imageFallback.current?.abort();
    imageFallback.current = null;
  }, []);

  const finishImageLoad = useCallback(() => {
    imageFallback.current?.abort();
    imageFallback.current = null;
    setStatus('loaded');
    onLoaded?.();
  }, [onLoaded]);

  useLayoutEffect(() => {
    if (status === 'loaded') return;
    const img = imageRef.current;
    if (status === 'loading' && img?.complete && img.naturalWidth > 0 && img.currentSrc === img.src) {
      finishImageLoad();
      return;
    }
    if (!displaySrc || displaySrc === cachedDisplaySrc || displaySrcFailed) return;
    imageFallback.current?.abort();
    imageFallback.current = null;
    autoRetried.current = false;
    setSrcOverride('');
    setUsingFallback(false);
    setCachedDisplaySrc(displaySrc);
    setStatus('loading');
  }, [attempt, cachedDisplaySrc, displaySrc, displaySrcFailed, finishImageLoad, imageSrc, status]);

  useEffect(() => {
    if (status !== 'loading' || loading !== 'eager') return undefined;
    const timeout = setTimeout(() => {
      if (!autoRetried.current) {
        autoRetried.current = true;
        setAttempt((current) => current + 1);
      } else {
        setStatus('error');
      }
    }, 15_000);
    return () => clearTimeout(timeout);
  }, [attempt, cachedDisplaySrc, loading, src, status, usingFallback]);

  return (
    <div id={id} className={cn('relative grid place-items-center', wrapperClassName)} style={status === 'loaded' ? undefined : placeholderStyle}>
      {status === 'loading' && (
        <div role="status" aria-label={`Cargando ${alt.toLowerCase()}`} className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      {status === 'error' && (
        <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/90 px-3 text-center text-sm text-muted-foreground">
          <span>No se pudo cargar {alt.toLowerCase()}.</span>
          <Button size="sm" variant="secondary" onClick={async () => {
            autoRetried.current = false;
            imageFallback.current?.abort();
            imageFallback.current = null;
            setStatus('loading');
            if (onRetry) {
              if (await onRetry()) {
                setSrcOverride('');
                setDisplaySrcFailed(false);
                setUsingFallback(false);
                setAttempt((n) => n + 1);
              } else {
                setStatus('error');
              }
            } else {
              setAttempt((n) => n + 1);
            }
          }}>
            Reintentar
          </Button>
        </div>
      )}
      <img
        key={attempt}
        ref={imageRef}
        src={imageSrc}
        alt={alt}
        loading={loading}
        draggable={false}
        referrerPolicy="no-referrer"
        onDragStart={(e) => e.preventDefault()}
        onContextMenu={onContextMenu}
        onLoad={finishImageLoad}
        onError={() => {
          if (!usingFallback && !srcOverride && cachedDisplaySrc && !displaySrcFailed) {
            setDisplaySrcFailed(true);
            autoRetried.current = false;
            setStatus('loading');
            return;
          }
          if (!usingFallback && fallbackSrc && fallbackSrc !== src) {
            autoRetried.current = false;
            setUsingFallback(true);
            setAttempt(0);
            setStatus('loading');
            return;
          }
          if (!usingFallback && !srcOverride && !imageFallback.current) {
            const controller = new AbortController();
            imageFallback.current = controller;
            setStatus('loading');
            autoRetried.current = false;
            fetchImage(src, controller.signal, imageReferer, imageCookie).then((img) => {
              if (controller.signal.aborted) return;
              if (img?.base64) {
                setSrcOverride(`data:${imageMimeFor(img.mime, src, img.base64)};base64,${img.base64}`);
                setAttempt((n) => n + 1);
                setStatus('loading');
              } else {
                setStatus('error');
              }
            }).catch(() => {
              if (!controller.signal.aborted) setStatus('error');
            }).finally(() => {
              if (imageFallback.current === controller) imageFallback.current = null;
            });
            return;
          }
          setStatus('error');
        }}
        className={cn(imageClassName, 'transition-opacity duration-150', status === 'loaded' ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  );
}

export default function Reader() {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const chapterUrl = params.get('u') || '';
  const mangaUrl = params.get('m') || '';
  const sourceId = params.get('s') || 'leercapitulo';
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const adultExtensionDisabled = !isExtensionAllowed(extensions.manifest(sourceId), showAdultExtensions);
  const fromParam = params.get('from') || '';
  const fromQS = fromParam ? `&from=${encodeURIComponent(fromParam)}` : '';
  const detailBack = params.get('back') || '';
  const detailBackQS = detailBack.startsWith('/manga?')
    ? `&back=${encodeURIComponent(detailBack)}`
    : '';
  const backHash = `#/manga?u=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}${fromQS}${detailBackQS}`;
  const goBack = useCallback(() => {
    detailScroll.requestRestore();
    window.location.hash = backHash;
  }, [backHash]);
  const [ch, setCh] = useState(null);
  const [chUrl, setChUrl] = useState('');
  const [mangaDetail, setMangaDetail] = useState(null);
  const currentMangaUrl = mangaUrl || ch?.mangaUrl || '';
  const mangaKey = `${sourceId}|${currentMangaUrl}`;
  const detail = mangaDetail?.key === mangaKey ? mangaDetail.value : null;
  const savedTitle = useMemo(() => currentMangaUrl ? lib.fav(currentMangaUrl, sourceId)?.title : '', [currentMangaUrl, sourceId]);
  const mangaTitle = detail?.title || savedTitle || 'Lector';
  const [err, setErr] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const [mode, setMode] = useState(() => {
    try {
      const map = JSON.parse(localStorage.getItem('cytlex:readerModeByManga') || '{}');
      if (map[mangaUrl]) return map[mangaUrl];
    } catch {}
    return settings.get().readerMode;
  });
  const [doublePage, setDoublePage] = useState(() => !!settings.get().readerDoublePage);
  const paginated = mode === 'paginado' || mode === 'paginado-rtl';
  const rtl = mode === 'paginado-rtl';
  const useDouble = paginated && doublePage;
  const [page, setPage] = useState(0);
  const scale = useScale();
  useEffect(() => settings.subscribe((s) => {
    try {
      const map = JSON.parse(localStorage.getItem('cytlex:readerModeByManga') || '{}');
      if (map[mangaUrl]) return; // per-manga override
    } catch {}
    setMode(s.readerMode);
  }), []);
  useEffect(() => settings.subscribe((s) => setDoublePage(!!s.readerDoublePage)), []);
  useEffect(() => settings.subscribe((s) => setShowAdultExtensions(!!s.showAdultExtensions)), []);
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState('');
  const [wheelZoom, setWheelZoom] = useState(0);
  const wheelZoomRef = useRef(0);
  const zoomContentRef = useRef(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const didDragRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [instantZoomReset, setInstantZoomReset] = useState(false);
  const zoomResetFrame = useRef(null);
  const verticalZoomAnchorRef = useRef(null);
  const [isRead, setIsRead] = useState(() => !!progress.get(chapterUrl, sourceId)?.read);
  const [verticalAtEnd, setVerticalAtEnd] = useState(false);
  const [lastSeen, setLastSeen] = useState(0);
  const pendingScrollRef = useRef(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const preloadedPagesRef = useRef(new Map());
  const [, setPreloadRevision] = useState(0);
  const areaRef = useRef(null);
  const verticalScrollerRef = useRef(null);

  const scalePct = Math.min(Math.max(settings.get().readerZoom, 20), 200) / 2;

  const toggleZoomAtPointer = (e) => {
    const stage = areaRef.current;
    const content = zoomContentRef.current;
    if (!stage || !content) return;
    e.preventDefault();
    dragRef.current = null;
    setDragging(false);

    const viewportWidth = stage.getBoundingClientRect().width;
    const returningToOriginal = wheelZoomRef.current >= 50;
    const bounds = pageBounds(stage);
    if (!viewportWidth || !bounds || bounds.right <= bounds.left) return;
    const targetScale = returningToOriginal ? 1 : Math.max(1.5, content.getBoundingClientRect().width / (bounds.right - bounds.left));
    const targetZoom = (targetScale - 1) * 100;
    const targetPan = targetZoom ? zoomPanAtPointer(stage, content, bounds, targetScale, e) : { x: 0, y: 0 };

    panRef.current = targetPan;
    setPan(targetPan);
    wheelZoomRef.current = targetZoom;
    setWheelZoom(targetZoom);
  };

  const toggleVerticalZoomAtPointer = (e) => {
    const image = e.target instanceof Element ? e.target.closest('img[alt^="Página "]') : null;
    if (!image) return;
    e.preventDefault();
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const parent = verticalScrollerRef.current;
    if (!parent) return;
    const anchor = {
      image,
      ratioX: (e.clientX - rect.left) / rect.width,
      ratioY: (e.clientY - rect.top) / rect.height,
      clientX: e.clientX,
      clientY: e.clientY,
      parent
    };
    verticalZoomAnchorRef.current = anchor;
    const nextZoom = wheelZoomRef.current > 0 ? 0 : 50;
    wheelZoomRef.current = nextZoom;
    setWheelZoom(nextZoom);
  };

  useLayoutEffect(() => {
    const anchor = verticalZoomAnchorRef.current;
    if (!anchor) return;
    verticalZoomAnchorRef.current = null;
    const rect = anchor.image.getBoundingClientRect();
    const cssZoom = anchor.parent.offsetWidth ? anchor.parent.getBoundingClientRect().width / anchor.parent.offsetWidth : 1;
    anchor.parent.scrollLeft += (rect.left + rect.width * anchor.ratioX - anchor.clientX) / cssZoom;
    anchor.parent.scrollTop += (rect.top + rect.height * anchor.ratioY - anchor.clientY) / cssZoom;
  }, [wheelZoom]);

  useEffect(() => () => {
    if (zoomResetFrame.current) cancelAnimationFrame(zoomResetFrame.current);
  }, []);

  useEffect(() => () => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }, []);

  const scrollToTop = () => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  };

  const retryChapterImages = useCallback(async () => {
    try {
      const refreshed = await api.chapter(chapterUrl, sourceId, { fresh: true });
      if (!refreshed?.pages?.length) return false;
      preloadedPagesRef.current.clear();
      setCh(refreshed);
      return true;
    } catch {
      return false;
    }
  }, [chapterUrl, sourceId]);

  useEffect(() => {
    if (!chapterUrl) return;
    let active = true;
    setErr('');
    wheelZoomRef.current = 0;
    setWheelZoom(0);
    panRef.current = { x: 0, y: 0 };
    setPan(panRef.current);
    dragRef.current = null;
    setDragging(false);
    setIsRead(!!progress.get(chapterUrl, sourceId)?.read);
    setLastSeen(0);
    setVerticalAtEnd(false);
    setCh(null);
    setChUrl('');
    preloadedPagesRef.current.clear();
    setPreloadRevision((revision) => revision + 1);
    pendingScrollRef.current = null;
    (async () => {
      try {
        let r = await api.chapter(chapterUrl, sourceId);
        if (!r?.pages?.length) r = await api.chapter(chapterUrl, sourceId, { fresh: true });
        if (!active) return;
        if (!r?.pages?.length) {
          setErr('El capítulo no devolvió páginas. La fuente puede estar bloqueando el acceso temporalmente.');
          return;
        }
        setCh(r);
        setChUrl(chapterUrl);
        const total = r.pages?.length || 1;
        const saved = progress.get(chapterUrl, sourceId);
        const sp0 = saved && !saved.read ? Math.min(Math.max(saved.page ?? 0, 0), total - 1) : 0;
        const sp = useDouble ? sp0 - (sp0 % 2) : sp0;
        setPage(sp);
        if (sp > 0) {
          pendingScrollRef.current = sp;
          setToast(`Continuando desde la página ${sp + 1}`);
        }
      } catch (e) {
        if (active) setErr(String(e));
      }
    })();
    scrollToTop();
    return () => { active = false; };
  }, [chapterUrl, sourceId, showAdultExtensions, retryTick]);

  const updateVerticalEnd = useCallback(() => {
    const mainEl = verticalScrollerRef.current;
    const lastPage = document.getElementById(`pg-${(ch?.pages?.length || 1) - 1}`);
    const lastImage = lastPage?.querySelector('img');
    setVerticalAtEnd(!!mainEl && !!lastImage?.naturalWidth
      && lastPage.getBoundingClientRect().bottom <= mainEl.getBoundingClientRect().bottom + 24);
  }, [ch]);

  useEffect(() => {
    const mainEl = verticalScrollerRef.current;
    if (!mainEl || !ch?.pages?.length || chUrl !== chapterUrl) return undefined;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        updateVerticalEnd();
        let best = 0;
        let bestTop = -Infinity;
        const line = mainEl.getBoundingClientRect().top;
        for (let i = 0; i < ch.pages.length; i++) {
          const el = document.getElementById(`pg-${i}`);
          if (!el || el.getBoundingClientRect().height <= 5) continue;
          const top = el.getBoundingClientRect().top;
          if (top <= line + 24 && top > bestTop) { bestTop = top; best = i; }
        }
        setLastSeen(best);
        setPage(best);
        progress.savePage(chapterUrl, sourceId, best, ch.pages.length);
      });
    };
    mainEl.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      mainEl.removeEventListener('scroll', onScroll);
    };
  }, [ch, chUrl, chapterUrl, sourceId, mode, updateVerticalEnd]);

  useEffect(() => {
    if (!ch || mode !== 'paginado' && mode !== 'paginado-rtl') return;
    if (chUrl !== chapterUrl) return;
    const lastDisplayed = useDouble ? Math.min(page + (page + 1 < ch.pages.length ? 1 : 0), ch.pages.length - 1) : page;
    setLastSeen(page);
    progress.savePage(chapterUrl, sourceId, lastDisplayed, ch.pages.length);
  }, [page, mode, ch, chUrl, chapterUrl, sourceId, useDouble]);

  useEffect(() => {
    if (!ch || isRead || chUrl !== chapterUrl) return;
    const total = ch.pages?.length || 0;
    if (!total) return;
    const lastDisplayed = (mode === 'paginado' || mode === 'paginado-rtl') && useDouble
      ? Math.min(page + (page + 1 < total ? 1 : 0), total - 1)
      : (mode === 'paginado' || mode === 'paginado-rtl' ? page : lastSeen);
    const done = mode === 'vertical' ? verticalAtEnd : lastDisplayed >= total - 1;
    if (done) {
      progress.markRead(chapterUrl, sourceId, total, mangaUrl);
      setIsRead(true);
      const manga = tracking.get(mangaUrl, sourceId);
      if (manga) {
        api.detail(mangaUrl, sourceId).then((d) => {
          if (d?.chapters) sync.pushChapter({ mangaUrl, sourceId, chapters: d.chapters });
        }).catch(() => {});
      }
    }
  }, [lastSeen, page, mode, verticalAtEnd, ch, chUrl, chapterUrl, sourceId, isRead, mangaUrl]);

  useEffect(() => {
    if (!ch || pendingScrollRef.current == null) return undefined;
    const target = pendingScrollRef.current;
    pendingScrollRef.current = null;
    if (mode !== 'vertical') return undefined;
    let cancelled = false;
    let ticks = 0;
    let lastH = -1;
    const tick = () => {
      if (cancelled || ticks > 8) return;
      ticks += 1;
      const el = document.getElementById(`pg-${target}`);
      const main = verticalScrollerRef.current;
      const top0 = main ? main.getBoundingClientRect().top : 0;
      const inPlace = el && Math.abs(el.getBoundingClientRect().top - top0) < 12;
      if (el && !inPlace) el.scrollIntoView({ block: 'start' });
      const h = main?.scrollHeight || 0;
      if (h !== lastH) {
        lastH = h;
        setTimeout(tick, 400);
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [ch, mode]);

  const pageSources = ch?.pages;
  const imageReferer = ch?.imageReferer;
  const imageCookie = ch?.imageCookie || '';
  useEffect(() => {
    if (!pageSources?.length || chUrl !== chapterUrl) return;
    const start = Math.min(Math.max(pageRef.current, 0), pageSources.length - 1);
    const orderedPages = [...pageSources.slice(start), ...pageSources.slice(0, start)];
    // Fetch the visible panel through the authenticated image path too. Some
    // sources return an HTML challenge to <img> requests even when the reader
    // API supplied a valid page URL.
    const queue = orderedPages.filter((src) => src && !preloadedPagesRef.current.has(src));
    if (!queue.length) return;
    let cancelled = false;
    let cursor = 0;
    const controllers = new Set();
    const load = async (src) => {
      let image = null;
      for (let attempt = 0; attempt < 2 && !cancelled; attempt += 1) {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          image = await fetchImage(src, controller.signal, imageReferer, imageCookie);
          if (image?.base64 && !cancelled) break;
          image = null;
        } catch {
          image = null;
        } finally {
          controllers.delete(controller);
        }
        if (!cancelled && attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (cancelled || !image?.base64) return;
      preloadedPagesRef.current.set(src, `data:${imageMimeFor(image.mime, src, image.base64)};base64,${image.base64}`);
      setPreloadRevision((revision) => revision + 1);
    };

    let active = 0;
    const pump = () => {
      while (!cancelled && active < 3 && cursor < queue.length) {
        const src = queue[cursor++];
        active += 1;
        load(src).finally(() => {
          active -= 1;
          pump();
        });
      }
    };
    pump();

    return () => {
      cancelled = true;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, [pageSources, imageReferer, imageCookie, chUrl, chapterUrl]);

  useEffect(() => {
    if (!currentMangaUrl || adultExtensionDisabled) return;
    let alive = true;
    api.detail(currentMangaUrl, sourceId).then((value) => {
      if (alive) setMangaDetail({ key: mangaKey, value });
    }).catch(() => {});
    return () => { alive = false; };
  }, [adultExtensionDisabled, currentMangaUrl, mangaKey, sourceId]);

  const goPage = (p) => {
    if (useDouble) p = p - (p % 2);
    if (p < 0) p = 0;
    if (p > ch.pages.length - 1) p = ch.pages.length - 1;
    setPage(p);
    if (p !== page) {
      setInstantZoomReset(true);
      if (zoomResetFrame.current) cancelAnimationFrame(zoomResetFrame.current);
      zoomResetFrame.current = requestAnimationFrame(() => {
        zoomResetFrame.current = requestAnimationFrame(() => {
          setInstantZoomReset(false);
          zoomResetFrame.current = null;
        });
      });
      wheelZoomRef.current = 0;
      setWheelZoom(0);
      panRef.current = { x: 0, y: 0 };
      setPan(panRef.current);
    }
    if (mode === 'vertical') {
      requestAnimationFrame(() => document.getElementById(`pg-${p}`)?.scrollIntoView({ block: 'start' }));
    } else {
      scrollToTop();
    }
  };

  useEffect(() => {
    const scrollable = (el) => {
      if (!(el instanceof Element)) return false;
      if (el.closest('[data-scrollable]')) return true;
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
    };
    const onWheel = (e) => {
      if (e.deltaY === 0) return;
      if (e.ctrlKey) {
        e.preventDefault();
        return;
      }
      const zoomable = mode === 'paginado' || mode === 'paginado-rtl';
      if (!zoomable) return;
      const stage = areaRef.current;
      const content = zoomContentRef.current;
      if (!stage || !content || !(e.target instanceof Element) || !stage.contains(e.target)) return;
      const zoomIn = e.deltaY < 0;
      const image = e.target.closest(pageImages);
      if (zoomIn) {
        if (scrollable(e.target)) return;
        if (!image) return;
      }
      const currentZoom = wheelZoomRef.current;
      const nextZoom = zoomIn
        ? Math.min(currentZoom + 10, Math.max(currentZoom, 150))
        : Math.max(currentZoom - 10, 0);
      if (nextZoom === currentZoom) return;
      const bounds = pageBounds(stage);
      if (!bounds) return;
      e.preventDefault();
      wheelZoomRef.current = nextZoom;
      panRef.current = nextZoom ? zoomPanAtPointer(stage, content, bounds, 1 + nextZoom / 100, e) : { x: 0, y: 0 };
      setPan(panRef.current);
      setWheelZoom(nextZoom);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [mode, ch]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const go = (url) => `#/leer?u=${encodeURIComponent(url)}&m=${encodeURIComponent(currentMangaUrl)}&s=${encodeURIComponent(sourceId)}${fromQS}${detailBackQS}`;

  const openPanelMenu = (e, url, label) => {
    e.preventDefault();
    if (!appWindow.canDownload()) return;
    setMenu({ x: e.clientX, y: e.clientY, url, label });
  };

  const downloadPanel = async () => {
    const target = menu;
    setMenu(null);
    if (!target?.url) return;
    const result = await appWindow.downloadImage(target.url, `${ch.label} - ${target.label}`);
    if (result?.ok) setToast('Panel descargado');
    else if (!result?.canceled) setToast(result?.error || 'No se pudo descargar');
  };

  const allPages = [...Array(ch?.pages?.length || 0).keys()];

  const chapterList = ch?.options?.length ? ch.options : detail?.chapters;
  const chapterOptions = chapterList?.length ? chapterList : [{ title: ch?.label || 'Capítulo', url: chapterUrl }];
  const oldestFirst = chapterOrder.get(mangaUrl);
  const orderedChapterOptions = chapterOptions
    .map((option, index) => ({ option, index, number: Number.parseFloat(String(option.title || '').match(/[\d.]+/)?.[0]) }))
    .sort((a, b) => {
      const aMissing = Number.isNaN(a.number);
      const bMissing = Number.isNaN(b.number);
      if (aMissing !== bMissing) return (aMissing ? 1 : -1) * (oldestFirst ? 1 : -1);
      if (!aMissing && a.number !== b.number) return (a.number - b.number) * (oldestFirst ? 1 : -1);
      return a.index - b.index;
    })
    .map(({ option }) => option);
  const exactChapterIndex = orderedChapterOptions.findIndex((option) => chapterUrlKey(option.url) === chapterUrlKey(chapterUrl));
  const currentChapterNumber = chapterNumberFrom(ch?.number ?? ch?.label);
  const chapterIndex = exactChapterIndex >= 0
    ? exactChapterIndex
    : orderedChapterOptions.findIndex((option) => {
      const optionNumber = chapterNumberFrom(option.title);
      return Number.isFinite(currentChapterNumber) && optionNumber === currentChapterNumber;
    });
  const selectedChapterUrl = chapterIndex >= 0 ? orderedChapterOptions[chapterIndex].url : chapterUrl;
  const olderChapterIndex = oldestFirst ? chapterIndex - 1 : chapterIndex + 1;
  const newerChapterIndex = oldestFirst ? chapterIndex + 1 : chapterIndex - 1;
  const previousOption = chapterIndex >= 0 ? orderedChapterOptions[olderChapterIndex] : null;
  const nextOption = chapterIndex >= 0 ? orderedChapterOptions[newerChapterIndex] : null;
  const chapterPositionUnknown = chapterIndex < 0 || !chapterList?.length;
  const previousChapter = chapterPositionUnknown || previousOption ? (ch?.prev?.url ? ch.prev : previousOption) : null;
  const nextChapter = chapterPositionUnknown || nextOption ? (ch?.next?.url ? ch.next : nextOption) : null;
  const navigateReading = (direction, allowChapterChange) => {
    const forward = rtl ? direction < 0 : direction > 0;
    const chapter = forward ? nextChapter : previousChapter;
    if (paginated) {
      const nextPage = page + (forward ? 1 : -1) * (useDouble ? 2 : 1);
      if (nextPage >= 0 && nextPage < ch.pages.length) {
        goPage(nextPage);
        return;
      }
    } else {
      const scroller = verticalScrollerRef.current;
      if (scroller && (forward ? !verticalAtEnd : scroller.scrollTop > 1)) {
        scroller.scrollBy({ top: direction * 600 });
        return;
      }
    }
    if (allowChapterChange && chapter?.url) window.location.hash = go(chapter.url);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || menu || document.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')) return;
      if (e.key === 'Escape' && chapterUrl) {
        e.preventDefault();
        goBack();
      }
      if (!ch || chUrl !== chapterUrl || err || adultExtensionDisabled) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateReading(e.key === 'ArrowRight' ? 1 : -1, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (adultExtensionDisabled) {
    return (
      <EmptyState
        face="（・_・）"
        tone="prompt"
        title="Extensión desactivada"
        description="Activa «Mostrar extensiones +18» en Ajustes > Extensiones para volver a usarla."
        action={<Button onClick={() => { window.location.hash = '#/ajustes'; }}>Ir a Ajustes</Button>}
      />
    );
  }
  if (!chapterUrl)
    return <EmptyState face="¯\\_(ツ)_/¯" title="Sin capítulo seleccionado." />;
  const chapterReady = !!ch && chUrl === chapterUrl && !err;
  const verticalZoom = 1 + wheelZoom / 100;
  const selectorStyle = { height: 'var(--reader-control-height)', gap: 4, paddingInline: '14px' };
  const selectorClass = 'rounded-xl bg-[color:var(--reader-control-bg)] font-medium tabular-nums hover:bg-[color:var(--reader-control-active)] aria-expanded:bg-[color:var(--reader-control-active)]';
  const selectorMenuClass = 'inset-x-0 top-full w-full rounded-xl shadow-lg';
  const chapterArrowClass = 'h-full w-7 shrink-0 rounded-none bg-[color:var(--reader-arrow-bg)] text-foreground transition-colors hover:bg-[color:var(--reader-control-hover)] disabled:opacity-30 focus-visible:z-10 focus-visible:ring-inset active:scale-100 sm:w-9';

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header
        className="relative z-20 grid shrink-0 grid-cols-1 items-center gap-x-3 gap-y-1 border-b border-border bg-card px-2 py-1 [--reader-control-height:2.5rem] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:px-3 md:[--reader-control-height:2.25rem]"
        style={{
          '--reader-control-bg': 'color-mix(in srgb, hsl(var(--secondary)), hsl(var(--card)) 25%)',
          '--reader-control-active': 'color-mix(in srgb, hsl(var(--secondary)), hsl(var(--primary)) 8%)',
          '--reader-arrow-bg': 'color-mix(in srgb, var(--reader-control-active), black 8%)',
          '--reader-control-hover': 'color-mix(in srgb, var(--reader-control-active), black 13%)',
        }}
      >
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-[var(--reader-control-height)] w-10 shrink-0 sm:w-9" title="Volver" aria-label="Volver" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="min-w-0 truncate font-display text-sm font-semibold tracking-tight" title={mangaTitle}>{mangaTitle}</h1>
        </div>

        <fieldset
          aria-label="Controles de lectura"
          disabled={!chapterReady}
          className="col-start-1 row-start-2 mx-auto grid w-full min-w-0 max-w-[33rem] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-1.5 disabled:opacity-60 min-[420px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1.55fr)_minmax(0,1fr)] md:col-start-2 md:row-start-1 md:w-[31rem] md:gap-2 lg:w-[33rem]"
        >
          <Dropdown
            className="col-span-2 min-[420px]:col-span-1"
            menuClassName={selectorMenuClass}
            buttonClassName={selectorClass}
            buttonStyle={selectorStyle}
            value={mode}
            onChange={(m) => {
              if (m === mode) return;
              if (m === 'vertical' || mode === 'vertical') {
                wheelZoomRef.current = 0;
                setWheelZoom(0);
                panRef.current = { x: 0, y: 0 };
                setPan(panRef.current);
              }
              if (m === 'vertical') pendingScrollRef.current = page;
              else if (doublePage) setPage(page - (page % 2));
              setMode(m);
              try {
                const map = JSON.parse(localStorage.getItem('cytlex:readerModeByManga') || '{}');
                map[currentMangaUrl] = m;
                localStorage.setItem('cytlex:readerModeByManga', JSON.stringify(map));
              } catch {}
            }}
            ariaLabel="Tipo de lectura"
            options={[
              { value: 'vertical', label: 'Vertical' },
              { value: 'paginado', label: 'Paginado (ID)' },
              { value: 'paginado-rtl', label: 'Paginado (DI)' }
            ]}
          />
          <div className="flex h-[var(--reader-control-height)] min-w-0 items-center rounded-xl border border-border bg-[color:var(--reader-control-bg)]">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(chapterArrowClass, 'rounded-l-xl border-r border-border/70')}
              title="Capítulo anterior"
              aria-label="Capítulo anterior"
              disabled={!previousChapter?.url}
              onClick={() => { if (previousChapter?.url) window.location.hash = go(previousChapter.url); }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Dropdown
              className="min-w-0 flex-1"
              menuClassName={selectorMenuClass}
              buttonClassName="rounded-none border-0 bg-transparent font-medium tabular-nums hover:bg-[color:var(--reader-control-active)] aria-expanded:bg-[color:var(--reader-control-active)] focus-visible:ring-inset"
              buttonStyle={{ ...selectorStyle, height: 'calc(var(--reader-control-height) - 2px)' }}
              value={selectedChapterUrl}
              onChange={(url) => { if (url !== selectedChapterUrl) window.location.hash = go(url); }}
              ariaLabel="Capítulo"
              options={orderedChapterOptions.map((o) => ({
                value: o.url,
                label: o.title,
                buttonLabel: o.title?.replace(/^Capítulo\s+/i, 'Cap. ')
              }))}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(chapterArrowClass, 'rounded-r-xl border-l border-border/70')}
              title="Capítulo siguiente"
              aria-label="Capítulo siguiente"
              disabled={!nextChapter?.url}
              onClick={() => { if (nextChapter?.url) window.location.hash = go(nextChapter.url); }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Dropdown
            menuClassName={selectorMenuClass}
            buttonClassName={selectorClass}
            buttonStyle={selectorStyle}
            value={page}
            placeholder="Página"
            onChange={goPage}
            ariaLabel="Página"
            options={allPages
              .filter((i) => !useDouble || i % 2 === 0)
              .map((i) => ({
                value: i,
                label: useDouble && i + 1 < allPages.length ? `Páginas ${i + 1}-${i + 2}` : `Página ${i + 1}`
              }))}
          />
        </fieldset>
      </header>

      {err ? (
        <EmptyState
          face="（╯°□°）╯︵ ┻━┻"
          tone="error"
          title="No se pudo cargar el capítulo"
          description={err}
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => { setErr(''); setRetryTick((t) => t + 1); }}>Reintentar</Button>
              <Button variant="secondary" onClick={goBack}>Volver al detalle</Button>
            </div>
          }
        />
      ) : !chapterReady ? (
        <div role="status" aria-label="Cargando capítulo" className="grid min-h-0 flex-1 place-items-center">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : mode === 'vertical' ? (
        <div ref={verticalScrollerRef} className="min-h-0 flex-1 overflow-auto overscroll-contain [overflow-anchor:none] md:p-3">
          <div
            className="mx-auto w-[var(--vertical-mobile-width)] md:w-[var(--vertical-desktop-width)]"
            onDoubleClick={toggleVerticalZoomAtPointer}
            style={{
              '--vertical-mobile-width': `${100 * verticalZoom}%`,
              '--vertical-desktop-width': `${scalePct * verticalZoom}%`,
            }}
          >
            {ch.pages.map((src, i) => (
              <ReaderPanel
                key={`${i}:${src}`}
                id={`pg-${i}`}
                src={src}
                displaySrc={preloadedPagesRef.current.get(src) || ''}
                fallbackSrc={ch.pageFallbacks?.[i]}
                onRetry={sourceId.startsWith('mangadex') || sourceId === 'onfmangas' ? retryChapterImages : undefined}
                alt={`Página ${i + 1}`}
                imageReferer={ch.imageReferer}
                imageCookie={ch.imageCookie}
                loading="lazy"
                onContextMenu={(e) => openPanelMenu(e, src, `Página ${i + 1}`)}
                onLoaded={() => {
                  if (i === ch.pages.length - 1) requestAnimationFrame(updateVerticalEnd);
                }}
                wrapperClassName="w-full md:mb-2.5"
                placeholderStyle={{ minHeight: px(120, scale, 100) }}
                imageClassName="w-full block mx-auto"
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={areaRef}
          className="relative min-h-0 w-full flex-1 touch-manipulation overflow-hidden"
          onClick={(e) => {
            if (didDragRef.current || menu) return;
            if (e.target instanceof Element && e.target.closest('button, a, [role="alert"]')) return;
            if (e.shiftKey) {
              if (e.target instanceof Element && e.target.closest(pageImages)) toggleZoomAtPointer(e);
              return;
            }
            const { left, width } = e.currentTarget.getBoundingClientRect();
            const direction = e.clientX < left + width / 2 ? -1 : 1;
            navigateReading(direction, false);
          }}
          onPointerDown={(e) => {
            didDragRef.current = false;
            if (wheelZoomRef.current <= 0 || e.pointerType !== 'mouse' || e.button !== 0 || e.shiftKey) return;
            if (!(e.target instanceof Element) || !e.target.closest(pageImages)) return;
            const content = zoomContentRef.current;
            if (content) {
              const style = getComputedStyle(content);
              const matrix = new DOMMatrixReadOnly(style.transform);
              const visibleZoom = Math.max(0, (matrix.a - 1) * 100);
              wheelZoomRef.current = visibleZoom;
              setWheelZoom(visibleZoom);
              panRef.current = { x: matrix.e, y: matrix.f };
              setPan(panRef.current);
            }
            dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, pan: panRef.current };
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            const stage = areaRef.current;
            const content = zoomContentRef.current;
            if (!drag || drag.pointerId !== e.pointerId || !stage || !content) return;
            if (!didDragRef.current && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
            didDragRef.current = true;
            const bounds = pageBounds(stage);
            if (!bounds || !stage.clientWidth) return;
            const viewport = stage.getBoundingClientRect();
            const cssZoom = viewport.width / stage.clientWidth;
            if (!cssZoom) return;
            const rendered = content.getBoundingClientRect();
            const currentX = (rendered.left + rendered.right - viewport.left - viewport.right) / 2;
            const currentY = (rendered.top + rendered.bottom - viewport.top - viewport.bottom) / 2;
            const deltaX = drag.pan.x * cssZoom + e.clientX - drag.x - currentX;
            const deltaY = drag.pan.y * cssZoom + e.clientY - drag.y - currentY;
            panRef.current = {
              x: (currentX + clampPagePan(deltaX, bounds.left, bounds.right, viewport.left, viewport.right)) / cssZoom,
              y: (currentY + clampPagePan(deltaY, bounds.top, bounds.bottom, viewport.top, viewport.bottom)) / cssZoom,
            };
            setPan(panRef.current);
          }}
          onPointerUp={(e) => {
            if (dragRef.current?.pointerId !== e.pointerId) return;
            dragRef.current = null;
            setDragging(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => { dragRef.current = null; setDragging(false); }}
        >
          <div
            ref={zoomContentRef}
            className="relative flex h-full w-full items-center justify-center"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${1 + wheelZoom / 100})`,
              transition: dragging || instantZoomReset ? 'none' : 'transform 140ms ease-out',
              willChange: wheelZoom ? 'transform' : 'auto'
            }}
          >
           {useDouble ? (
             <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden">
               {(() => {
                 const hasSecond = page + 1 < ch.pages.length;
                 const indices = hasSecond ? (rtl ? [page + 1, page] : [page, page + 1]) : [page];
                 return indices.map((idx) => {
                   const src = ch.pages[idx];
                   if (!src) return null;
                   return (
                     <ReaderPanel
                       key={`${idx}:${src}`}
                       src={src}
                       displaySrc={preloadedPagesRef.current.get(src) || ''}
                       fallbackSrc={ch.pageFallbacks?.[idx]}
                       onRetry={sourceId.startsWith('mangadex') || sourceId === 'onfmangas' ? retryChapterImages : undefined}
                       alt={`Página ${idx + 1}`}
                       imageReferer={ch.imageReferer}
                       imageCookie={ch.imageCookie}
                       onContextMenu={(e) => openPanelMenu(e, src, `Página ${idx + 1}`)}
                       wrapperClassName="grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] h-full min-h-0 min-w-0 flex-1"
                       imageClassName={cn('block h-full w-full object-contain', wheelZoom > 0 && (dragging ? 'cursor-grabbing' : 'cursor-grab'))}
                     />
                   );
                 });
               })()}
             </div>
           ) : (
              <ReaderPanel
                key={`${page}:${ch.pages[page]}`}
                src={ch.pages[page]}
                displaySrc={preloadedPagesRef.current.get(ch.pages[page]) || ''}
                fallbackSrc={ch.pageFallbacks?.[page]}
                onRetry={sourceId.startsWith('mangadex') || sourceId === 'onfmangas' ? retryChapterImages : undefined}
                alt={`Página ${page + 1}`}
                imageReferer={ch.imageReferer}
                imageCookie={ch.imageCookie}
                onContextMenu={(e) => openPanelMenu(e, ch.pages[page], `Página ${page + 1}`)}
                wrapperClassName="grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] h-full min-h-0 w-full"
                imageClassName={cn('block h-full w-full object-contain', wheelZoom > 0 && (dragging ? 'cursor-grabbing' : 'cursor-grab'))}
               />
           )}
          </div>
        </div>
      )}

       {menu && (
         <div
           className="fixed z-50"
          style={{
            left: Math.min(menu.x, window.innerWidth - Number.parseInt(px(196, scale, 160), 10)),
            top: Math.min(menu.y, window.innerHeight - Number.parseInt(px(56, scale, 46), 10))
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="rounded-lg border border-border bg-card p-1 shadow-2xl" style={{ minWidth: px(188, scale, 154) }}>
            <button
              type="button"
              onClick={downloadPanel}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Download className="w-4 h-4" />
              Descargar panel
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50 rounded-lg border border-border bg-card shadow-2xl"
          style={{
            bottom: px(16, scale, 11),
            paddingLeft: px(16, scale, 11),
            paddingRight: px(16, scale, 11),
            paddingTop: px(8, scale, 6),
            paddingBottom: px(8, scale, 6),
            fontSize: px(14, scale, 12)
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

