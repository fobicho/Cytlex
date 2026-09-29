import { useEffect, useState } from 'react';
import { cn } from '../lib/utils.js';
import { api } from '../lib/api.js';

const prefetched = new Set();
function prefetch(url, sourceId) {
  const key = `${sourceId}|${url}`;
  if (!url || prefetched.has(key)) return;
  prefetched.add(key);
  api.prefetchDetail(url, sourceId);
}

export default function MangaCard({ m, progress, sourceId = 'leercapitulo', unavailable = false, minimal = false, from = 'biblioteca' }) {
  const detailHash = `#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sourceId)}&from=${from}`;
  const status = m.status || m.lastChapter || (progress ? 'En progreso' : '');
  const linkCls = cn(unavailable && 'pointer-events-none');
  const linkA11y = unavailable ? { 'aria-disabled': true, tabIndex: -1 } : {};

  const localCover = m.coverLocal?.startsWith('data:') ? m.coverLocal : '';
  const [src, setSrc] = useState(localCover || m.cover);
  useEffect(() => {
    const local = m.coverLocal?.startsWith('data:') ? m.coverLocal : '';
    setSrc(local || m.cover);
  }, [m.coverLocal, m.cover]);

  return (
    <div className={cn(unavailable && 'opacity-60')}>
      <a
        href={detailHash}
        aria-label={m.title}
        title={m.title}
        className={linkCls}
        onMouseEnter={() => !unavailable && prefetch(m.url, sourceId)}
        onFocus={() => !unavailable && prefetch(m.url, sourceId)}
        {...linkA11y}
      >
        <div className="relative rounded-xl overflow-hidden bg-muted/50 border border-border/50 shadow-sm">
          {src ? (
            <img
              loading="lazy"
              src={src}
              alt={m.title}
              referrerPolicy="no-referrer"
              onError={() => {
                if (src !== m.cover) setSrc(m.cover);
                else setSrc('');
              }}
              className="w-full h-full aspect-[2/3] object-cover block"
            />
          ) : (
            <div className="w-full aspect-[2/3] animate-pulse bg-muted/40" />
          )}
          {unavailable ? (
            <span className="absolute inset-0 grid place-items-center bg-black/60">
              <span className="rounded-full bg-black/80 px-2.5 py-1 text-[10px] font-semibold text-white">
                Fuente no instalada
              </span>
            </span>
          ) : (
            !minimal && status && (
              <span className="absolute left-2 bottom-2 inline-flex items-center gap-1.5 max-w-[calc(100%-16px)] rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate">{String(status).slice(0, 28)}</span>
              </span>
            )
          )}
        </div>
      </a>
      <div className="pt-2 px-1">
        <a
          className={cn('block text-[13.5px] font-semibold leading-snug line-clamp-2', linkCls)}
          href={detailHash}
          title={m.title}
          {...linkA11y}
        >
          {m.title}
        </a>
        {!minimal && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {unavailable
              ? 'Fuente no instalada'
              : ([m.type, m.lastChapter].filter(Boolean).join(' · ') || '\u00a0')}
          </div>
        )}
      </div>
    </div>
  );
}
