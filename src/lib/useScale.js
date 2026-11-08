export const SCALE_MIN = 0.78;
export const SCALE_MAX = 1.35;

const DEFAULT_SCALE = 0.95;

export function computeScale(min = SCALE_MIN, max = SCALE_MAX) {
  return Math.min(Math.max(DEFAULT_SCALE, min), max);
}

export function useScale(min = SCALE_MIN, max = SCALE_MAX) {
  return computeScale(min, max);
}

export function px(value, scale, min = 1) {
  return `${Math.max(min, Math.round(value * scale))}px`;
}
