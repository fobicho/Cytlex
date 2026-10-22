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
  },
  {
    id: 'esmeralda',
    name: 'Esmeralda',
    desc: 'Verde',
    swatch: { dark: ['#131b18', '#34b283'], light: ['#f2f8f5', '#2d8665'] }
  },
  {
    id: 'violeta',
    name: 'Violeta',
    desc: 'Morado',
    swatch: { dark: ['#16121c', '#9a62da'], light: ['#f7f4fa', '#763bba'] }
  },
  {
    id: 'rosa',
    name: 'Rosa',
    desc: 'Suave',
    swatch: { dark: ['#1b1317', '#db578e'], light: ['#fbf4f7', '#c63974'] }
  },
  {
    id: 'oceano',
    name: 'Océano',
    desc: 'Cian',
    swatch: { dark: ['#11191d', '#22a3c3'], light: ['#f0f7f9', '#2283a0'] }
  }
];

export const MODES = [
  { id: 'system', name: 'Sistema' },
  { id: 'light', name: 'Claro' },
  { id: 'dark', name: 'Oscuro' }
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const MODE_IDS = MODES.map((m) => m.id);
