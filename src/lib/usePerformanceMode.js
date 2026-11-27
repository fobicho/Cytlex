import { useSyncExternalStore } from 'react';
import { settings } from './settings.js';

const subscribe = (listener) => settings.subscribe(listener);
const getSnapshot = () => settings.get().performanceMode;

export function usePerformanceMode() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
