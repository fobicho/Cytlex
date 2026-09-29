import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '../lib/utils.js';

const ToastCtx = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info
};

const TONES = {
  success: 'text-emerald-400',
  error: 'text-destructive',
  info: 'text-muted-foreground'
};

let seq = 0;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    ({ title, description, variant = 'info', duration = 4500 }) => {
      const id = ++seq;
      setItems((list) => [...list.slice(-3), { id, title, description, variant }]);
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss]
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = ICONS[t.variant] || Info;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl px-4 py-3"
              >
                <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', TONES[t.variant] || TONES.info)} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-snug">{t.title}</div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{t.description}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Cerrar"
                  className="shrink-0 grid place-items-center w-5 h-5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast fuera de ToastProvider');
  return ctx;
}
