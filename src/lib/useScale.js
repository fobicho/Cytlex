import { useEffect, useState } from 'react';

export const SCALE_BASE_W = 1280;
export const SCALE_BASE_H = 860;
export const SCALE_MIN = 0.78;
export const SCALE_MAX = 1.35;

export function computeScale(min = SCALE_MIN, max = SCALE_MAX) {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth / SCALE_BASE_W;
  const h = window.innerHeight / SCALE_BASE_H;
  return Math.min(Math.max(Math.min(w, h), min), max);
}

export function useScale(min = SCALE_MIN, max = SCALE_MAX) {
  const [scale, setScale] = useState(() => computeScale(min, max));

  useEffect(() => {
    const update = () => setScale(computeScale(min, max));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [min, max]);

  return scale;
}

export function px(value, scale, min = 1) {
  return `${Math.max(min, Math.round(value * scale))}px`;
}