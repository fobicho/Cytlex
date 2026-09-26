import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, Sun, Moon, Maximize2, Minimize2, AlertTriangle, BookOpen, List } from 'lucide-react';
import { api } from '../lib/api.js';
import { settings } from '../lib/settings.js';
import { Button } from '../components/ui/button.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';

export default function Reader({ colorMode, isFullscreen, onToggleFullscreen }) {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const chapterUrl = params.get('u') || '';
  const mangaUrl = params.get('m') || '';
  const sourceId = params.get('s') || 'leercapitulo';
  const [ch, setCh] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(settings.get().readerMode);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(settings.get().readerZoom);
  const [bars, setBars] = useState(true);

  useEffect(() => {
    if (!chapterUrl) return;
    setCh(null);
    api
      .chapter(chapterUrl, sourceId)
      .then((r) => {
        setCh(r);
        setPage(0);
      })
      .catch((e) => setErr(String(e)));
    window.scrollTo(0, 0);
  }, [chapterUrl, sourceId]);

  useEffect(() => {
    const onKey = (e) => {
      if (!ch) return;
      if (e.key === 'ArrowRight') {
        mode === 'paginado' ? setPage((p) => Math.min(p + 1, ch.pages.length - 1)) : window.scrollBy({ top: 600 });
      }
      if (e.key === 'ArrowLeft') {
        mode === 'paginado' ? setPage((p) => Math.max(p - 1, 0)) : window.scrollBy({ top: -600 });
      }
      if (e.key === 'Escape' || e.key.toLowerCase() === 'h') setBars((b) => !b);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, ch]);

  if (!chapterUrl) return <EmptyState icon={BookOpen} title="Sin capítulo." />;
  if (err)
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No se pudo cargar el capítulo"
        description={err}
        action={
          <Button onClick={() => { window.location.hash = `#/manga?u=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}`; }}>
            Volver al detalle
          </Button>
        }
      />
    );
  if (!ch)
    return (
      <div className="max-w-[860px] mx-auto p-6">
        <Skeleton className="h-[420px] w-full rounded-2xl" />
        <p className="text-sm text-muted-foreground mt-3 text-center">Cargando capítulo…</p>
      </div>
    );

  const backHash = `#/manga?u=${encodeURIComponent(mangaUrl || ch.mangaUrl)}&s=${encodeURIComponent(sourceId)}`;
  const go = (url) => `#/leer?u=${encodeURIComponent(url)}&m=${encodeURIComponent(mangaUrl || ch.mangaUrl)}&s=${encodeURIComponent(sourceId)}`;

  const selectClass =
    'h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div
      className="max-w-[860px] mx-auto px-4 pt-3 pb-24 min-h-screen"
      onClick={(e) => {
        if (e.detail === 1 && e.target.tagName === 'IMG') setBars((b) => !b);
      }}
    >
      {bars && (
        <div className="sticky top-3 z-20 flex items-center gap-2 rounded-full border border-border bg-card/90 backdrop-blur-xl px-2 py-2 shadow-2xl">
          <Button variant="ghost" size="icon" className="rounded-full" title="Volver" aria-label="Volver" onClick={() => { window.location.hash = backHash; }}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="font-bold truncate max-w-[220px]">{ch.label}</span>
          <span className="rounded-full bg-black/70 text-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap">
            {mode === 'paginado' ? `${page + 1} / ${ch.pages.length}` : `${ch.pages.length} págs`}
          </span>
          <span className="flex-1" />
          <select
            className={selectClass}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            aria-label="Modo de lectura"
          >
            <option value="vertical">Vertical</option>
            <option value="paginado">Paginado</option>
          </select>
          <select
            className={selectClass}
            value=""
            onChange={(e) => { if (e.target.value) window.location.hash = go(e.target.value); }}
            aria-label="Ir a capítulo"
          >
            <option value="">Capítulos…</option>
            {ch.options.map((o, i) => (
              <option key={i} value={o.url}>{o.title}</option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            title="Modo claro/oscuro"
            aria-label="Cambiar modo claro/oscuro"
            onClick={() => settings.set({ mode: colorMode === 'dark' ? 'light' : 'dark' })}
          >
            {colorMode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            title="Pantalla completa (F11)"
            aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      )}

      <div className="h-3" />

      {mode === 'vertical' ? (
        <div style={{ width: `${Math.min(zoom, 140)}%`, maxWidth: 860, margin: '0 auto' }}>
          {ch.pages.map((src, i) => (
            <img
              key={i}
              loading="lazy"
              src={src}
              alt={`Página ${i + 1}`}
              referrerPolicy="no-referrer"
              className="w-full block mx-auto mb-2.5 rounded-xl bg-black shadow-sm"
            />
          ))}
        </div>
      ) : (
        <div className="text-center">
          <img
            src={ch.pages[page]}
            alt={`Página ${page + 1}`}
            referrerPolicy="no-referrer"
            className="block mx-auto mb-2.5 rounded-xl bg-black shadow-sm"
            style={{ width: `${Math.min(zoom, 140)}%` }}
          />
          <div className="flex justify-center gap-3 my-3">
            <Button variant="secondary" disabled={page <= 0} onClick={() => { setPage(page - 1); window.scrollTo(0, 0); }}>
              Anterior
            </Button>
            <Button variant="secondary" disabled={page >= ch.pages.length - 1} onClick={() => { setPage(page + 1); window.scrollTo(0, 0); }}>
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {bars && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-border bg-card/90 backdrop-blur-xl px-2 py-2 shadow-2xl max-w-[94vw]">
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Reducir" onClick={() => setZoom((z) => Math.max(50, z - 10))}>
            <Minus className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground min-w-[42px] text-center">{zoom}%</span>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Ampliar" onClick={() => setZoom((z) => Math.min(140, z + 10))}>
            <Plus className="w-4 h-4" />
          </Button>
          <span className="w-2" />
          {ch.prev ? (
            <Button variant="secondary" size="sm" onClick={() => { window.location.hash = go(ch.prev.url); }}>
              Anterior cap.
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground px-2">Primer cap.</span>
          )}
          {ch.next ? (
            <Button variant="secondary" size="sm" onClick={() => { window.location.hash = go(ch.next.url); }}>
              Siguiente cap.
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground px-2">Último cap.</span>
          )}
        </div>
      )}

      {!bars && (
        <p className="text-sm text-muted-foreground text-center">
          <List className="w-3.5 h-3.5 inline mr-1" />
          Toca la imagen o pulsa H para mostrar controles
        </p>
      )}
    </div>
  );
}
