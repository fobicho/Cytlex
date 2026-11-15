import { useEffect, useState } from 'react';

export function useResponsiveCoverSize(size) {
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobileLayout(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const coverSize = Math.min(Math.max(Number(size) || 160, 60), 260);
  return isMobileLayout ? Math.max(80, coverSize - 20) : coverSize;
}
