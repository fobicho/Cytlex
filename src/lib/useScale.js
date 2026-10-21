import { useEffect, useState } from 'react';

export const SCALE_BASE_W = 1280;
export const SCALE_BASE_H = 860;
export const SCALE_MIN = 0.78;
export const SCALE_MAX = 1.35;

import { settings } from './settings.js';

export function computeScale(min = SCALE_MIN, max = SCALE_MAX) {
  if (typeof window === 'undefined') return 0.95;
  const ui = settings.get().uiScale ?? 1;
  return Math.min(Math.max(ui * 0.95, min), max);
}

export function useScale(min = SCALE_MIN, max = SCALE_MAX) {
  const [scale, setScale] = useState(() => computeScale(min, max));

  useEffect(() => {
    const update = () => setScale(computeScale(min, max));
    update();
    const unsub = settings.subscribe(() => setScale(computeScale(min, max)));
    return () => unsub();
  }, [min, max]);

  return scale;
}

export function px(value, scale, min = 1) {
  return `${Math.max(min, Math.round(value * scale))}px`;
}