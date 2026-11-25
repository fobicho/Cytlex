import { memo, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { api } from '../lib/api.js';
import { settings } from '../lib/settings.js';
import { tracking } from '../lib/tracking.js';
import { extensions } from '../lib/extensions.js';
import { isMangaCover, lib, mangaSourceUrl, storedCoverThumbnail } from '../lib/library.js';
import { discardLibraryCover, getLibraryCover, preloadLibraryCover, preloadSearchCover, requiresImageProxy, restoreLibraryCover } from '../lib/covers.js';
import { browserImageUrl } from '../lib/browserHttp.js';
import { rememberMangaPreview, sourceCatalogState } from '../lib/searchState.js';
import { SourceBadge, preloadSourceIcon } from './SourceBadge.jsx';
import { useLibraryCover } from '../lib/useLibraryCover.js';
import { useI18n } from '../lib/i18n.js';

const prefetched = new Set();
const MAX_PREFETCHED = 80;
function prefetch(url, sourceId) {
  const key = `${sourceId}|${url}`;
  if (!url || prefetched.has(key)) return;
  prefetched.add(key);
  if (prefetched.size > MAX_PREFETCHED) prefetched.delete(prefetched.values().next().value);
  api.prefetchDetail(url, sourceId);
}

function MangaCard({ m, sourceId = 'leercapitulo', unavailable = false, canOpenUnavailable = false, unavailableLabel = 'Fuente no instalada', minimal = false, showAuthor = true, from = 'biblioteca', returnTo = '', onSelect, coverSize, scale: uiScale = 1, chapterCount, useLibraryCoverCache = false, bundledCoverOnly = false, savedInLibrary = false }) {
  const { language } = useI18n();
  const detailHash = `#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sourceId)}&from=${from}${returnTo ? `&back=${encodeURIComponent(returnTo)}` : ''}`;
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
  useEffect(() => {
    if (sourceInfo.icon) void preloadSourceIcon(sourceInfo.icon);
  }, [sourceInfo.icon]);
  const linkDisabled = unavailable && !canOpenUnavailable;
  const linkCls = cn(linkDisabled && 'pointer-events-none');
  const linkA11y = linkDisabled ? { 'aria-disabled': true, tabIndex: -1 } : {};

  const remoteCover = isMangaCover(m.cover, m.url) ? m.cover : '';
  const cachedCover = storedCoverThumbnail(m);
  const indexedCover = getLibraryCover(remoteCover);
  const unavailableCachedCover = [cachedCover, indexedCover].find((cover) => /^(data:|blob:)/i.test(cover || '')) || '';
  const [anilistCoverOn, setAnilistCoverOn] = useState(() => !!settings.get().anilistCover);
  useEffect(() => settings.subscribe((s) => setAnilistCoverOn(!!s.anilistCover)), []);
  const t = unavailable ? null : tracking.get(m.url, sourceId);
  const aniLocal = anilistCoverOn ? (t?.coverLocal || '') : '';
  const aniCover = anilistCoverOn ? (t?.cover || '') : '';
  const preferredCover = unavailable ? unavailableCachedCover || remoteCover : aniLocal || aniCover || cachedCover || remoteCover;
  const hasElectronImageProxy = typeof window !== 'undefined' && !!window.cytlex?.fetchImage;
  const proxyCover = hasElectronImageProxy
    ? requiresImageProxy(preferredCover)
    : browserImageUrl(preferredCover) !== preferredCover;
  const libraryCover = from === 'biblioteca' || useLibraryCoverCache || proxyCover;
  const libraryImage = useLibraryCover(unavailable ? remoteCover : preferredCover, {
    enabled: libraryCover,
    cachedOnly: unavailable && !canOpenUnavailable,
    cachedCover: unavailable ? unavailableCachedCover : '',
    bundledOnly: bundledCoverOnly
  });
  const coverRef = useRef(null);
  const coverImageRef = useRef(null);
  const [coverState, setCoverState] = useState(() => {
    const cached = unavailable ? unavailableCachedCover : getLibraryCover(preferredCover);
    return { key: preferredCover, src: cached || (unavailable || proxyCover ? '' : preferredCover) };
  });
  const src = libraryCover ? libraryImage.src : coverState.key === preferredCover
    ? coverState.src
    : unavailable
      ? unavailableCachedCover
      : getLibraryCover(preferredCover) || (proxyCover ? '' : preferredCover);
  const hoverTimer = useRef(null);
  const loadedCoverKey = useRef('');
  const failedCoverUrls = useRef(new Set());

  useEffect(() => {
    if (libraryCover) return undefined;
    if (unavailable) {
      if (unavailableCachedCover || !/^https?:\/\//i.test(remoteCover || '')) return undefined;
      let alive = true;
      restoreLibraryCover(remoteCover).then((local) => {
        if (alive && local) setCoverState({ key: preferredCover, src: local });
      });
      return () => { alive = false; };
    }
    if (!/^https?:\/\//i.test(preferredCover || '')) return undefined;
    let alive = true;
    if (proxyCover) {
      const load = () => preloadSearchCover(preferredCover).then((local) => {
        if (alive && loadedCoverKey.current !== preferredCover) setCoverState({ key: preferredCover, src: local || '' });
      });
      const target = coverRef.current;
      if (!target || !('IntersectionObserver' in window)) {
        load();
        return () => { alive = false; };
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      }, { root: document.querySelector('main'), rootMargin: '220px 0px' });
      observer.observe(target);
      return () => { alive = false; observer.disconnect(); };
    }
    return undefined;
  }, [libraryCover, remoteCover, preferredCover, proxyCover, unavailable, unavailableCachedCover]);

  const schedulePrefetch = () => {
    if (!window.cytlex?.httpGet || unavailable || from === 'biblioteca') return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => prefetch(m.url, sourceId), 180);
  };
  const cancelPrefetch = () => clearTimeout(hoverTimer.current);
  const saveSourceScroll = () => {
    const main = document.querySelector('main');
    if (main) sourceCatalogState.saveScroll(main.scrollTop);
  };
  const handleSelect = (event) => {
    event.currentTarget.blur();
    if (linkDisabled || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    rememberMangaPreview(m, sourceId, coverImageRef.current);
    if (onSelect) {
      event.preventDefault();
      onSelect(m, sourceId);
    } else if (from === 'fuentes') {
      saveSourceScroll();
    }
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const box = coverSize ? { width: `${coverSize}px` } : { aspectRatio: '2 / 3' };
  const inner = coverSize ? 'h-full w-full object-cover block' : 'w-full h-full aspect-[2/3] object-cover block';
  const ph = coverSize ? 'h-full w-full' : 'w-full aspect-[2/3]';

  const scale = coverSize ? coverSize / 160 : uiScale;
  const px = (n, min) => Math.max(min, Math.round(n * scale));
  const fontPx = (n, min) => Math.max(min, Math.round(n * scale));
  const titleStyle = { fontSize: `${fontPx(15, 11)}px` };
  const subStyle = { fontSize: `${fontPx(12, 10)}px` };
  const badgeStyle = {
    fontSize: `${fontPx(11, 9)}px`,
    top: `${Math.max(8, Math.round(10 * scale))}px`,
    right: `${Math.max(8, Math.round(10 * scale))}px`,
    paddingLeft: `${Math.max(4, Math.round(6 * scale))}px`,
    paddingRight: `${Math.max(4, Math.round(6 * scale))}px`,
    minWidth: `${Math.max(18, Math.round(24 * scale))}px`
  };

  return (
    <div className={cn(unavailable && 'opacity-60')}>
      <a
        href={detailHash}
        aria-label={m.title}
        title={m.title}
        className={linkCls}
        onClick={handleSelect}
        onMouseEnter={schedulePrefetch}
        onMouseLeave={cancelPrefetch}
        onFocus={schedulePrefetch}
        onBlur={cancelPrefetch}
        {...linkA11y}
      >
        <div ref={libraryCover ? libraryImage.ref : coverRef} className="manga-cover-corners relative overflow-hidden bg-muted/50 aspect-[2/3] rounded-sm" style={box}>
          {src ? (
            <img
              ref={coverImageRef}
              loading="lazy"
              decoding="async"
              src={src}
              alt={m.title}
              referrerPolicy={hasElectronImageProxy ? 'no-referrer' : undefined}
              onLoad={() => {
                loadedCoverKey.current = preferredCover;
                if (libraryCover) libraryImage.onLoad();
              }}
              onError={async () => {
                if (libraryCover) return libraryImage.onError();
                if (unavailable) {
                  if (src.startsWith('blob:') && src !== preferredCover && preferredCover) discardLibraryCover(preferredCover, src);
                  setCoverState({ key: preferredCover, src: '' });
                  return;
                }
                if (src.startsWith('blob:') && src !== preferredCover && preferredCover) {
                  discardLibraryCover(preferredCover, src);
                  setCoverState({ key: preferredCover, src: preferredCover });
                  return;
                }
                if (!src || failedCoverUrls.current.has(src)) {
                  setCoverState({ key: preferredCover, src: '' });
                  return;
                }
                failedCoverUrls.current.add(src);
                const local = await preloadLibraryCover(src, { web: true });
                if (local) {
                  setCoverState({ key: preferredCover, src: local });
                  return;
                }
                if (!unavailable && from !== 'biblioteca' && m.url && sourceId) {
                  try {
                    const canonicalUrl = mangaSourceUrl(m.url, sourceId);
                    const detail = canonicalUrl.startsWith('https://mangadex.org/title/')
                      ? api.peekStaleDetail(m.url, sourceId)
                      : await api.detail(m.url, sourceId);
                    const refreshedCover = detail?.cover;
                    if (refreshedCover && isMangaCover(refreshedCover, m.url) && refreshedCover !== src && !failedCoverUrls.current.has(refreshedCover)) {
                      lib.updateFav(m.url, { cover: refreshedCover, coverLocal: '', coverCached: '' }, sourceId);
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
              <span className="rounded-full bg-black/80 px-2.5 py-1 font-semibold text-white" style={{ fontSize: `${fontPx(10, 8)}px` }}>
                {unavailableLabel}
              </span>
              <span className="flex max-w-full min-w-0 items-center rounded-full bg-black/80 py-1 pl-1 pr-2 text-white" style={{ gap: px(6, 5) }} title={sourceInfo.name}>
                <SourceBadge m={sourceInfo} className="border border-white/50 bg-white shadow-sm" style={{ width: px(22, 20), height: px(22, 20), borderRadius: '999px', fontSize: fontPx(10, 8) }} />
                <span className="min-w-0 truncate font-semibold" style={{ fontSize: fontPx(10, 8) }}>{sourceInfo.name}</span>
              </span>
            </span>
          )}
          {chapterCount > 0 && !unavailable && (
            <span
              title={language === 'en' ? `${chapterCount} unread chapters` : `${chapterCount} capítulos sin leer`}
              style={badgeStyle}
              className="pointer-events-none absolute top-1.5 right-1.5 z-10 grid place-items-center rounded-full bg-black/75 font-semibold text-white tabular-nums"
            >
              {chapterCount}
            </span>
          )}
          {savedInLibrary && !unavailable && (
            <span className="pointer-events-none absolute bottom-2 right-2 z-10 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full border border-border bg-background/95 px-2 py-1 font-medium text-foreground shadow-sm" style={{ fontSize: `${fontPx(11, 9)}px` }}>
              <Check aria-hidden="true" style={{ width: `${px(12, 10)}px`, height: `${px(12, 10)}px` }} />
              <span className="truncate">{t('En biblioteca')}</span>
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
          onClick={handleSelect}
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
