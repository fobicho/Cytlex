import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, BookOpen, Palette, Rocket, ArrowLeft, ArrowRight } from 'lucide-react';
import { THEMES, MODES } from '../lib/themes.js';
import { settings } from '../lib/settings.js';
import { cn } from '../lib/utils.js';
import { Button } from './ui/button.jsx';

const STEP_ICONS = [Sparkles, BookOpen, Palette, Rocket];

const STEPS = [
  {
    title: 'Bienvenido a Cytlex',
    body: 'Tu lector de manga de escritorio. Organiza tu biblioteca, lee en línea o descargado y sincroniza tu progreso sin salir de la app.'
  },
  {
    title: 'Lo esencial',
    bullets: [
      'Biblioteca: favoritos por categoría, portadas y contador de no leídos.',
      'Explorar: busca en todas tus fuentes y extensiones a la vez.',
      'Lector: modo vertical o paginado, zoom y descarga de páginas.',
      'Seguimiento: vincula con AniList y sincroniza tu progreso automáticamente.',
      'Extensiones: instala, actualiza o quita fuentes desde el catálogo.'
    ]
  },
  {
    title: 'Elige tu tema',
    body: 'Selecciona un tema y un modo. Puedes cambiarlo cuando quieras en Ajustes.'
  },
  {
    title: 'Todo listo',
    body: 'Empieza agregando mangas a tu biblioteca desde Explorar. Puedes personalizar el tema y preferencias en Ajustes cuando quieras.'
  }
];

export default function Onboarding({ onDone, onExitStart }) {
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => settings.get().mode);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    document.body.classList.add('tutorial-open');
    return () => document.body.classList.remove('tutorial-open');
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => {
      if (typeof onDone === 'function') onDone();
    }, 800);
    return () => clearTimeout(t);
  }, [exiting, onDone]);

  const applyTheme = useCallback((t, m) => {
    const run = () => {
      setTheme(t);
      setMode(m);
      settings.set({ theme: t, mode: m });
    };
    if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
      document.startViewTransition(run);
    } else {
      run();
    }
  }, []);

  const finish = useCallback(() => {
    settings.set({ tutorialSeen: true });
    if (typeof onExitStart === 'function') onExitStart();
    setExiting(true);
  }, [onExitStart]);

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const isTheme = step === 2;
  const Icon = STEP_ICONS[step] || Sparkles;
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-md p-4 transition-colors duration-300"
      initial={{ y: '0%' }}
      animate={{ y: exiting ? '-100%' : '0%' }}
      transition={{ duration: exiting ? 0.8 : 0, ease: exiting ? [0.76, 0, 0.24, 1] : 'linear' }}
    >
      <motion.div
        className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-border/60 bg-card text-card-foreground shadow-2xl shadow-black/20 transition-colors duration-300"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Top progress bar */}
        <div className="h-1 w-full bg-muted">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>

        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="min-h-[300px]"
            >
              <div className="mb-6 flex items-center gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
                  <Icon className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Paso {step + 1} de {STEPS.length}
                  </p>
                  <h2 className="text-2xl font-semibold tracking-tight font-display">{STEPS[step].title}</h2>
                </div>
              </div>

              {STEPS[step].body && (
                <p className="text-base text-muted-foreground leading-relaxed">{STEPS[step].body}</p>
              )}

              {STEPS[step].bullets && (
                <ul className="mt-4 space-y-3">
                  {STEPS[step].bullets.map((b, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i, duration: 0.25 }}
                      className="flex items-start gap-3 rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
                    >
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                      <span className="leading-relaxed">{b}</span>
                    </motion.li>
                  ))}
                </ul>
              )}

              {isTheme && (
                <div className="mt-6 space-y-5">
                  <div className="flex gap-2 rounded-xl border border-border/50 bg-muted/30 p-1.5">
                    {MODES.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => applyTheme(theme, m.id)}
                        className={cn(
                          'flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                          mode === m.id
                            ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {THEMES.map((t) => {
                      const sw = t.swatch[mode] || t.swatch.dark;
                      const selected = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => applyTheme(t.id, mode)}
                          className={cn(
                            'group flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all',
                            selected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                              : 'border-border/60 hover:border-border hover:bg-muted/40'
                          )}
                        >
                          <div className="h-10 w-10 rounded-full border border-border/60 overflow-hidden shrink-0 flex shadow-inner">
                            <span className="flex-1" style={{ background: sw[0] }} />
                            <span className="flex-1" style={{ background: sw[1] }} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{t.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{t.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex flex-col gap-4 border-t border-border/60 bg-muted/20 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <button
            onClick={finish}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors self-start sm:self-auto"
          >
            Saltar tutorial
          </button>

          <div className="flex items-center gap-2">
            {STEPS.map((_, i) => (
              <motion.span
                key={i}
                animate={{ width: i === step ? 28 : 8 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  'h-2 rounded-full',
                  i === step ? 'bg-primary' : i < step ? 'bg-primary/40' : 'bg-muted-foreground/30'
                )}
              />
            ))}
          </div>

          <div className="flex gap-2 self-end sm:self-auto">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={back}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Atrás
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {step === STEPS.length - 1 ? 'Comenzar' : 'Siguiente'}
              {step < STEPS.length - 1 && <ArrowRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
