import { useEffect, useRef, useState } from 'react';
import { browserImageUrl } from './browserHttp.js';
import { discardLibraryCover, getLibraryCover, markLibraryCoverLoaded, preloadLibraryCover, requiresImageProxy, restoreLibraryCover } from './covers.js';

export function useLibraryCover(cover, { enabled = true, cachedOnly = false, cachedCover = '' } = {}) {
  const ref = useRef(null);
  const [loaded, setLoaded] = useState(null);
  const [failed, setFailed] = useState(null);
  const remote = /^https?:\/\//i.test(cover || '');
  const local = cachedCover || (enabled && (remote ? getLibraryCover(cover) : !cachedOnly && cover)) || '';
  const rejected = failed?.cover === cover ? failed.src : '';
  const src = local && local !== rejected ? local
    : loaded?.cover === cover && loaded?.cachedOnly === cachedOnly ? loaded.src : '';

  useEffect(() => {
    if (!enabled || !remote || (local && local !== rejected)) return undefined;
    let alive = true;
    const load = async () => {
      const cached = await restoreLibraryCover(cover);
      if (!alive) return;
      let url = cached !== rejected ? cached : '';
      if (!url && !cachedOnly && rejected !== cover) {
        const electron = Boolean(window.cytlex?.fetchImage);
        const needsProxy = browserImageUrl(cover) !== cover || (electron && requiresImageProxy(cover));
        if (needsProxy || electron) url = await preloadLibraryCover(cover, { web: true });
        if (!url && !needsProxy) url = cover;
      }
      if (alive) setLoaded({ cover, cachedOnly, src: url === rejected ? '' : url });
    };
    const target = ref.current;
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
  }, [cachedOnly, cover, enabled, local, rejected, remote]);

  const onError = () => {
    if (src && src === getLibraryCover(cover)) discardLibraryCover(cover, src);
    setFailed({ cover, src });
  };

  return { ref, src: enabled && src !== rejected ? src : '', onError, onLoad: () => markLibraryCoverLoaded(src) };
}
