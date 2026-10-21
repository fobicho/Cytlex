import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, Maximize2, Minimize2, ChevronLeft, ChevronRight, ChevronDown, Download, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { settings } from '../lib/settings.js';
import { progress } from '../lib/progress.js';
import { tracking } from '../lib/tracking.js';
import { detailScroll } from '../lib/searchState.js';
import { sync } from '../lib/sync.js';
import { appWindow } from '../lib/appWindow.js';
import { Button } from '../components/ui/button.jsx';
import { Dropdown } from '../components/ui/dropdown.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

function ReaderPanel({ id, src, alt, loading = 'eager', imageClassName, imageStyle, wrapperClassName, wrapperStyle, onContextMenu, onLoaded, onFailed }) {
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  return (
    <div id={id} className={cn('relative grid place-items-center', wrapperClassName)} style={wrapperStyle}>
      {status === 'loading' && (
        <div role="status" aria-label={`Cargando ${alt.toLowerCase()}`} className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      {status === 'error' && (
        <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/90 px-3 text-center text-sm text-muted-foreground">
          <span>No se pudo cargar {alt.toLowerCase()}.</span>
          <Button size="sm" variant="secondary" onClick={() => { setStatus('loading'); setAttempt((n) => n + 1); }}>
            Reintentar
          </Button>
        </div>
      )}
      <img
        key={attempt}
        src={src}
        alt={alt}
        loading={loading}
        referrerPolicy="no-referrer"
        onContextMenu={onContextMenu}
        onLoad={(e) => { setStatus('loaded'); onLoaded?.(e); }}
        onError={() => { setStatus('error'); onFailed?.(); }}
        className={cn(imageClassName, 'transition-opacity duration-150', status === 'loaded' ? 'opacity-100' : 'opacity-0')}
        style={imageStyle}
      />
    </div>
  );
}

export default function Reader({ isFullscreen, onToggleFullscreen }) {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const chapterUrl = params.get('u') || '';
  const mangaUrl = params.get('m') || '';
  const sourceId = params.get('s') || 'leercapitulo';
  const fromParam = params.get('from') || '';
  const fromQS = fromParam ? `&from=${encodeURIComponent(fromParam)}` : '';
  const [ch, setCh] = useState(null);
  const [chUrl, setChUrl] = useState('');
  const [err, setErr] = useState('');
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
  const [barsOpen, setBarsOpen] = useState(true);
  const [barsLeaving, setBarsLeaving] = useState(false);
  const scale = useScale();
  useEffect(() => settings.subscribe((s) => {
    try {
      const map = JSON.parse(localStorage.getItem('cytlex:readerModeByManga') || '{}');
      if (map[mangaUrl]) return; // per-manga override
    } catch {}
    setMode(s.readerMode);
  }), []);
  useEffect(() => settings.subscribe((s) => setDoublePage(!!s.readerDoublePage)), []);
  const barH = Number(px(32, scale, 27).replace('px', ''));
  const barPad = Number(px(4, scale, 3).replace('px', ''));
  const arrowH = Number(px(24, scale, 20).replace('px', ''));
  const titleH = isFullscreen ? 0 : 36;
  const barLeft = Number(px(12, scale, 8).replace('px', ''));
  const barTop = titleH + Number(px(10, scale, 8).replace('px', ''));
  const arrowLeft = barLeft + barPad;
  const arrowTop = barTop + barPad + barH / 2 - arrowH / 2;
  const barTimer = useRef(null);
  const hideTimer = useRef(null);
  const hovering = useRef(false);
  const [pgLoaded, setPgLoaded] = useState(false);
  const [nat, setNat] = useState(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState('');
  const [wheelZoom, setWheelZoom] = useState(0);
  const [isRead, setIsRead] = useState(() => !!progress.get(chapterUrl, sourceId)?.read);
  const pendingScrollRef = useRef(null);
  const sizesRef = useRef(new Map());
  const areaRef = useRef(null);

  const scalePct = Math.min(Math.max(settings.get().readerZoom, 20), 200) / 2;

  const showBar = useCallback(() => {
    clearTimeout(hideTimer.current);
    clearTimeout(barTimer.current);
    hovering.current = true;
    if (barsOpen) return;
    setBarsOpen(true);
    setBarsLeaving(false);
  }, [barsOpen]);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hovering.current = false;
    hideTimer.current = setTimeout(() => {
      setBarsLeaving(true);
      barTimer.current = setTimeout(() => {
        setBarsOpen(false);
        setBarsLeaving(false);
      }, 300);
    }, 700);
  }, []);

  useEffect(() => {
    hovering.current = false;
    barTimer.current = setTimeout(() => {
      if (hovering.current) return;
      setBarsLeaving(true);
      hideTimer.current = setTimeout(() => {
        setBarsOpen(false);
        setBarsLeaving(false);
      }, 300);
    }, 4000);
    return () => {
      clearTimeout(barTimer.current);
      clearTimeout(hideTimer.current);
    };
  }, [chapterUrl]);

  useEffect(() => () => {
    clearTimeout(barTimer.current);
    clearTimeout(hideTimer.current);
  }, []);

  useEffect(() => () => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }, []);

  const remember = (src, img) => {
    if (src && img.naturalWidth) sizesRef.current.set(src, { w: img.naturalWidth, h: img.naturalHeight });
  };

  const scrollToTop = () => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (!chapterUrl) return;
    let active = true;
    setErr('');
    setWheelZoom(0);
    setIsRead(!!progress.get(chapterUrl, sourceId)?.read);
    setPgLoaded(false);
    setNat(null);
    setCh(null);
    setChUrl('');
    pendingScrollRef.current = null;
    api
      .chapter(chapterUrl, sourceId)
      .then((r) => {
        if (!active) return;
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
      })
      .catch((e) => {
        if (active) setErr(String(e));
      });
    scrollToTop();
    return () => { active = false; };
  }, [chapterUrl, sourceId]);

  const [lastSeen, setLastSeen] = useState(0);
  useEffect(() => {
    if (!ch || !ch.pages?.length || chUrl !== chapterUrl) return undefined;
    let atTop = true;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (mode !== 'vertical') return;
        const mainEl = document.querySelector('main');
        if (!mainEl) return;
        if (!atTop) {
          if (mainEl.scrollTop > 4) return;
          atTop = true;
        }
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
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [ch, chUrl, chapterUrl, sourceId, mode]);

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
    const done = lastDisplayed >= total - 1;
    if (done) {
      progress.markRead(chapterUrl, sourceId, total);
      setIsRead(true);
      const manga = tracking.get(mangaUrl, sourceId);
      if (manga) {
        api.detail(mangaUrl, sourceId).then((d) => {
          if (d?.chapters) sync.pushChapter({ mangaUrl, sourceId, chapters: d.chapters });
        }).catch(() => {});
      }
    }
  }, [lastSeen, page, mode, ch, chUrl, chapterUrl, sourceId, isRead, mangaUrl]);

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
      const main = el?.closest('main');
      const top0 = main ? main.getBoundingClientRect().top : 0;
      const inPlace = el && Math.abs(el.getBoundingClientRect().top - top0) < 12;
      if (el && !inPlace) el.scrollIntoView({ block: 'start' });
      const h = (main ? main.scrollHeight : 0) + document.documentElement.scrollHeight;
      if (h !== lastH) {
        lastH = h;
        setTimeout(tick, 400);
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [ch, mode]);

  useEffect(() => {
    if (!ch || mode === 'vertical' || !pgLoaded) return;
    const step = useDouble ? 2 : 1;
    const nextStart = page + (rtl ? -step : step);
    const nextPages = useDouble
      ? (rtl ? [nextStart + 1, nextStart] : [nextStart, nextStart + 1])
      : [nextStart];
    nextPages.forEach((index) => {
      if (index < 0 || index >= ch.pages.length) return;
      const src = ch.pages[index];
      if (!src || sizesRef.current.has(src)) return;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => remember(src, img);
      img.src = src;
    });
  }, [ch, page, pgLoaded, mode, rtl, useDouble]);

  useEffect(() => {
    const src = ch?.pages?.[page] ?? '';
    setPgLoaded(sizesRef.current.has(src));
    setNat(sizesRef.current.get(src) ?? null);
  }, [page, ch]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return undefined;
    const update = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ch, mode]);

  useEffect(() => {
    if (!ch || (ch.options && ch.options.length)) return;
    let alive = true;
    api.detail(ch.mangaUrl || mangaUrl, sourceId).then((d) => {
      if (!alive || !d?.chapters?.length) return;
      setCh((cur) => (cur && !(cur.options && cur.options.length) ? { ...cur, options: d.chapters } : cur));
    }).catch(() => {});
    return () => { alive = false; };
  }, [ch, mangaUrl, sourceId]);

  const goPage = (p) => {
    if (useDouble) p = p - (p % 2);
    if (p < 0) p = 0;
    if (p > ch.pages.length - 1) p = ch.pages.length - 1;
    const src = ch.pages[p] ?? '';
    setPgLoaded(sizesRef.current.has(src));
    setNat(sizesRef.current.get(src) ?? null);
    setPage(p);
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
      if (scrollable(e.target)) return;
      const zoomable = mode === 'paginado' || mode === 'paginado-rtl' || e.ctrlKey;
      if (zoomable) e.preventDefault();
      else return;
      const fwd = e.deltaY > 0;
      setWheelZoom((z) => (fwd ? Math.min(z + 10, 150) : z <= 0 ? 0 : Math.max(z - 10, 0)));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [mode, ch]);

  useEffect(() => {
    const onKey = (e) => {
      if (!ch) return;
      const rtl = mode === 'paginado-rtl';
      const step = useDouble ? 2 : 1;
      const last = ch.pages.length - 1;
      if (e.key === 'ArrowRight') {
        if (mode === 'paginado' || mode === 'paginado-rtl') goPage(rtl ? Math.max(page - step, 0) : Math.min(page + step, last));
        else window.scrollBy({ top: 600 });
      }
      if (e.key === 'ArrowLeft') {
        if (mode === 'paginado' || mode === 'paginado-rtl') goPage(rtl ? Math.min(page + step, last) : Math.max(page - step, 0));
        else window.scrollBy({ top: -600 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, ch, page, useDouble]);

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

  const backHash = `#/manga?u=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}${fromQS}`;
  const goBack = () => {
    detailScroll.requestRestore();
    window.location.hash = backHash;
  };

  if (!chapterUrl)
    return <EmptyState face="¯\\_(ツ)_/¯" title="Sin capítulo seleccionado." />;
  if (err)
    return (
      <EmptyState
        face="（╯°□°）╯︵ ┻━┻"
        tone="error"
        title="No se pudo cargar el capítulo"
        description={err}
        action={<Button onClick={goBack}>Volver al detalle</Button>}
      />
    );
  if (!ch || chUrl !== chapterUrl)
    return (
      <div className="h-full grid place-items-center">
        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
      </div>
    );

  const go = (url) => `#/leer?u=${encodeURIComponent(url)}&m=${encodeURIComponent(mangaUrl || ch.mangaUrl)}&s=${encodeURIComponent(sourceId)}${fromQS}`;
  const last = ch.pages.length - 1;

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

  const navBtn =
    'fixed top-1/2 -translate-y-1/2 z-20 grid place-items-center w-11 h-11 rounded-lg border border-border bg-card/90 backdrop-blur-xl shadow-2xl text-foreground transition-colors hover:bg-accent';

  const allPages = [...Array(ch.pages.length).keys()];

  const nextChapter = (() => {
    const opts = ch?.options?.length ? ch.options : (ch ? [{ title: ch.label, url: chapterUrl }] : []);
    const idx = opts.findIndex((o) => o.url === chapterUrl);
    return idx >= 0 && idx < opts.length - 1 ? opts[idx + 1] : null;
  })();
  const atEnd = paginated
    ? page >= ch.pages.length - 1
    : (lastSeen >= (ch?.pages?.length || 1) - 1);
  const zoomPct = scalePct + (scalePct * wheelZoom) / 100;
  let pageStyle = { width: `${zoomPct}%`, maxHeight: 'calc(100vh - 60px)' };
  if ((mode === 'paginado' || mode === 'paginado-rtl') && nat && area.w > 0 && nat.w > nat.h) {
    const aspect = nat.w / nat.h;
    const zoomW = (zoomPct / 100) * area.w;
    pageStyle = { width: `${Math.max(zoomW, area.h * aspect)}px`, maxWidth: '100%', maxHeight: '100%' };
  }

  return (
    <div className="h-full min-h-0 p-3">
      {barsOpen ? (
            <div
              onMouseEnter={showBar}
              onMouseLeave={scheduleHide}
              className={cn(
                'fixed z-20 flex items-center rounded-xl border border-border bg-card/90 backdrop-blur-xl shadow-2xl w-max',
                barsLeaving ? 'animate-bars-out' : 'animate-bars-in'
              )}
              style={{
                top: `${barTop}px`,
                left: `${barLeft}px`,
                gap: px(6, scale, 4),
                padding: `${barPad}px`,
                boxSizing: 'border-box'
              }}
            >
              <Button
                variant="ghost"
                size="icon"
                className="rounded-lg shrink-0"
                title="Volver"
                aria-label="Volver"
                onClick={goBack}
                style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
              >
                <ArrowLeft style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
              </Button>

              <Dropdown
                scale={scale}
                style={{ width: px(140, scale, 92) }}
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  try {
                    const map = JSON.parse(localStorage.getItem('cytlex:readerModeByManga') || '{}');
                    map[mangaUrl] = m;
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

              <Dropdown
                scale={scale}
                style={{ width: px(135, scale, 88) }}
                value={chapterUrl}
                onChange={(url) => { if (url !== chapterUrl) window.location.hash = go(url); }}
                ariaLabel="Capítulo"
                options={[...(ch.options.length ? ch.options : [{ title: ch.label, url: chapterUrl }])]
                  .reverse()
                  .map((o) => ({ value: o.url, label: o.title }))}
              />

              <Dropdown
                scale={scale}
                style={{ width: px(145, scale, 95) }}
                value={page}
                onChange={goPage}
                ariaLabel="Página"
                 options={allPages
                   .filter((i) => !useDouble || i % 2 === 0)
                   .map((i) => {
                     const end = Math.min(i + 1, ch.pages.length - 1);
                     const label = useDouble && i + 1 < ch.pages.length
                       ? `Páginas ${i + 1}-${i + 2}`
                       : `Página ${i + 1}`;
                     return { value: i, label };
                   })}
              />

              <Button
                variant="ghost"
                size="icon"
                className="rounded-lg shrink-0"
                title="Pantalla completa (F11)"
                aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                onClick={onToggleFullscreen}
                style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
              >
                {isFullscreen ? (
                  <Minimize2 style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
                ) : (
                  <Maximize2 style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
                )}
              </Button>
            </div>
          ) : (
            <div
              onMouseEnter={showBar}
              onMouseLeave={scheduleHide}
              className="fixed z-20 grid place-items-center text-muted-foreground"
              style={{
                left: `${arrowLeft}px`,
                width: `${barH}px`,
                height: `${arrowH}px`,
                top: `${arrowTop}px`
              }}
              aria-hidden
            >
              <ChevronDown style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
            </div>
      )}

      {mode === 'vertical' ? (
        <div className="mx-auto" style={{ width: `${scalePct}%` }}>
          {ch.pages.map((src, i) => (
            <ReaderPanel
              key={i}
              id={`pg-${i}`}
              src={src}
              alt={`Página ${i + 1}`}
              loading="lazy"
              onContextMenu={(e) => openPanelMenu(e, src, `Página ${i + 1}`)}
              onLoaded={(e) => remember(src, e.currentTarget)}
              wrapperClassName="mb-2.5 w-full min-h-[120px]"
              imageClassName="w-full block mx-auto"
            />
          ))}
        </div>
      ) : (
        <div ref={areaRef} className="relative h-full min-h-0 w-full overflow-hidden grid grid-rows-[minmax(0,1fr)] place-items-center">
           {useDouble ? (
             <div className="flex min-h-0 items-center justify-center gap-2 h-full w-full overflow-hidden">
               {(() => {
                 const hasSecond = page + 1 < ch.pages.length;
                 const indices = hasSecond ? (rtl ? [page + 1, page] : [page, page + 1]) : [page];
                 return indices.map((idx) => {
                   const src = ch.pages[idx];
                   if (!src) return null;
                   return (
                     <ReaderPanel
                       key={idx}
                       src={src}
                       alt={`Página ${idx + 1}`}
                       onContextMenu={(e) => openPanelMenu(e, src, `Página ${idx + 1}`)}
                       onLoaded={(e) => {
                         remember(src, e.currentTarget);
                         if (idx === page) {
                           if (e.currentTarget.naturalWidth) setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                           setPgLoaded(true);
                         }
                       }}
                       onFailed={() => { if (idx === page) setPgLoaded(true); }}
                       wrapperClassName="grid-rows-[minmax(0,1fr)] h-full min-h-0 min-w-0 flex-1"
                       imageClassName="block object-contain max-w-full"
                       imageStyle={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
                     />
                   );
                 });
               })()}
             </div>
           ) : (
              <ReaderPanel
                key={page}
                src={ch.pages[page]}
                alt={`Página ${page + 1}`}
                onContextMenu={(e) => openPanelMenu(e, ch.pages[page], `Página ${page + 1}`)}
                onLoaded={(e) => {
                  remember(ch.pages[page], e.currentTarget);
                  if (e.currentTarget.naturalWidth) {
                    setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                  }
                  setPgLoaded(true);
                }}
                onFailed={() => setPgLoaded(true)}
                wrapperClassName="grid-rows-[minmax(0,1fr)] h-full min-h-0 w-full"
                imageClassName="block max-w-full object-contain"
                imageStyle={{ ...pageStyle, maxHeight: '100%', height: 'auto' }}
               />
            )}
           { (rtl ? (page + (useDouble ? 2 : 1) <= ch.pages.length - 1) : page > 0) && (
            <button
              type="button"
              className={`${navBtn} left-3`}
              aria-label="Página anterior"
              onClick={(e) => { e.stopPropagation(); goPage(rtl ? (useDouble ? Math.min(page + 2, ch.pages.length - 1) : page + 1) : (useDouble ? Math.max(page - 2, 0) : page - 1)); }}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
           { (rtl ? page > 0 : (page + (useDouble ? 2 : 1) <= ch.pages.length - 1)) && (
            <button
              type="button"
              className={`${navBtn} right-3`}
              aria-label="Página siguiente"
              onClick={(e) => { e.stopPropagation(); goPage(rtl ? (useDouble ? Math.max(page - 2, 0) : page - 1) : (useDouble ? Math.min(page + 2, ch.pages.length - 1) : page + 1)); }}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

       {nextChapter && atEnd && (
         <button
           type="button"
           className={`${navBtn} ${rtl ? 'left-3' : 'right-3'}`}
           style={{ top: 'auto', bottom: px(16, scale, 12), transform: 'none' }}
           title={`Siguiente capítulo: ${nextChapter.title}`}
           aria-label="Siguiente capítulo"
           onClick={() => {
             window.location.hash = `#/leer?u=${encodeURIComponent(nextChapter.url)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}${fromParam ? `&from=${encodeURIComponent(fromParam)}` : ''}`;
           }}
         >
           {rtl ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
         </button>
       )}

       {menu && (
         <div
           className="fixed z-50"
          style={{
            left: Math.min(menu.x, window.innerWidth - 196),
            top: Math.min(menu.y, window.innerHeight - 56)
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="min-w-[188px] rounded-lg border border-border bg-card p-1 shadow-2xl">
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

