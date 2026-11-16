import { useState } from 'react';
import { cn } from '../lib/utils.js';

const sourceIconLoads = new Map();
const sourceIconResults = new Map();

export function getSourceIconResult(src) {
  return sourceIconResults.has(src) ? sourceIconResults.get(src) : null;
}

export function preloadSourceIcon(src) {
  if (!src || typeof Image === 'undefined') return Promise.resolve(!src);
  if (sourceIconLoads.has(src)) return sourceIconLoads.get(src);

  const load = new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = async (ok) => {
      if (settled) return;
      settled = true;
      if (ok && typeof image.decode === 'function') {
        try { await image.decode(); } catch { ok = false; }
      }
      resolve(ok);
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;
    if (image.complete) finish(image.naturalWidth > 0);
  });
  sourceIconLoads.set(src, load);
  load.then((ok) => {
    sourceIconResults.set(src, ok);
    if (!ok) sourceIconLoads.delete(src);
  });
  return load;
}

export function SourceBadge({ m, className, style }) {
  const [ok, setOk] = useState(true);
  return (
    <div
      className={cn(
        'source-badge w-7 h-7 rounded-lg bg-secondary text-secondary-foreground grid place-items-center text-xs font-bold shrink-0 overflow-hidden',
        className
      )}
      style={style}
    >
      {m.icon && ok ? (
        <img src={m.icon} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setOk(false)} />
      ) : (
        (m.name?.[0] || '?').toUpperCase()
      )}
    </div>
  );
}
