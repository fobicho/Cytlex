import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils.js';
import { api } from '../lib/api.js';
import { settings } from '../lib/settings.js';
import { tracking } from '../lib/tracking.js';
import { extensions } from '../lib/extensions.js';
import { lib } from '../lib/library.js';
import { discardLibraryCover, getLibraryCover, markLibraryCoverLoaded, preloadLibraryCover, restoreLibraryCover } from '../lib/covers.js';
import { rememberCover } from '../lib/searchState.js';
import { SourceBadge } from './SourceBadge.jsx';

const prefetched = new Set();
const MAX_PREFETCHED = 80;
const coverKey = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function prefetch(url, sourceId) {
  const key = `${sourceId}|${url}`;
  if (!url || prefetched.has(key)) return;
  prefetched.add(key);
  if (prefetched.size > MAX_PREFETCHED) prefetched.delete(prefetched.values().next().value);
  api.prefetchDetail(url, sourceId);
}

function MangaCard({ m, sourceId = 'leercapitulo', unavailable = false, unavailableLabel = 'Fuente no instalada', minimal = false, showAuthor = true, from = 'biblioteca', coverSize, chapterCount }) {
  const detailHash = `#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sourceId)}&from=${from}`;
  const sourceManifest = extensions.manifest(sourceId);
  const savedSourceName = String(m.sourceName || '');
  const manifestSourceName = String(sourceManifest.name || '');
  const hasSavedSourceName = savedSourceName && !/^(mihon-\d+|Fuente Mihon \d+)$/i.test(savedSourceName);
  const sourceInfo = {
    ...sourceManifest,
    name: hasSavedSourceName
      ? savedSourceName
      : (manifestSourceName && !/^(mihon-|Fuente Mihon)/i.test(manifestSourceName) ? manifestSourceName : sourceId),
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
  const preferredCover = aniLocal || aniCover || cachedCover || localCover || m.cover;
  const [coverState, setCoverState] = useState(() => {
    const cached = getLibraryCover(preferredCover);
    return { key: preferredCover, src: cached || (from === 'biblioteca' && /^https?:\/\//i.test(preferredCover || '') ? '' : preferredCover) };
  });
  const src = coverState.key === preferredCover
    ? coverState.src
    : getLibraryCover(preferredCover) || (from === 'biblioteca' && /^https?:\/\//i.test(preferredCover || '') ? '' : preferredCover);
  const hoverTimer = useRef(null);
  const failedCoverUrls = useRef(new Set());
  const refreshedCoverMangas = useRef(new Set());

  useEffect(() => {
    if (from !== 'biblioteca' || !/^https?:\/\//i.test(preferredCover || '')) return undefined;
    let alive = true;
    restoreLibraryCover(preferredCover).then((local) => {
      if (alive) setCoverState({ key: preferredCover, src: local || preferredCover });
    });
    return () => { alive = false; };
  }, [from, preferredCover]);

  const schedulePrefetch = () => {
    if (unavailable || from === 'biblioteca') return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => prefetch(m.url, sourceId), 180);
  };
  const cancelPrefetch = () => clearTimeout(hoverTimer.current);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
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
              loading={from === 'biblioteca' ? 'eager' : 'lazy'}
              decoding={from === 'biblioteca' ? 'sync' : 'async'}
              fetchPriority={from === 'biblioteca' ? 'high' : undefined}
              src={src}
              alt={m.title}
              referrerPolicy="no-referrer"
              onLoad={() => {
                if (from === 'biblioteca') markLibraryCoverLoaded(src);
                if (from === 'biblioteca' && /^(https?:\/\/|data:image\/)/i.test(src || '')) preloadLibraryCover(src);
              }}
              onError={async () => {
                if (src.startsWith('blob:') && src !== preferredCover && preferredCover) {
                  discardLibraryCover(preferredCover, src);
                  setCoverState({ key: preferredCover, src: preferredCover });
                  return;
                }
                if (unavailable) {
                  setCoverState({ key: preferredCover, src: '' });
                  return;
                }
                if (!src || failedCoverUrls.current.has(src)) {
                  setCoverState({ key: preferredCover, src: '' });
                  return;
                }
                failedCoverUrls.current.add(src);
                const local = await preloadLibraryCover(src);
                if (local) {
                  setCoverState({ key: preferredCover, src: local });
                  return;
                }
                const mangaKey = `${sourceId}|${m.url}`;
                if (from === 'biblioteca' && m.url && m.title && !refreshedCoverMangas.current.has(mangaKey)) {
                  refreshedCoverMangas.current.add(mangaKey);
                  try {
                    const result = await api.catalog({ q: m.title, page: 1 }, sourceId);
                    const expectedTitle = coverKey(m.title);
                    const refreshed = (result.items || []).find((item) => coverKey(item.title) === expectedTitle && item.cover && item.cover !== src);
                    if (refreshed?.cover) {
                      rememberCover(m.url, refreshed.cover);
                      lib.updateFav(m.url, { cover: refreshed.cover, coverLocal: '' }, sourceId);
                      setCoverState({ key: preferredCover, src: refreshed.cover });
                      return;
                    }
                  } catch {}
                }
                if (!unavailable && from !== 'biblioteca' && m.url && sourceId) {
                  try {
                    const detail = await api.detail(m.url, sourceId);
                    const refreshedCover = detail?.cover;
                    if (refreshedCover && refreshedCover !== src && !failedCoverUrls.current.has(refreshedCover)) {
                      lib.updateFav(m.url, { cover: refreshedCover, coverLocal: '' }, sourceId);
                      setCoverState({ key: preferredCover, src: refreshedCover });
                      return;
                    }
                  } catch {}
                }
                setCoverState({ key: preferredCover, src: '' });
              }}
              className={inner}
            />
          ) : (
            <div className={cn(ph, 'bg-muted/40')} />
          )}
          {unavailable && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 px-2">
              <span className="rounded-full bg-black/80 px-2.5 py-1 text-[10px] font-semibold text-white">
                {unavailableLabel}
              </span>
              <span className="flex max-w-full min-w-0 items-center rounded-full bg-black/80 py-1 pl-1 pr-2 text-white" style={{ gap: px(6, 5) }} title={sourceInfo.name}>
                <SourceBadge m={sourceInfo} className="border border-white/50 bg-white shadow-sm" style={{ width: px(22, 20), height: px(22, 20), borderRadius: '999px', fontSize: px(10, 8) }} />
                <span className="min-w-0 truncate font-semibold" style={{ fontSize: px(10, 8) }}>{sourceInfo.name}</span>
              </span>
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
        {!minimal && showAuthor && (
          <div className="text-muted-foreground mt-0.5 truncate" style={subStyle}>
            {unavailable
              ? unavailableLabel
              : (m.author || m.autor || '\u00a0')}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MangaCard);
