export const THEMES = [
  {
    id: 'default',
    name: 'Predeterminado',
    desc: 'Azul frío',
    swatch: { dark: ['#09090b', '#3b82f6'], light: ['#ffffff', '#2563eb'] }
  },
  {
    id: 'beige',
    name: 'Beige pastel',
    desc: 'Cálido',
    swatch: { dark: ['#241d14', '#c9a06a'], light: ['#f7f1e6', '#a67c52'] }
  }
];

export const MODES = [
  { id: 'dark', name: 'Oscuro' },
  { id: 'light', name: 'Claro' }
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const MODE_IDS = MODES.map((m) => m.id);
