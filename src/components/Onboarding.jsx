import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { THEMES, MODES } from '../lib/themes.js';
import { settings } from '../lib/settings.js';
import { cn } from '../lib/utils.js';
import { Button } from './ui/button.jsx';

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

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => settings.get().mode);

  const applyTheme = useCallback((t, m) => {
    setTheme(t);
    setMode(m);
    settings.set({ theme: t, mode: m });
  }, []);

  const finish = useCallback(() => {
    settings.set({ tutorialSeen: true });
    if (typeof onDone === 'function') onDone();
  }, [onDone]);

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const isTheme = step === 2;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-full max-w-2xl rounded-2xl border border-border bg-card text-card-foreground shadow-xl overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <div className="flex-1">
                <p className="font-display text-xl font-semibold tracking-tight">Cytlex</p>
                <p className="text-xs text-muted-foreground">Tutorial inicial · paso {step + 1} de {STEPS.length}</p>
              </div>
              <button onClick={finish} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Saltar
              </button>
            </div>

            <div className="px-6 py-6 min-h-[260px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <h2 className="text-xl font-semibold tracking-tight mb-2">{STEPS[step].title}</h2>
                  {STEPS[step].body && <p className="text-sm text-muted-foreground leading-relaxed">{STEPS[step].body}</p>}
                  {STEPS[step].bullets && (
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {STEPS[step].bullets.map((b, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {isTheme && (
                    <div className="mt-4 space-y-4">
                      <div className="flex gap-2">
                        {MODES.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => applyTheme(theme, m.id)}
                            className={cn(
                              'flex-1 rounded-lg border px-3 py-2 text-sm transition-colors',
                              mode === m.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'
                            )}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {THEMES.map((t) => {
                          const sw = t.swatch[mode] || t.swatch.dark;
                          const selected = theme === t.id;
                          return (
                            <button
                              key={t.id}
                              onClick={() => applyTheme(t.id, mode)}
                              className={cn(
                                'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                                selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                              )}
                            >
                              <div className="h-8 w-8 rounded-full border border-border overflow-hidden shrink-0 flex">
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

            <div className="px-6 py-4 border-t border-border flex items-center justify-between">
              <div className="flex gap-1.5">
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/40'
                    )}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button variant="outline" size="sm" onClick={back}>
                    Atrás
                  </Button>
                )}
                <Button size="sm" onClick={next}>
                  {step === STEPS.length - 1 ? 'Comenzar' : 'Siguiente'}
                </Button>
              </div>
            </div>
          </motion.div>
    </div>
  );
}