import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, Maximize2, Minimize2, ChevronLeft, ChevronRight, Download, AlertTriangle, BookOpen, List, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { settings } from '../lib/settings.js';
import { progress } from '../lib/progress.js';
import { tracking } from '../lib/tracking.js';
import { sync } from '../lib/sync.js';
import { appWindow } from '../lib/appWindow.js';
import { Button } from '../components/ui/button.jsx';
import { Dropdown } from '../components/ui/dropdown.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';

export default function Reader({ isFullscreen, onToggleFullscreen }) {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const chapterUrl = params.get('u') || '';
  const mangaUrl = params.get('m') || '';
  const sourceId = params.get('s') || 'leercapitulo';
  const fromParam = params.get('from') || '';
  const fromQS = fromParam ? `&from=${encodeURIComponent(fromParam)}` : '';
  const [ch, setCh] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(settings.get().readerMode);
  const [page, setPage] = useState(0);
  const [bars, setBars] = useState(true);
  const [pgLoaded, setPgLoaded] = useState(false);
  const [nat, setNat] = useState(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState('');
  const [wheelZoom, setWheelZoom] = useState(0);
  const [isRead, setIsRead] = useState(() => !!progress.get(chapterUrl, sourceId)?.read);
  const preloadedRef = useRef(false);
  const pendingScrollRef = useRef(null);
  const sizesRef = useRef(new Map());
  const areaRef = useRef(null);

  // Ancho de página: el valor guardado se escala a la mitad (100% => 50%).
  const scalePct = Math.min(Math.max(settings.get().readerZoom, 20), 200) / 2;

  const remember = (src, img) => {
    if (src && img.naturalWidth) sizesRef.current.set(src, { w: img.naturalWidth, h: img.naturalHeight });
  };

  // El contenedor desplazable es <main>, no la ventana. Sin esto, cambiar de
  // capítulo deja el scroll donde estaba el anterior y abre por el final.
  const scrollToTop = () => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (!chapterUrl) return;
    setWheelZoom(0);
    setIsRead(!!progress.get(chapterUrl, sourceId)?.read);
    setCh(null);
    api
      .chapter(chapterUrl, sourceId)
      .then((r) => {
        setCh(r);
        const total = r.pages?.length || 1;
        const saved = progress.get(chapterUrl, sourceId);
        const sp = saved && !saved.read ? Math.min(Math.max(saved.page ?? 0, 0), total - 1) : 0;
        setPage(sp);
        if (sp > 0) {
          pendingScrollRef.current = sp;
          setToast(`Continuando desde la página ${sp + 1}`);
        }
      })
      .catch((e) => setErr(String(e)));
    scrollToTop();
  }, [chapterUrl, sourceId]);

  const [lastSeen, setLastSeen] = useState(0);
  const savedRef = useRef(chapterUrl);
  useEffect(() => {
    if (!ch || !ch.pages?.length) return undefined;
    const changed = savedRef.current !== chapterUrl;
    if (changed) {
      savedRef.current = chapterUrl;
      setLastSeen(0);
    }
    let raf = 0;
    // Cambiar de capítulo desde el lector deja el contenedor desplazado donde
    // estaba el anterior. Esa medición no es real, así que se espera a que el
    // scroll se asiente antes de empezar a guardar. Al abrir el capítulo por
    // primera vez no hay desplazamiento heredado y se guarda de inmediato.
    let settled = !changed;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (mode !== 'vertical') return;
        let best = 0;
        let bestTop = -Infinity;
        // La línea de lectura es el borde superior del <main>, no el de la
        // ventana: así cuenta la página aunque la barra de controles esté.
        const mainEl = document.querySelector('main');
        const line = mainEl ? mainEl.getBoundingClientRect().top : 0;
        for (let i = 0; i < ch.pages.length; i++) {
          const el = document.getElementById(`pg-${i}`);
          // Ignora paneles sin cargar (alto 0) para no atribuirlos como leídos.
          if (!el || el.getBoundingClientRect().height <= 5) continue;
          const top = el.getBoundingClientRect().top;
          if (top <= line + 24 && top > bestTop) { bestTop = top; best = i; }
        }
        if (!settled) return;
        setLastSeen(best);
        progress.savePage(chapterUrl, sourceId, best, ch.pages.length);
      });
    };
    const release = () => { settled = true; };
    const timer = setTimeout(release, 300);
    // capture: el contenedor de scroll es <main>, no window.
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    onScroll();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [ch, chapterUrl, sourceId, mode]);

  useEffect(() => {
    if (!ch || mode !== 'paginado') return;
    setLastSeen(page);
    progress.savePage(chapterUrl, sourceId, page, ch.pages.length);
  }, [page, mode, ch, chapterUrl, sourceId]);

  useEffect(() => {
    if (!ch || isRead) return;
    const total = ch.pages?.length || 0;
    if (!total) return;
    const done = mode === 'paginado' ? page >= total - 1 : lastSeen >= total - 1;
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
  }, [lastSeen, page, mode, ch, chapterUrl, sourceId, isRead, mangaUrl]);

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
    if (!ch) { preloadedRef.current = false; return; }
    if (preloadedRef.current) return;
    if (mode === 'paginado' && !pgLoaded) return;
    preloadedRef.current = true;
    ch.pages.slice(1).forEach((src) => {
      if (sizesRef.current.has(src)) return;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => remember(src, img);
      img.src = src;
    });
  }, [ch, pgLoaded, mode]);

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
    const onWheel = (e) => {
      if (e.deltaY === 0) return;
      const zoomable = mode === 'paginado' || e.ctrlKey;
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
      if (e.key === 'ArrowRight') {
        if (mode === 'paginado') goPage(Math.min(page + 1, ch.pages.length - 1));
        else window.scrollBy({ top: 600 });
      }
      if (e.key === 'ArrowLeft') {
        if (mode === 'paginado') goPage(Math.max(page - 1, 0));
        else window.scrollBy({ top: -600 });
      }
      if (e.key === 'Escape' || e.key.toLowerCase() === 'h') setBars((b) => !b);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, ch, page]);

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

  if (!chapterUrl) return <EmptyState icon={BookOpen} title="Sin capítulo." />;
  if (err)
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No se pudo cargar el capítulo"
        description={err}
        action={
          <Button onClick={() => { window.location.hash = `#/manga?u=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}${fromQS}`; }}>
            Volver al detalle
          </Button>
        }
      />
    );
  if (!ch)
    return (
      <div className="h-full grid place-items-center">
        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
      </div>
    );

  const backHash = `#/manga?u=${encodeURIComponent(mangaUrl || ch.mangaUrl)}&s=${encodeURIComponent(sourceId)}${fromQS}`;
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

  // Solo los paneles anchos (doble página, anuncios) se agrandan para llenar el alto; el resto usa el ancho del ajuste.
  const zoomPct = scalePct + (scalePct * wheelZoom) / 100;
  let pageStyle = { width: `${zoomPct}%`, maxHeight: 'calc(100vh - 60px)' };
  if (mode === 'paginado' && nat && area.w > 0 && nat.w > nat.h) {
    const aspect = nat.w / nat.h;
    const zoomW = (zoomPct / 100) * area.w;
    pageStyle = { width: `${Math.max(zoomW, area.h * aspect)}px`, maxWidth: '100%', maxHeight: '100%' };
  }

  return (
    <div
      className="h-full p-3"
      onClick={(e) => {
        if (e.detail === 1 && e.target.tagName === 'IMG') setBars((b) => !b);
      }}
    >
      {bars && (
        <div
          className={cn(
            'fixed left-3 z-20 flex items-center gap-1.5 rounded-xl border border-border bg-card/90 backdrop-blur-xl px-1.5 py-1 shadow-2xl max-w-[calc(100vw-1.5rem)]',
            isFullscreen ? 'top-3' : 'top-12'
          )}
        >
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg shrink-0" title="Volver" aria-label="Volver" onClick={() => { window.location.hash = backHash; }}>
            <ArrowLeft className="w-4 h-4" />
          </Button>

          <Dropdown
            className="w-[140px]"
            value={chapterUrl}
            onChange={(url) => { if (url !== chapterUrl) window.location.hash = go(url); }}
            ariaLabel="Capítulo"
            options={(ch.options.length ? ch.options : [{ title: ch.label, url: chapterUrl }]).map((o) => ({ value: o.url, label: o.title }))}
          />

          <Dropdown
            className="w-[112px]"
            value={page}
            onChange={goPage}
            ariaLabel="Página"
            options={allPages.map((i) => ({ value: i, label: `Página ${i + 1}` }))}
          />

          <Dropdown
            className="w-[116px]"
            value={mode}
            onChange={setMode}
            ariaLabel="Tipo de lectura"
            options={[
              { value: 'vertical', label: 'Vertical' },
              { value: 'paginado', label: 'Paginado' }
            ]}
          />

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg shrink-0"
            title="Pantalla completa (F11)"
            aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      )}

      {mode === 'vertical' ? (
        <div className="mx-auto" style={{ width: `${scalePct}%` }}>
          {ch.pages.map((src, i) => (
            <img
              key={i}
              id={`pg-${i}`}
              loading="lazy"
              src={src}
              alt={`Página ${i + 1}`}
              referrerPolicy="no-referrer"
              onContextMenu={(e) => openPanelMenu(e, src, `Página ${i + 1}`)}
              className="w-full block mx-auto mb-2.5"
            />
          ))}
        </div>
      ) : (
        <div ref={areaRef} className="relative h-full w-full overflow-hidden grid place-items-center">
          {!pgLoaded && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <img
            key={page}
            src={ch.pages[page]}
            alt={`Página ${page + 1}`}
            referrerPolicy="no-referrer"
            onContextMenu={(e) => openPanelMenu(e, ch.pages[page], `Página ${page + 1}`)}
            onLoad={(e) => {
              remember(ch.pages[page], e.currentTarget);
              if (e.currentTarget.naturalWidth) {
                setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
              }
              setPgLoaded(true);
            }}
            onError={() => setPgLoaded(true)}
            className={cn('block max-w-full object-contain transition-opacity duration-150', pgLoaded ? 'opacity-100' : 'opacity-0')}
            style={pageStyle}
          />
          {bars && (
            <>
              {page > 0 && (
                <button
                  type="button"
                  className={`${navBtn} left-3`}
                  aria-label="Página anterior"
                  onClick={(e) => { e.stopPropagation(); goPage(page - 1); }}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              {page < last && (
                <button
                  type="button"
                  className={`${navBtn} right-3`}
                  aria-label="Página siguiente"
                  onClick={(e) => { e.stopPropagation(); goPage(page + 1); }}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {!bars && (
        <p className="fixed bottom-3 left-3 z-20 text-xs text-muted-foreground">
          <List className="w-3.5 h-3.5 inline mr-1" />
          Toca la imagen o pulsa H para mostrar controles
        </p>
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
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
