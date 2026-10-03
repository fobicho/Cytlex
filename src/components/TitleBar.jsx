import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { appWindow } from '../lib/appWindow.js';
import { cn } from '../lib/utils.js';

const DRAG = { WebkitAppRegion: 'drag' };
const NO_DRAG = { WebkitAppRegion: 'no-drag' };

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized);
    return appWindow.onMaximizedChange(setMaximized);
  }, []);

  const btn =
    'grid place-items-center w-11 h-full text-muted-foreground transition-colors';

  return (
    <header
      style={DRAG}
      className="flex items-stretch h-9 shrink-0 bg-sidebar border-b border-border select-none"
    >
      <div className="flex items-center gap-2 px-4">
        <div className="w-5 h-5 rounded-md bg-white grid place-items-center font-bold text-pink-500 text-[13px] leading-none select-none">
          粘
        </div>
        <span className="font-display text-xs font-semibold tracking-tight text-sidebar-foreground">Cytlex</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-stretch" style={NO_DRAG}>
        <button
          type="button"
          className={cn(btn, 'hover:bg-accent hover:text-accent-foreground')}
          aria-label="Minimizar"
          title="Minimizar"
          onClick={() => appWindow.minimize()}
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          className={cn(btn, 'hover:bg-accent hover:text-accent-foreground')}
          aria-label={maximized ? 'Restaurar' : 'Maximizar'}
          title={maximized ? 'Restaurar' : 'Maximizar'}
          onClick={() => appWindow.toggleMaximize()}
        >
          {maximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          className={cn(btn, 'hover:bg-destructive hover:text-destructive-foreground')}
          aria-label="Cerrar"
          title="Cerrar"
          onClick={() => appWindow.close()}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
