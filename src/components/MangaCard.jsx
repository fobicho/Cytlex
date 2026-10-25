import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils.js';
import { api } from '../lib/api.js';
import { settings } from '../lib/settings.js';
import { tracking } from '../lib/tracking.js';
import { extensions } from '../lib/extensions.js';
import { SourceBadge } from './SourceBadge.jsx';

const prefetched = new Set();
function prefetch(url, sourceId) {
  const key = `${sourceId}|${url}`;
  if (!url || prefetched.has(key)) return;
  prefetched.add(key);
  api.prefetchDetail(url, sourceId);
}

export default function MangaCard({ m, sourceId = 'leercapitulo', unavailable = false, unavailableLabel = 'Fuente no instalada', minimal = false, from = 'biblioteca', coverSize, chapterCount }) {
  const detailHash = `#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sourceId)}&from=${from}`;
  const sourceManifest = extensions.manifest(sourceId);
  const sourceInfo = {
    ...sourceManifest,
    name: m.sourceName || sourceManifest.name || sourceId,
    icon: sourceManifest.icon || m.sourceIcon
  };
  const linkCls = cn(unavailable && 'pointer-events-none');
  const linkA11y = unavailable ? { 'aria-disabled': true, tabIndex: -1 } : {};

  const localCover = m.coverLocal?.startsWith('data:') ? m.coverLocal : '';
  const cachedCover = m.coverCached || '';
  const [anilistCoverOn, setAnilistCoverOn] = useState(() => !!settings.get().anilistCover);
  useEffect(() => settings.subscribe((s) => setAnilistCoverOn(!!s.anilistCover)), []);
  const t = tracking.get(m.url, sourceId);
  const aniLocal = anilistCoverOn ? (t?.coverLocal || '') : '';
  const aniCover = anilistCoverOn ? (t?.cover || '') : '';
  const [src, setSrc] = useState(aniLocal || aniCover || cachedCover || localCover || m.cover);
  const hoverTimer = useRef(null);

  const schedulePrefetch = () => {
    if (unavailable) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => prefetch(m.url, sourceId), 180);
  };
  const cancelPrefetch = () => clearTimeout(hoverTimer.current);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    const local = m.coverLocal?.startsWith('data:') ? m.coverLocal : '';
    const cached = m.coverCached || '';
    const t2 = tracking.get(m.url, sourceId);
    const aniL = anilistCoverOn ? (t2?.coverLocal || '') : '';
    const aniC = anilistCoverOn ? (t2?.cover || '') : '';
    setSrc(aniL || aniC || cached || local || m.cover);
  }, [m.coverCached, m.coverLocal, m.cover, anilistCoverOn, sourceId, m.url]);

  const box = coverSize ? { width: `${coverSize}px` } : { aspectRatio: '2 / 3' };
  const inner = coverSize ? 'h-full w-full object-cover block' : 'w-full h-full aspect-[2/3] object-cover block';
  const ph = coverSize ? 'h-full w-full' : 'w-full aspect-[2/3]';

  const scale = coverSize ? coverSize / 160 : 1;
  const px = (n, min) => Math.max(min, Math.round(n * scale));
  const titleStyle = coverSize
    ? { fontSize: `${px(13.5, 11)}px` }
    : { fontSize: '13.5px' };
  const subStyle = coverSize
    ? { fontSize: `${px(12, 10)}px` }
    : { fontSize: '12px' };
  const badgeStyle = coverSize
    ? {
        fontSize: `${Math.max(9, Math.round(11 * scale))}px`,
        top: `${Math.max(4, Math.round(8 * scale))}px`,
        right: `${Math.max(4, Math.round(8 * scale))}px`,
        paddingLeft: `${Math.max(4, Math.round(6 * scale))}px`,
        paddingRight: `${Math.max(4, Math.round(6 * scale))}px`,
        minWidth: `${Math.max(18, Math.round(24 * scale))}px`
      }
    : undefined;

  return (
    <div className={cn(unavailable && 'opacity-60')}>
      <a
        href={detailHash}
        aria-label={m.title}
        title={m.title}
        className={linkCls}
        onMouseEnter={schedulePrefetch}
        onMouseLeave={cancelPrefetch}
        onFocus={schedulePrefetch}
        onBlur={cancelPrefetch}
        {...linkA11y}
      >
        <div className="relative rounded-xl overflow-hidden bg-muted/50 border border-border/50 shadow-sm aspect-[2/3]" style={box}>
          {src ? (
            <img
              loading="lazy"
              decoding="async"
              src={src}
              alt={m.title}
              referrerPolicy="no-referrer"
              onError={() => {
                if (src !== m.cover) setSrc(m.cover);
                else setSrc('');
              }}
              className={inner}
            />
          ) : (
            <div className={cn(ph, 'animate-pulse bg-muted/40')} />
          )}
          {unavailable && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
              <span className="rounded-full bg-black/80 px-2.5 py-1 text-[10px] font-semibold text-white">
                {unavailableLabel}
              </span>
              <SourceBadge m={sourceInfo} className="border border-white/50 bg-white shadow-sm" />
            </span>
          )}
          {chapterCount > 0 && !unavailable && (
            <span
              title={`${chapterCount} capítulos sin leer`}
              style={badgeStyle}
              className="absolute top-2 right-2 grid place-items-center rounded-full bg-black/70 font-semibold text-white backdrop-blur-md tabular-nums"
            >
              {chapterCount}
            </span>
          )}
        </div>
      </a>
      <div className="pt-2">
        <a
          className={cn('block font-semibold leading-snug truncate', linkCls)}
          style={titleStyle}
          href={detailHash}
          title={m.title}
          {...linkA11y}
        >
          {m.title}
        </a>
        {!minimal && (
          <div className="text-muted-foreground mt-0.5 truncate" style={subStyle}>
            {unavailable
              ? unavailableLabel
              : ([m.type, m.lastChapter].filter(Boolean).join(' · ') || '\u00a0')}
          </div>
        )}
      </div>
    </div>
  );
}
