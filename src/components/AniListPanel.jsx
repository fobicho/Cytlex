import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { Unlink, ExternalLink, Search, Loader2, AlertTriangle, Save, Minus, Plus, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Users, Heart } from 'lucide-react';
import { anilist, anilistList, setScoreScale } from '../lib/anilist.js';
import { session } from '../lib/session.js';
import { tracking } from '../lib/tracking.js';
import { settings } from '../lib/settings.js';
import { useResponsiveCoverSize } from '../lib/useResponsiveCoverSize.js';
import { useI18n, translate as t } from '../lib/i18n.js';
import { seedFromAniList } from '../lib/sync.js';
import { Dialog } from './ui/dialog.jsx';
import { Badge } from './ui/badge.jsx';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { Dropdown } from './ui/dropdown.jsx';
import { cn } from '../lib/utils.js';
import { px, useScale, fontPx } from '../lib/useScale.js';

const STATUS_ES = {
  FINISHED: 'Finalizado',
  RELEASING: 'En curso',
  NOT_YET_RELEASED: 'Sin publicar',
  CANCELLED: 'Cancelado',
  HIATUS: 'En pausa'
};

const FORMAT_ES = {
  MANGA: 'Manga',
  NOVEL: 'Novela',
  ONE_SHOT: 'One-shot',
  MANHWA: 'Manhwa',
  MANHUA: 'Manhua',
  DOUJINSHI: 'Doujin',
  LIGHT_NOVEL: 'Novela ligera'
};

const LIST_STATUS = [
  ['CURRENT', 'Leyendo'],
  ['PLANNING', 'Planeando'],
  ['COMPLETED', 'Completado'],
  ['PAUSED', 'En pausa'],
  ['DROPPED', 'Abandonado'],
  ['REPEATING', 'Repitiendo']
];

const SCORE_FORMATS = {
  POINT_100: { max: 100, step: 1, label: 'Puntuación (0-100)' },
  POINT_10_DECIMAL: { max: 10, step: 0.1, label: 'Puntuación (0-10, un decimal)' },
  POINT_10: { max: 10, step: 1, label: 'Puntuación (0-10)' },
  POINT_5: { max: 5, step: 1, label: 'Puntuación (0-5)' },
  POINT_3: { max: 3, step: 1, label: 'Puntuación (0-3)' }
};

const ANILIST_ICON = 'https://www.google.com/s2/favicons?domain=anilist.co&sz=128';

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const pad = (n) => String(n).padStart(2, '0');
const toISO = (v) => (v ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : '');

const parseDate = (v) => {
  if (!v) return '';
  const m = String(v).match(/^(\d{1,2})\s+([a-z]{3})\s+(\d{4})$/i);
  if (!m) return '';
  const mon = MONTHS_SHORT.indexOf(m[2].toLowerCase());
  if (mon < 0) return '';
  return `${m[3]}-${pad(mon + 1)}-${pad(m[1])}`;
};

const formatDate = (iso) => {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}`;
};

const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function Calendar({ value, onChange }) {
  const { language } = useI18n();
  const scale = useScale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => {
    const d = value ? new Date(value) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const place = () => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const width = Math.max(r.width, Number.parseInt(px(224, scale, 184), 10));
    const height = panelRef.current?.offsetHeight || 300;
    const gap = Number.parseInt(px(4, scale, 3), 10);
    const below = window.innerHeight - r.bottom;
    const top = below < height + gap * 2 && r.top > below ? r.top - height - gap : r.bottom + gap;
    const edge = Number.parseInt(px(8, scale, 6), 10);
    const left = Math.min(Math.max(edge, r.left), window.innerWidth - width - edge);
    setPos({ top, left, width });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, cursor]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const d = value ? new Date(value) : new Date();
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [open, value]);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))
  ];

  const shift = (n) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));

  const panel = (
    <div
      ref={panelRef}
      style={pos ? { top: pos.top, left: pos.left, width: pos.width } : undefined}
      className="fixed z-[70] rounded-lg border border-border bg-card p-3 shadow-2xl"
      data-scrollable
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label={t('Mes anterior')}
          className="grid place-items-center w-7 h-7 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium">
          {new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es', { month: 'long' }).format(cursor)} {cursor.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label={t('Mes siguiente')}
          className="grid place-items-center w-7 h-7 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((_, i) => (
          <span key={i} className="grid place-items-center h-7 text-muted-foreground" style={{ fontSize: fontPx(11, scale, 9) }}>
            {new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es', { weekday: 'short' }).format(new Date(2024, 0, 1 + i)).slice(0, 1).toLocaleUpperCase(language === 'en' ? 'en-US' : 'es')}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const active = sameDay(d, value ? new Date(value) : null);
          const isToday = sameDay(d, today);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => { onChange(toISO(d)); setOpen(false); }}
              className={cn(
                'grid place-items-center h-8 min-w-0 rounded-md text-sm transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-accent',
                !active && isToday && 'ring-1 ring-border'
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 mt-2 pt-2 border-t border-border">
        <Button type="button" variant="ghost" size="sm" className="flex-1 h-7 text-xs" onClick={() => { onChange(toISO(today)); setOpen(false); }}>
          Hoy
        </Button>
        <Button type="button" variant="ghost" size="sm" className="flex-1 h-7 text-xs" onClick={() => { onChange(''); setOpen(false); }}>
          Borrar
        </Button>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="relative mt-1">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-2 h-8 w-full rounded-lg border border-border bg-background pl-2.5 pr-2.5 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <span className={cn('flex-1 truncate text-left', !value && 'text-muted-foreground')}>
          {value ? formatDate(value) : '—'}
        </span>
        <CalendarIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && createPortal(panel, document.body)}
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max, step = 1, placeholder = '—' }) {
  const current = value === '' || value == null ? null : Number(value);
  const atMin = current == null || current <= min;
  const atMax = current != null && max != null && current >= max;

  const bump = (dir) => {
    const base = current == null ? min : current;
    const next = Math.min(max ?? Infinity, Math.max(min, base + dir * step));
    onChange(String(Number(next.toFixed(2))));
  };

  return (
    <div className="flex items-center gap-1 mt-1 h-8 px-1 rounded-lg border border-border bg-background">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 rounded-md"
        aria-label={t('Reducir')}
        disabled={atMin}
        onClick={() => bump(-1)}
      >
        <Minus className="w-3.5 h-3.5" />
      </Button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={t('Valor')}
        className="flex-1 min-w-0 bg-transparent text-sm text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 rounded-md"
        aria-label={t('Ampliar')}
        disabled={atMax}
        onClick={() => bump(1)}
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function DateField({ value, onChange }) {
  return <Calendar value={value} onChange={onChange} />;
}

const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function SearchDialog({ open, onClose, mangaTitle, onPick, coverScale = 1 }) {
  const scale = useScale();
  const listRef = useRef(null);
  const scrollTimerRef = useRef(null);
  const [term, setTerm] = useState(mangaTitle || '');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [srcLogo, setSrcLogo] = useState(() => settings.get().trackingLogo || ANILIST_ICON);

  useEffect(() => () => clearTimeout(scrollTimerRef.current), []);

  useEffect(() => {
    if (!open) return undefined;
    setTerm(mangaTitle || '');
    setResults(null);
    setErr('');
    if (listRef.current) listRef.current.scrollTop = 0;

    const q = String(mangaTitle || '').trim();
    if (!q) return undefined;
    let alive = true;
    setBusy(true);
    anilist
      .search(q)
      .then((r) => { if (alive) { setResults(r); if (listRef.current) listRef.current.scrollTop = 0; } })
      .catch((e) => { if (alive) { setErr(String(e?.message || e)); setResults([]); } })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [open, mangaTitle]);

  const run = async (value) => {
    const q = String(value || '').trim();
    if (!q) {
      setResults([]);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      setResults(await anilist.search(q));
    } catch (e) {
      setErr(String(e?.message || e));
      setResults([]);
    }
    setBusy(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      scale={scale}
      ariaLabel="Buscar en AniList"
      className="max-w-2xl h-[min(44rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] flex flex-col"
      bodyClassName="p-4 flex-1 min-h-0 flex flex-col"
      bodyPaddingTop={16}
      bodyPaddingBottom={16}
      bodyPaddingX={16}
      scrollableBody={false}
    >
      <form
        className="flex gap-2 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          run(term);
        }}
      >
        <span className="w-9 h-9 rounded-sm bg-secondary text-secondary-foreground grid place-items-center font-bold shrink-0 overflow-hidden">
          {srcLogo ? (
            <img src={srcLogo} alt="" className="w-full h-full object-cover" onError={() => setSrcLogo(null)} />
          ) : (
            'A'
          )}
        </span>
        <div className="relative min-w-0 flex-1">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('Título del manga…')}
            aria-label={t('Buscar en AniList')}
            autoFocus
            className="h-9 bg-background border-border/70 pr-10"
            style={{ fontSize: fontPx(14, scale, 12) }}
          />
          <button type="submit" aria-label={t('Buscar')} disabled={busy || !term.trim()} className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>
      </form>

      <div className="pt-3 flex-1 min-h-0 flex flex-col">
        <div
          ref={listRef}
          className="page-content-scroll max-h-full min-h-0 overflow-y-auto overscroll-contain"
          style={{ marginRight: `-${px(16, scale, 12)}`, paddingRight: `max(0px, ${px(16, scale, 12)} - 4px)` }}
          onScroll={(event) => {
            const list = event.currentTarget;
            list.classList.add('is-scrolling');
            clearTimeout(scrollTimerRef.current);
            scrollTimerRef.current = setTimeout(() => list.classList.remove('is-scrolling'), 700);
          }}
        >
          {err && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {err}
            </p>
          )}
          {!err && busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('Buscando en AniList…')}
            </p>
          )}
          {!err && !busy && results?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('Sin resultados para «{term}».', { term })}</p>
          )}
          {results?.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m)}
              className="flex w-full items-start gap-3 rounded-md py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {m.cover ? (
                <img src={m.cover} alt="" referrerPolicy="no-referrer" className="manga-cover-corners object-cover rounded-sm bg-black shrink-0" style={{ width: px(84 * coverScale, scale, 60), height: px(112 * coverScale, scale, 80) }} />
              ) : (
                <div className="manga-cover-corners rounded-sm bg-secondary shrink-0" style={{ width: px(84 * coverScale, scale, 60), height: px(112 * coverScale, scale, 80) }} />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{m.title}</div>
                {m.author && <div className="text-xs text-muted-foreground truncate">{m.author}</div>}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {m.status && <Badge>{t(STATUS_ES[m.status] || m.status)}</Badge>}
                  {m.format && <Badge variant="outline">{t(FORMAT_ES[m.format] || m.format)}</Badge>}
                  {m.startDate && <span className="text-xs text-muted-foreground">{m.startDate}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold" title={t(m.averageScore == null ? 'Sin valoración' : 'Puntuación media de los usuarios en AniList, de 0 a 100')} aria-label={t(m.averageScore == null ? 'Sin valoración' : `Valoración ${m.averageScore} sobre 100`)}>
                  {m.averageScore ?? '–'}
                </div>
                {m.popularity != null && (
                  <div className="text-muted-foreground" style={{ fontSize: fontPx(11, scale, 9) }} title={t('Personas con esta obra en su lista')}>
                    {compact(m.popularity)}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

const EntryForm = forwardRef(function EntryForm({ entry, scoreFormat = 'POINT_10', totalChapters, onSubmit, saving, err }, ref) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    status: entry?.status || 'CURRENT',
    progress: entry?.progress ?? 0,
    score: entry?.score ?? '',
    startedAt: parseDate(entry?.startedAt),
    completedAt: parseDate(entry?.completedAt)
  });

  const initial = {
    status: entry?.status || 'CURRENT',
    progress: entry?.progress ?? 0,
    score: entry?.score ?? '',
    startedAt: parseDate(entry?.startedAt),
    completedAt: parseDate(entry?.completedAt)
  };

  const isDirty =
    form.status !== initial.status ||
    Number(form.progress) !== Number(initial.progress) ||
    String(form.score) !== String(initial.score) ||
    form.startedAt !== initial.startedAt ||
    form.completedAt !== initial.completedAt;

  useImperativeHandle(ref, () => ({
    commit: () => onSubmit(form),
    dirty: isDirty
  }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
      <div className="grid gap-3 grid-cols-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">{t('Estado')}</span>
          <div className="mt-1">
            <Dropdown
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              ariaLabel="Estado"
              className="h-8"
              portal
              options={LIST_STATUS.map(([value, label]) => ({ value, label }))}
            />
          </div>
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground" title={t('Capítulos ya terminados, no el que estás leyendo')}>
            {t('Capítulos leídos')}
          </span>
          <Stepper
            value={form.progress}
            min={0}
            max={totalChapters ?? undefined}
            onChange={(v) => setForm({ ...form, progress: v })}
          />
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground">{t('Puntuación')}</span>
          <Stepper
            value={form.score}
            min={0}
            max={SCORE_FORMATS[scoreFormat]?.max ?? 10}
            step={SCORE_FORMATS[scoreFormat]?.step ?? 1}
            placeholder="—"
            onChange={(v) => setForm({ ...form, score: v })}
          />
        </label>
      </div>

      <div className="grid gap-3 grid-cols-2 mt-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">{t('Inicio')}</span>
          <DateField
            value={form.startedAt}
            onChange={(v) => setForm({ ...form, startedAt: v })}
          />
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground">{t('Fin')}</span>
          <DateField
            value={form.completedAt}
            onChange={(v) => setForm({ ...form, completedAt: v })}
          />
        </label>
      </div>

      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        {!entry && <span className="text-xs text-muted-foreground">{t('Se añadirá a tu lista de AniList.')}</span>}
        <Button type="submit" size="sm" disabled={saving || !isDirty} className="ml-auto">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Guardar
        </Button>
      </div>
    </form>
  );
});

const CHAR_ROLE_ES = {
  MAIN: 'Principal',
  SUPPORTING: 'Secundario',
  BACKGROUND: 'Fondo'
};

function CharactersDialog({ open, onClose, mediaId, connected }) {
  const scale = useScale();
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(null);
  const [detail, setDetail] = useState(null);
  const [favBusy, setFavBusy] = useState(false);

  const toggleFav = async () => {
    if (!picked) return;
    setFavBusy(true);
    try {
      await anilist.toggleFavourite(picked);
      setDetail(await anilist.character(picked));
    } catch {
    } finally {
      setFavBusy(false);
    }
  };

  const loadMore = async () => {
    const next = page + 1;
    setMoreBusy(true);
    try {
      const r = await anilist.characters(mediaId, next);
      setList((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...r.items.filter((c) => !seen.has(c.id))];
      });
      setPage(next);
      setHasMore(r.hasMore);
      setTotal(r.total);
    } catch {
    } finally {
      setMoreBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !mediaId) return undefined;
    let alive = true;
    setList([]);
    setPage(1);
    setTotal(0);
    setHasMore(false);
    setErr('');
    setPicked(null);
    setDetail(null);
    setBusy(true);
    anilist
      .characters(mediaId, 1)
      .then((r) => {
        if (!alive) return;
        setList(r.items);
        setTotal(r.total);
        setHasMore(r.hasMore);
      })
      .catch((e) => { if (alive) setErr(String(e?.message || e)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [open, mediaId]);

  useEffect(() => {
    if (!open || !picked) return undefined;
    let alive = true;
    setDetail(null);
    anilist
      .character(picked)
      .then((r) => { if (alive) setDetail(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, picked]);

  const pickedChar = picked ? list.find((c) => c.id === picked) || null : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      scale={scale}
      className="max-w-2xl max-h-[min(38rem,calc(100dvh-3rem))] flex flex-col"
      bodyClassName="p-5 min-h-0 overflow-y-auto"
      bodyPaddingTop={24}
    >
      {busy && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {err && !busy && <p className="text-sm text-destructive">{err}</p>}

      {!busy && !err && list.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('No hay personajes registrados en AniList.')}
        </p>
      )}

      {!busy && !err && picked && pickedChar && (
        <div className="relative flex flex-col gap-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!connected || favBusy}
            onClick={toggleFav}
            title={t(connected ? (detail?.isFavourite ? 'Quitar de favoritos' : 'Añadir a favoritos') : 'Conecta tu cuenta para dar me gusta')}
            aria-label={t(detail?.isFavourite ? 'Quitar de favoritos' : 'Añadir a favoritos')}
            className="absolute -top-1 -right-1 h-8 gap-1.5 px-2.5 text-xs"
          >
            <Heart className={cn('w-4 h-4', detail?.isFavourite && 'fill-destructive text-destructive')} />
            {compact(detail?.favourites ?? pickedChar.favourites)}
          </Button>

          <div className="flex gap-4">
            {pickedChar.image ? (
              <img
                src={pickedChar.image}
                alt=""
                referrerPolicy="no-referrer"
                className="w-28 h-40 object-cover rounded-sm bg-black shrink-0"
              />
            ) : (
              <div className="w-28 h-40 rounded-xl bg-secondary shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold leading-snug">{pickedChar.name}</div>
              {pickedChar.role && (
                <div className="mt-1.5">
                  <Badge variant="outline">{CHAR_ROLE_ES[pickedChar.role] || pickedChar.role}</Badge>
                </div>
              )}
              {detail?.alternative && (
                <p className="text-xs text-muted-foreground mt-1.5">{detail.alternative}</p>
              )}
              {detail?.native && detail.native !== pickedChar.name && (
                <p className="text-xs text-muted-foreground mt-0.5">{detail.native}</p>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground whitespace-pre-line min-h-[3rem]">
            {detail?.description || ''}
          </p>

          <Button variant="secondary" size="sm" className="self-start" onClick={() => setPicked(null)}>
            Volver a la lista
          </Button>
        </div>
      )}

      {!busy && !err && !picked && list.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setPicked(c.id)}
                className="group flex flex-col gap-1.5 text-left"
              >
                {c.image ? (
                  <img
                    src={c.image}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="w-full aspect-[2/3] object-cover rounded-sm bg-black"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] rounded-xl bg-secondary" />
                )}
                <span className="text-xs font-medium truncate">{c.name}</span>
                {c.role && (
                  <span className="text-muted-foreground" style={{ fontSize: fontPx(11, scale, 9) }}>{CHAR_ROLE_ES[c.role] || c.role}</span>
                )}
              </button>
            ))}
          </div>

          {hasMore && (
            <Button
              variant="secondary"
              size="sm"
              className="self-center"
              disabled={moreBusy}
              onClick={loadMore}
            >
              {moreBusy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ChevronLeft className="w-4 h-4 mr-2 rotate-90" />
              )}
              {t('Cargar más')}
              <span className="opacity-70 ml-2">
                {list.length}/{total}
              </span>
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function AniListPanel({ mangaUrl, sourceId, title, open, onClose }) {
  const { t } = useI18n();
  const scale = useScale();
  const [coverSize, setCoverSize] = useState(() => settings.get().coverSize);
  const coverScale = useResponsiveCoverSize(coverSize) / 160;
  const [linkedId, setLinkedId] = useState(() => tracking.get(mangaUrl, sourceId)?.id || null);
  const [data, setData] = useState(null);
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [connected, setConnected] = useState(false);
  const [scoreFormat, setScoreFormat] = useState('POINT_10');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [picking, setPicking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showChars, setShowChars] = useState(false);
  const formRef = useRef(null);

  const requestClose = () => {
    if (formRef.current?.dirty) setConfirmDiscard(true);
    else onClose();
  };

  useEffect(
    () => tracking.subscribe(() => setLinkedId(tracking.get(mangaUrl, sourceId)?.id || null)),
    [mangaUrl, sourceId]
  );
  useEffect(() => settings.subscribe((s) => setCoverSize(s.coverSize)), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await session.status();
      if (!alive) return;
      setConnected(st.connected);
      if (st.connected) {
        const v = await session.viewer();
        if (alive && v?.scoreFormat) {
          setScoreFormat(v.scoreFormat);
          setScoreScale(v.scoreFormat);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) {
      setPicking(false);
      setSaveErr('');
      return undefined;
    }
    if (!linkedId) {
      setPicking(true);
      return undefined;
    }
    anilistList.invalidateEntry(linkedId);
    let alive = true;
    setLoading(true);
    setErr('');
    Promise.all([anilist.byId(linkedId), connected ? anilistList.entry(linkedId) : Promise.resolve(null)])
      .then(([m, e]) => {
        if (!alive) return;
        setData(m);
        setEntry(e);
        if (e) seedFromAniList(linkedId);
      })
      .catch((e) => { if (alive) setErr(String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, linkedId, connected, mangaUrl, sourceId]);

  const save = async (form) => {
    setSaving(true);
    setSaveErr('');
    try {
      const patch = {
        mediaId: linkedId,
        entryId: entry?.entryId,
        status: form.status,
        progress: Math.min(Number(form.progress) || 0, data?.chapters ?? Infinity),
        startedAt: form.startedAt,
        completedAt: form.completedAt
      };
      if (form.score !== '') patch.score = Number(form.score);
      await anilistList.saveEntry(patch);
      onClose();
    } catch (e) {
      setSaveErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  if (picking) {
    return (
      <SearchDialog
        open
        coverScale={coverScale}
        onClose={onClose}
        mangaTitle={title}
        onPick={(m) => {
          tracking.link(mangaUrl, sourceId, m.id, m.cover);
          (async () => {
            try {
              const { makeCoverThumb } = await import('../lib/covers.js');
              const thumb = await makeCoverThumb(m.cover);
              if (thumb) tracking.updateCover(mangaUrl, sourceId, { coverLocal: thumb });
            } catch {}
          })();
          setPicking(false);
        }}
      />
    );
  }

  return (
    <Dialog
      open
      onClose={requestClose}
      scale={scale}
      className="max-w-2xl max-h-[calc(100vh-3rem)] flex flex-col"
      bodyClassName="p-5 overflow-y-auto"
      bodyPaddingTop={24}
    >
      {loading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {err && !loading && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">{err}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => tracking.unlink(mangaUrl, sourceId)}>
              <Unlink className="w-4 h-4 mr-2" /> {t('Desvincular')}
            </Button>
            <Button size="sm" onClick={() => { anilist.clearCache(); setData(null); setErr(''); setLinkedId(linkedId); }}>
              <Loader2 className="w-4 h-4 mr-2" /> {t('Reintentar')}
            </Button>
          </div>
        </div>
      )}

      {data && !loading && !err && (
        <div className="flex gap-5">
          <div className="shrink-0" style={{ width: px(144 * coverScale, scale, 96) }}>
            {data.cover ? (
              <img
                src={data.cover}
                alt=""
                referrerPolicy="no-referrer"
                className="manga-cover-corners w-full aspect-[5/7] object-cover rounded-sm bg-black"
              />
            ) : (
              <div className="manga-cover-corners w-full aspect-[5/7] rounded-xl bg-secondary" />
            )}
            {data.siteUrl && (
              <a
                href={data.siteUrl}
                target="_blank"
                rel="noreferrer"
                className={cn('inline-flex items-center gap-1.5 text-xs text-primary mt-3 hover:underline')}
              >
              <ExternalLink className="w-3.5 h-3.5" /> {t('Ver en AniList')}
              </a>
            )}
            <button
              type="button"
              onClick={() => setShowChars(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground mt-2 hover:text-foreground transition-colors"
            >
              <Users className="w-3.5 h-3.5" /> {t('Ver personajes')}
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold leading-snug">{data.title}</div>
                {data.author && <div className="text-sm text-muted-foreground mt-0.5">{data.author}</div>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                title={t('Desvincular')}
                aria-label={t('Desvincular')}
                onClick={() => { tracking.unlink(mangaUrl, sourceId); anilist.clearCache(); onClose(); }}
              >
                <Unlink className="w-4 h-4" />
              </Button>
            </div>

            {(() => {
              const facts = [
                data.status && t(STATUS_ES[data.status] || data.status),
                data.format && t(FORMAT_ES[data.format] || data.format),
                data.startDate,
                data.endDate
              ].filter(Boolean);
              return facts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                  {facts.map((f, i) => (
                    <span key={f} className="inline-flex items-center gap-1.5">
                      {i > 0 && <span aria-hidden>·</span>}
                      {f}
                    </span>
                  ))}
                </div>
              );
            })()}

            {(data.chapters != null || data.volumes != null) && (
              <p className="mt-2 text-xs text-muted-foreground">
                {data.chapters != null && <>{data.chapters} {t('capítulos')}</>}
                {data.chapters != null && data.volumes != null && ', '}
                {data.volumes != null && <>{t('en')} {data.volumes} {t('volúmenes')}</>}
              </p>
            )}

            {connected && (
              <div className="mt-4">
                <EntryForm
                  ref={formRef}
                  entry={entry}
                  scoreFormat={scoreFormat}
                  totalChapters={data.chapters}
                  onSubmit={save}
                  saving={saving}
                  err={saveErr}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {confirmDiscard && (
        <Dialog
          open
          onClose={() => setConfirmDiscard(false)}
          scale={scale}
          title={t('Guardar cambios')}
          hideDivider
          bodyClassName="p-5"
        >
          <p className="text-sm text-muted-foreground">
            {t('Hay cambios sin guardar en tu seguimiento de AniList. ¿Quieres guardarlos?')}
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <Button
              variant="secondary"
              onClick={() => { setConfirmDiscard(false); onClose(); }}
            >
              Descartar
            </Button>
            <Button
              onClick={async () => {
                setConfirmDiscard(false);
                await formRef.current?.commit();
                onClose();
              }}
            >
              Guardar
            </Button>
          </div>
        </Dialog>
      )}

      {showChars && data && (
        <CharactersDialog
          open
          onClose={() => setShowChars(false)}
          mediaId={data.id}
          connected={connected}
        />
      )}
    </Dialog>
  );
}

