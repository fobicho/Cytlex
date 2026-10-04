import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Star, ChevronDown, ArrowUp, ArrowDown, AlertTriangle, BookOpen, Check, CheckCheck, CheckCircle2, Puzzle, Link2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { lib } from '../lib/library.js';
import { progress } from '../lib/progress.js';
import { extensions } from '../lib/extensions.js';
import { makeCoverThumb } from '../lib/covers.js';
import { chapterOrder, detailScroll, recallCover } from '../lib/searchState.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { cn } from '../lib/utils.js';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { Dialog } from '../components/ui/dialog.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import AniListPanel from '../components/AniListPanel.jsx';
import { tracking } from '../lib/tracking.js';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function sameImage(a, b) {
  if (!a || !b) return false;
  try {
    const key = (u) => {
      const x = new URL(u);
      for (const k of [...x.searchParams.keys()]) {
        if (/^(w|width|size|h|height|quality|q|v|ver)$/i.test(k)) x.searchParams.delete(k);
      }
      x.pathname = x.pathname.replace(/-[a-z]{1,3}\.(jpe?g|png|webp|avif|gif)$/i, '.$1');
      return x.toString();
    };
    return key(a) === key(b);
  } catch {
    return a === b;
  }
}

const EXPAND_CTRL_H = 16;

function SourceLine({ sourceId }) {
  const m = extensions.manifest(sourceId);
  const [ok, setOk] = useState(true);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="w-4 h-4 rounded bg-secondary text-secondary-foreground grid place-items-center overflow-hidden shrink-0">
        {m.icon && ok ? (
          <img src={m.icon} alt="" className="w-full h-full object-cover" onError={() => setOk(false)} />
        ) : (
          <span className="text-[9px] font-bold">{(m.name?.[0] || '?').toUpperCase()}</span>
        )}
      </span>
      {m.name}
    </span>
  );
}

function DuplicateRow({ cover, title, author, sourceId }) {
  return (
    <div className="flex items-end gap-4 py-4 border-b border-border">
      {cover ? (
        <img src={cover} alt="" referrerPolicy="no-referrer" className="w-32 aspect-[5/7] object-cover rounded-xl shrink-0 bg-black" />
      ) : (
        <div className="w-32 aspect-[5/7] rounded-xl shrink-0 bg-secondary" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-lg leading-snug line-clamp-2">{title}</div>
        {author && <div className="mt-2 text-xs text-muted-foreground truncate">{author}</div>}
        <div className="mt-1">
          <SourceLine sourceId={sourceId} />
        </div>
      </div>
    </div>
  );
}

function useQueryUrl() {
  const loc = useLocation();
  return new URLSearchParams(loc.search).get('u') || '';
}

function useSourceId() {
  const loc = useLocation();
  return new URLSearchParams(loc.search).get('s') || 'leercapitulo';
}

function useBackTo() {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const from = params.get('from');
  if (from === 'resultados') return `/resultados?s=${encodeURIComponent(params.get('s') || 'leercapitulo')}`;
  return from === 'explorar' ? '/explorar' : '/biblioteca';
}

export default function Detail() {
  const navigate = useNavigate();
  const loc = useLocation();
  const mangaUrl = useQueryUrl();
  const sourceId = useSourceId();
  const backTo = useBackTo();
  const fromParam = new URLSearchParams(loc.search).get('from') || 'biblioteca';
  const sourceAvailable = extensions.isInstalled(sourceId);
  const [d, setD] = useState(() => api.peekDetail(mangaUrl, sourceId));
  const [err, setErr] = useState('');
  const [fav, setFav] = useState(false);
  const [asc, setAsc] = useState(() => chapterOrder.get(mangaUrl));
  const [dup, setDup] = useState(null);
  const [catPick, setCatPick] = useState(null);
  const catMenuRef = useRef(null);
  const coverRef = useRef(null);
  const synRef = useRef(null);
  const [availH, setAvailH] = useState(0);
  const [fullH, setFullH] = useState(0);
  const [ready, setReady] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [progressTick, setProgressTick] = useState(0);
  const [markBefore, setMarkBefore] = useState(null);
  const [aniListOpen, setAniListOpen] = useState(false);
  const [aniLinked, setAniLinked] = useState(() => !!tracking.get(mangaUrl, sourceId));
  const knownCover = useMemo(() => {
    const fav = lib.fav(mangaUrl, sourceId);
    const local = fav?.coverLocal;
    if (typeof local === 'string' && local.startsWith('data:')) return local;
    return (
      fav?.cover || tracking.get(mangaUrl, sourceId)?.cover || recallCover(mangaUrl) || ''
    );
  }, [mangaUrl, sourceId, progressTick]);

  const coverSrc = useMemo(() => {
    const local = lib.fav(mangaUrl, sourceId)?.coverLocal;
    if (typeof local === 'string' && local.startsWith('data:')) return local;
    if (!d?.cover) return knownCover;
    if (knownCover && sameImage(knownCover, d.cover)) return knownCover;
    return d.cover;
  }, [d?.cover, knownCover, mangaUrl, sourceId]);

  const coverImg = (alt) => (
    <img
      className="w-full h-full object-cover"
      src={coverSrc}
      alt={alt}
      referrerPolicy="no-referrer"
    />
  );

  useEffect(() => progress.subscribe(() => setProgressTick((t) => t + 1)), []);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return undefined;

    const saved = detailScroll.takeRestore(mangaUrl);
    let restoring = saved > 0;
    const apply = () => {
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
      if (ticks > 8) { restoring = false; return; }
      ticks += 1;
      const h = main.scrollHeight;
      if (h === lastH) { restoring = false; return; }
      lastH = h;
      apply();
      settleTimer = setTimeout(settle, 120);
    };
    settleTimer = setTimeout(settle, 120);

    const save = () => { if (!restoring) detailScroll.set(mangaUrl, main.scrollTop); };
    main.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(settleTimer);
      cover?.removeEventListener('load', apply);
      main.removeEventListener('scroll', save);
    };
  }, [mangaUrl, d?.chapters?.length]);
  useEffect(
    () => tracking.subscribe(() => setAniLinked(!!tracking.get(mangaUrl, sourceId))),
    [mangaUrl, sourceId]
  );

  useEffect(() => {
    if (!mangaUrl) return undefined;
    if (!extensions.isInstalled(sourceId)) return undefined;
    setErr('');
    setExpanded(false);
    setReady(false);
    setAnimate(false);
    setAsc(chapterOrder.get(mangaUrl));
    setFav(!!lib.fav(mangaUrl, sourceId));
    setAniLinked(!!tracking.get(mangaUrl, sourceId));

    const cached = api.peekDetail(mangaUrl, sourceId);
    if (cached) setD(cached);
    else setD(null);

    let alive = true;
    api
      .detail(mangaUrl, sourceId)
      .then((r) => { if (alive) setD(r); })
      .catch((e) => { if (alive) setErr(String(e)); });

    return () => { alive = false; };
  }, [mangaUrl, sourceId]);

  useLayoutEffect(() => {
    const cover = coverRef.current;
    const syn = synRef.current;
    if (!cover || !syn) return undefined;

    const update = () => {
      const c = cover.getBoundingClientRect();
      const s = syn.getBoundingClientRect();
      const avail = Math.max(80, c.bottom - s.top - EXPAND_CTRL_H);
      setAvailH(avail);
      setFullH(syn.scrollHeight);
      setOverflow(syn.scrollHeight > avail + 4);
      setReady(true);
    };

    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
    };
  }, [d]);

  useEffect(() => {
    if (!synRef.current) return;
    setFullH(synRef.current.scrollHeight);
  }, [d, expanded]);

  useEffect(() => {
    if (!ready || animate) return undefined;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [ready, animate]);

  const addToLibrary = (manga, catIds) => {
    lib.toggleFav(manga, catIds);
    setFav(true);
    makeCoverThumb(manga.cover).then((local) => {
      if (local) lib.updateFav(manga.url, { coverLocal: local }, manga.sourceId);
    });
  };

  const openCatMenu = (manga) => {
    const allCats = lib.cats();
    setCatPick({ list: allCats, selected: allCats[0] ? [allCats[0].id] : [], pending: manga, inline: true });
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

  const onAddClick = () => {
    const manga = {
      url: mangaUrl,
      title: d.title,
      cover: d.cover,
      type: d.facts.tipo,
      author: d.facts.autor,
      sourceId
    };
    const key = norm(d.title);
    const duplicates = lib
      .favs()
      .filter((f) => norm(f.title) === key && !lib.isFav(mangaUrl, sourceId));
    if (duplicates.length) setDup({ list: duplicates, pending: manga });
    else openCatMenu(manga);
  };

  useEffect(() => {
    if (!d?.chapters?.length) return;
    chapterIndex.set(mangaUrl, sourceId, d.chapters.map((c) => c.url));
  }, [mangaUrl, sourceId, d]);

  if (!mangaUrl)
    return <EmptyState face="¯\\_(ツ)_/¯" title="Sin manga seleccionado." />;
  if (!sourceAvailable)
    return (
      <EmptyState
        face="（ノಠ益ಠ）ノ"
        tone="prompt"
        title="Fuente no instalada"
        description="La extensión de este manga ya no está instalada. Vuelve a instalarla para poder abrirlo."
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
          className="-mt-2 -ml-2 mb-1 self-start hover:bg-transparent hover:text-foreground"
          onClick={() => navigate(backTo)}
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Volver
        </Button>

        <div className="flex flex-col md:flex-row gap-6">
          {knownCover ? (
            <div className="w-40 md:w-[184px] aspect-[2/3] overflow-hidden rounded-xl shrink-0 self-start bg-muted/50">
              {coverImg('')}
            </div>
          ) : (
            <Skeleton className="w-40 md:w-[184px] aspect-[2/3] rounded-xl shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <Skeleton className="h-8 md:h-9 w-2/3 max-w-md" />
            <Skeleton className="h-5 w-40 mt-1" />
            <Skeleton className="h-4 w-full max-w-lg mt-1" />
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <div className="flex flex-col gap-2 mt-3">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          </div>
        </div>
      </div>
    );

  let chapters = d.chapters;
  if (asc) chapters = [...chapters].reverse();
  const firstChapter = d.chapters[0]?.url;

  const inProgress = d.chapters
    .map((c) => ({ ...c, cap: progress.get(c.url, sourceId) }))
    .filter((c) => c.cap && !c.cap.read && Number.isInteger(c.cap.page))
    .sort((a, b) => (b.cap.updatedAt || 0) - (a.cap.updatedAt || 0))[0] || null;
  const continueChapter = inProgress;

  return (
    <div className="min-h-full flex flex-col">
      <Button
        variant="ghost"
        size="sm"
        className="-mt-2 -ml-2 mb-1 self-start hover:bg-transparent hover:text-foreground"
        onClick={() => navigate(backTo)}
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" /> Volver
      </Button>

      <div className="flex flex-col md:flex-row gap-6">
        <div
          ref={coverRef}
          className="w-40 md:w-[184px] aspect-[2/3] overflow-hidden rounded-xl shrink-0 self-start bg-muted/50"
        >
          {coverSrc ? (
            coverImg(d.title)
          ) : (
            <div className="w-full h-full animate-pulse bg-muted/40" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">{d.title}</h1>
          {d.facts.autor && <div className="text-base text-muted-foreground mt-1">Por {d.facts.autor}</div>}
          <div className="text-sm text-muted-foreground mt-1">{d.altTitles?.slice(0, 160)}</div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            {(d.facts.estado || d.facts.status) && (
              <Badge>{d.facts.estado || d.facts.status}</Badge>
            )}
            {d.facts.tipo && <Badge>{d.facts.tipo}</Badge>}
            {d.genres.slice(0, 6).map((g) => (
              <Badge key={g} variant="outline">
                {g}
              </Badge>
            ))}
          </div>

          <div className="mt-3">
            <div
              ref={synRef}
              style={{
                maxHeight: expanded ? (fullH || undefined) : (overflow ? availH : undefined),
                overflow: 'hidden',
                transition: animate ? 'max-height 320ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                WebkitMaskImage: !expanded && overflow
                  ? 'linear-gradient(to bottom, #000 calc(100% - 48px), rgba(0,0,0,0.55) calc(100% - 22px), transparent 100%)'
                  : undefined,
                maskImage: !expanded && overflow
                  ? 'linear-gradient(to bottom, #000 calc(100% - 48px), rgba(0,0,0,0.55) calc(100% - 22px), transparent 100%)'
                  : undefined
              }}
              className="relative text-sm text-muted-foreground leading-relaxed"
            >
              <p>{d.sinopsis}</p>
              {!expanded && overflow && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-12 backdrop-blur-[3px]"
                  style={{
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
                  onClick={() => setExpanded((v) => !v)}
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

      <div className="flex flex-wrap items-center gap-3 mt-6 border-t border-border pt-5">
        {continueChapter ? (
          <Button
            className="shadow-lg shadow-primary/30"
            onClick={() => {
              window.location.hash = `#/leer?u=${encodeURIComponent(continueChapter.url)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}&from=${fromParam}`;
            }}
          >
            <BookOpen className="w-4 h-4 mr-2" />
            Continuar {continueChapter.title}
            <span className="opacity-70 ml-2">
              · {continueChapter.cap.page + 1}/{continueChapter.cap.total || '?'}
            </span>
          </Button>
        ) : (
          firstChapter && (
            <Button
              className="shadow-lg shadow-primary/30"
              onClick={() => {
                window.location.hash = `#/leer?u=${encodeURIComponent(firstChapter)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}&from=${fromParam}`;
              }}
            >
              <Play className="w-4 h-4 mr-2" />
              Leer {d.chapters[0]?.title || ''}
            </Button>
          )
        )}
        <div className="relative" ref={catMenuRef}>
          <Button
            variant="secondary"
            aria-expanded={!!catPick?.inline}
            onClick={() => {
              if (fav) {
                lib.toggleFav({ url: mangaUrl, sourceId });
                setFav(false);
                return;
              }
              if (catPick?.inline) {
                setCatPick(null);
                return;
              }
              onAddClick();
            }}
          >
            <Star className={`w-4 h-4 mr-2 ${fav ? 'fill-current text-amber-400' : ''}`} />
            {fav ? 'En biblioteca' : 'Añadir'}
            {!fav && <ChevronDown className={cn('w-3.5 h-3.5 ml-2 transition-transform duration-200', catPick?.inline && 'rotate-180')} />}
          </Button>

          {catPick?.inline && (
            <div className="absolute left-0 top-full z-40 mt-2 rounded-xl border border-border bg-card p-3 shadow-2xl">
              <div className="flex flex-wrap gap-1.5 w-max max-w-96">
                {catPick.list.map((c) => {
                  const on = catPick.selected.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setCatPick((p) => ({
                          ...p,
                          selected: on ? p.selected.filter((x) => x !== c.id) : [...p.selected, c.id]
                        }))
                      }
                      className={cn(
                        'rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                        on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    addToLibrary(catPick.pending, catPick.selected);
                    setCatPick(null);
                  }}
                >
                  Añadir
                </Button>
              </div>
            </div>
          )}
        </div>
        <Button variant="secondary" onClick={() => setAniListOpen(true)} title="Vincular con AniList">
          <Link2 className={`w-4 h-4 mr-2 ${aniLinked ? 'text-primary' : ''}`} />
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

      <div className="mt-6 border-t border-border pt-3">
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setAsc((v) => { chapterOrder.set(mangaUrl, !v); return !v; })}
            title={asc ? 'Orden: más antiguos primero' : 'Orden: más recientes primero'}
            aria-label={asc ? 'Cambiar a más recientes primero' : 'Cambiar a más antiguos primero'}
            className="grid place-items-center w-8 h-8 rounded-lg text-foreground"
          >
            <span className="relative grid place-items-center w-4 h-4">
              <ArrowUp
                className={cn(
                  'col-start-1 row-start-1 w-4 h-4 transition-all duration-200',
                  asc ? 'opacity-0 -rotate-90' : 'opacity-100 rotate-0'
                )}
              />
              <ArrowDown
                className={cn(
                  'col-start-1 row-start-1 w-4 h-4 transition-all duration-200',
                  asc ? 'opacity-100 rotate-0' : 'opacity-0 rotate-90'
                )}
              />
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {chapters.map((c, i) => {
          const cap = progress.get(c.url, sourceId);
          const read = !!cap?.read;
          const inCourse = !read && cap && Number.isInteger(cap?.page) && cap.page > 0;
          return (
            <a
              key={i}
              className={cn(
                'group relative flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5 min-h-[52px] hover:bg-accent/50 transition-colors',
                read && 'opacity-45 hover:opacity-70'
              )}
              href={`#/leer?u=${encodeURIComponent(c.url)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}&from=${fromParam}`}
            >
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{c.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.date}
                  {inCourse && Number.isInteger(cap.total) && cap.total > 0
                    ? ` · en página ${cap.page + 1} de ${cap.total}`
                    : ''}
                </span>
              </span>
              {read ? (
                <span
                  role="button"
                  tabIndex={0}
                  title="Marcar como no leído"
                  aria-label={`Marcar ${c.title} como no leído`}
                  className="shrink-0 flex items-center gap-1 text-xs text-primary rounded-md hover:bg-accent"
                  onClick={(e) => { e.preventDefault(); progress.markUnread(c.url, sourceId); setProgressTick((t) => t + 1); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); progress.markUnread(c.url, sourceId); setProgressTick((t) => t + 1); }
                  }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Leído
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    title="Marcar todos los anteriores como leídos"
                    aria-label={`Marcar anteriores a ${c.title} como leídos`}
                    className="shrink-0 flex items-center rounded-md text-muted-foreground/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-foreground transition-opacity"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMarkBefore({ chapter: c, index: i }); }}
                  >
                    <CheckCheck className="w-4 h-4" />
                    <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                  </button>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Marcar como leído"
                    aria-label={`Marcar ${c.title} como leído`}
                    className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded-md hover:bg-accent hover:text-foreground transition-opacity"
                    onClick={(e) => { e.preventDefault(); progress.markRead(c.url, sourceId, cap?.total || 0); setProgressTick((t) => t + 1); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); progress.markRead(c.url, sourceId, cap?.total || 0); setProgressTick((t) => t + 1); }
                    }}
                  >
                    <Check className="w-4 h-4" />
                    Leído
                  </span>
                </>
              )}
            </a>
          );
        })}
      </div>

      <Dialog
        open={!!dup}
        onClose={() => setDup(null)}
        title="Posible duplicado"
        description="Ya tienes un manga con este título en la biblioteca."
      >
        {dup && (
          <>
            <div>
              {dup.list.map((f, i) => (
                <DuplicateRow key={i} cover={f.cover} title={f.title} author={f.author} sourceId={f.sourceId} />
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-5">
              <Button variant="secondary" onClick={() => setDup(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  const manga = dup.pending;
                  setDup(null);
                  openCatMenu(manga);
                }}
              >
                Añadir de todos modos
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={!!markBefore}
        onClose={() => setMarkBefore(null)}
        title="Marcar anteriores como leídos"
        hideDivider
        bodyClassName="pb-4"
        description={
          markBefore
            ? `Se marcarán como leídos todos los capítulos anteriores al ${markBefore.chapter.title}, ¿desea continuar?`
            : ''
        }
      >
        {markBefore && (() => {
          const below = chapters.slice(markBefore.index + 1);
          const pending = below.filter((x) => !progress.get(x.url, sourceId)?.read);
          return (
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setMarkBefore(null)}>
                Cancelar
              </Button>
              <Button
                disabled={!pending.length}
                onClick={() => {
                  setMarkBefore(null);
                  if (!pending.length) return;
                  progress.markMany(pending.map((x) => x.url), sourceId);
                  setProgressTick((t) => t + 1);
                }}
              >
                Marcar
              </Button>
            </div>
          );
        })()}
      </Dialog>
    </div>
  );
}

