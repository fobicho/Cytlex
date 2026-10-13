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
import { useScale, px } from '../lib/useScale.js';
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
const COVER_BASE = 184;

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
  const [animate, setAnimate] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [progressTick, setProgressTick] = useState(0);
  const [markBefore, setMarkBefore] = useState(null);
  const [aniListOpen, setAniListOpen] = useState(false);
  const [aniLinked, setAniLinked] = useState(() => !!tracking.get(mangaUrl, sourceId));
  const scale = useScale();
  const coverSize = Math.round(COVER_BASE * scale);
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
      const avail = Math.max(0, c.bottom - s.top - EXPAND_CTRL_H);
      setFullH(syn.scrollHeight);
      setAvailH(avail);
      setOverflow(syn.scrollHeight > avail + 4);
    };

    update();
    const raf = requestAnimationFrame(update);
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
      window.removeEventListener('resize', update);
    };
  }, [d, scale]);

  useEffect(() => {
    if (!synRef.current) return;
    setFullH(synRef.current.scrollHeight);
  }, [d, expanded]);

  useEffect(() => {
    if (animate) return undefined;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [animate]);

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
          style={{ gap: px(24, scale, 19) }}
        >
          {knownCover ? (
            <div
              className="aspect-[2/3] overflow-hidden rounded-xl shrink-0 self-start bg-muted/50"
              style={{ width: `${coverSize}px` }}
            >
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

  let chapters = d.chapters;
  if (asc) chapters = [...chapters].reverse();

  const ordered = [...d.chapters].reverse();

  const pendiente = ordered.find((c) => !progress.get(c.url, sourceId)?.read) || null;
  const cap = pendiente ? progress.get(pendiente.url, sourceId) : null;
  const enMarcha = !!(cap && !cap.read && Number.isInteger(cap.page));
  const resume = pendiente ? { ...pendiente, cap } : null;

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
        style={{ gap: px(24, scale, 19) }}
      >
        <div
          ref={coverRef}
          className="aspect-[2/3] overflow-hidden rounded-xl shrink-0 self-start bg-muted/50"
          style={{ width: `${coverSize}px` }}
        >
          {coverSrc ? (
            coverImg(d.title)
          ) : (
            <div className="w-full h-full animate-pulse bg-muted/40" />
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

          <div style={{ marginTop: px(12, scale, 9) }}>
            <div
              ref={synRef}
              style={{
                maxHeight: expanded ? (fullH || undefined) : (overflow ? availH : undefined),
                overflow: 'hidden',
                transition: animate ? 'max-height 320ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                WebkitMaskImage: synMask,
                maskImage: synMask,
                fontSize: `${Math.round(15 * scale)}px`
              }}
              className="relative text-muted-foreground leading-relaxed"
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

      <div
        className="flex flex-wrap items-center border-t border-border"
        style={{ gap: px(12, scale, 8), marginTop: px(24, scale, 16), paddingTop: px(20, scale, 14) }}
      >
        {resume ? (
          <Button
            className="shadow-lg shadow-primary/30"
            onClick={() => {
              window.location.hash = `#/leer?u=${encodeURIComponent(resume.url)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}&from=${fromParam}`;
            }}
            style={{
              height: px(40, scale, 33),
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
            style={{
              height: px(40, scale, 33),
              paddingLeft: px(16, scale, 13),
              paddingRight: px(16, scale, 13),
              fontSize: px(14, scale, 12)
            }}
          >
            <Star
              className={cn('mr-2 shrink-0', fav && 'fill-current text-amber-400')}
              style={{ width: px(16, scale, 14), height: px(16, scale, 14) }}
            />
            {fav ? 'En biblioteca' : 'Añadir'}
            {!fav && (
              <ChevronDown
                className={cn('ml-2 transition-transform duration-200', catPick?.inline && 'rotate-180')}
                style={{ width: px(14, scale, 12), height: px(14, scale, 12) }}
              />
            )}
          </Button>

          {catPick?.inline && (
            <div className="absolute left-1/2 top-full z-40 mt-2 w-max min-w-full max-w-64 -translate-x-1/2 rounded-xl border border-border bg-card p-3 shadow-2xl">
              <div className="flex flex-col gap-1.5">
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
                      className={cn(
                        'w-full min-w-0 truncate rounded-md px-2.5 py-1.5 text-xs font-medium text-center transition-colors',
                        on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 w-full">
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
        <Button
          variant="secondary"
          onClick={() => setAniListOpen(true)}
          title="Vincular con AniList"
          style={{
            height: px(40, scale, 33),
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

      <div className="mt-6 border-t border-border pt-3">
        <div className="mb-2">
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
                'group relative flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5 hover:bg-accent/50 transition-colors',
                read && 'opacity-45 hover:opacity-70'
              )}
              style={{ minHeight: `${Math.round(52 * scale)}px` }}
              href={`#/leer?u=${encodeURIComponent(c.url)}&m=${encodeURIComponent(mangaUrl)}&s=${encodeURIComponent(sourceId)}&from=${fromParam}`}
            >
              <span className="flex-1 min-w-0">
                <span
                  className="block font-semibold truncate"
                  style={{ fontSize: `${Math.round(15 * scale)}px` }}
                >
                  {c.title}
                </span>
                <span
                  className="block text-muted-foreground"
                  style={{ fontSize: `${Math.round(13 * scale)}px` }}
                >
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
                  className="shrink-0 flex items-center gap-1 text-primary rounded-md hover:bg-accent"
                  style={{ fontSize: `${Math.round(13 * scale)}px` }}
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
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMarkBefore({ chapter: c }); }}
                  >
                    <CheckCheck className="w-4 h-4" />
                    <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                  </button>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Marcar como leído"
                    aria-label={`Marcar ${c.title} como leído`}
                    className="shrink-0 flex items-center gap-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded-md hover:bg-accent hover:text-foreground transition-opacity"
                    style={{ fontSize: `${Math.round(13 * scale)}px` }}
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
          const previos = ordered.slice(0, ordered.findIndex((c) => c.url === markBefore.chapter.url));
          const pending = previos.filter((x) => !progress.get(x.url, sourceId)?.read);
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

