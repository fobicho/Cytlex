import { useState, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Library, Compass, Settings as SettingsIcon, Coffee } from 'lucide-react';
import { THEMES, MODES } from '../lib/themes.js';
import { resolveMode, settings } from '../lib/settings.js';
import { cn } from '../lib/utils.js';
import { useScale } from '../lib/useScale.js';
import { Button } from './ui/button.jsx';

const STEPS = [
  {
    title: 'Bienvenido a Cytlex',
    body: '¡Buenas, lector! Es un gusto verte por aquí, espero que este mini tutorial te sirva para entender el funcionamiento de mi aplicación, aunque tampoco es tan difícil de usar..\n\nSiempre puedes saltar este tutorial presionando el botón \'Saltar tutorial\' abajo a la izquierda.'
  },
  {
    title: 'Un paseo por la app',
    body: 'Toca cada sección para ver qué puedes hacer en ella.',
    walkthrough: [
      { id: 'biblioteca', label: 'Biblioteca', icon: Library, desc: 'Organiza tus mangas favoritos en base a las categorías que estimes convenientes.' },
      { id: 'explorar', label: 'Explorar', icon: Compass, desc: 'Busca tus mangas preferidos y administra tus extensiones.' },
      { id: 'ajustes', label: 'Ajustes', icon: SettingsIcon, desc: 'Configura la aplicación a tu gusto, con una amplia gama de modificaciones distintas.' }
    ]
  },
  {
    title: 'Elige tu tema',
    body: 'Selecciona tus colores favoritos. Puedes cambiarlo cuando quieras en \'Ajustes\'.'
  },
  {
    title: 'Todo listo',
    body: '¡Ya estás preparado para empezar con tus lecturas! Solo no olvides agregar el repositorio con las distintas extensiones en \'Ajustes\'.\n\nSi luego de usarla te gusta mi aplicación, por favor considera aportar la cantidad que desees, de manera totalmente voluntaria, para seguir dándole mantención. <3'
  }
];

export default function Onboarding({ onDone, onExitStart, onRevealApp, onHideApp, enteringWithSplash = false }) {
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => settings.get().mode);
  const [exiting, setExiting] = useState(false);
  const [walk, setWalk] = useState(0);
  const scale = useScale();
  const reduceMotion = useReducedMotion();

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

  useEffect(() => {
    if (step === 1) {
      if (typeof onRevealApp === 'function') onRevealApp();
      const pages = ['/biblioteca', '/explorar', '/ajustes'];
      window.location.hash = `#${pages[walk] || pages[0]}`;
    } else {
      if (typeof onHideApp === 'function') onHideApp();
    }
  }, [step, walk, onRevealApp, onHideApp]);

  const applyTheme = useCallback((t, m) => {
    const run = () => {
      flushSync(() => {
        setTheme(t);
        setMode(m);
        settings.set({ theme: t, mode: m });
      });
    };
    if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
      document.startViewTransition(run);
    } else {
      run();
    }
  }, []);

  const finish = useCallback(() => {
    settings.set({ tutorialSeen: true });
    window.location.hash = '#/biblioteca';
    if (typeof onExitStart === 'function') onExitStart();
    setExiting(true);
  }, [onExitStart]);

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const isTheme = step === 2;
  const isReady = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <motion.div
      className={`fixed inset-0 z-[60] p-4 transition-colors duration-300 ${step === 1 ? 'bg-transparent' : 'bg-background flex items-center justify-center'}`}
      initial={{ y: '0%' }}
      animate={{ y: exiting ? '-100%' : '0%' }}
      transition={{ duration: exiting ? 0.8 : 0, ease: exiting ? [0.76, 0, 0.24, 1] : 'linear' }}
    >
      {step !== 1 && (
        <motion.div
          className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card text-card-foreground transition-colors duration-300 pointer-events-auto"
          initial={{
            opacity: 0,
            transform: `translateY(${reduceMotion ? '0vh' : enteringWithSplash ? '100vh' : '24px'}) scale(${scale})`
          }}
          animate={{ opacity: 1, transform: `translateY(0vh) scale(${scale})` }}
          transition={{
            duration: enteringWithSplash && !reduceMotion ? 0.8 : 0.3,
            ease: enteringWithSplash && !reduceMotion ? [0.76, 0, 0.24, 1] : [0.22, 1, 0.36, 1]
          }}
          style={{ transformOrigin: 'center' }}
        >
          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="min-h-[320px]"
              >
                {step === 0 ? (
                  <div className="mb-6 flex items-center gap-3">
                    <span className="text-2xl font-semibold tracking-tight font-display">Bienvenido a</span>
                    <motion.div
                      className="flex items-center gap-3"
                      animate={{ y: [0, -5, 0], rotate: [0, -1.5, 1.5, 0] }}
                      transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <svg viewBox="0 0 512 512" width="48" height="48" className="shrink-0 rounded-xl" role="img" aria-label="Cytlex">
                        <rect width="512" height="512" rx="112" fill="#ffffff" />
                        <text x="256" y="244" fill="#ec4899" fontSize="340" fontWeight="700" textAnchor="middle" dominantBaseline="central" fontFamily="'Noto Sans CJK JP','Yu Gothic UI','Yu Gothic','Meiryo','MS Gothic',sans-serif">粘</text>
                      </svg>
                      <h2 className="text-2xl font-semibold tracking-tight font-display">Cytlex</h2>
                    </motion.div>
                  </div>
                ) : (
                  <div className="mb-6">
                    <h2 className="text-2xl font-semibold tracking-tight font-display">{STEPS[step].title}</h2>
                  </div>
                )}

                {STEPS[step].body && (
                  <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-line">{STEPS[step].body}</p>
                )}

                {isReady && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-5"
                    onClick={() => {
                      const url = 'https://ko-fi.com/fobicho';
                      if (window.cytlex?.openExternal) window.cytlex.openExternal(url);
                      else window.open(url, '_blank', 'noopener');
                    }}
                  >
                    <Coffee className="h-4 w-4 mr-1.5" />
                    Apoyar en Ko-fi
                  </Button>
                )}

                {STEPS[step].bullets && (
                  <ul className="mt-4 space-y-2">
                    {STEPS[step].bullets.map((b, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.05 * i, duration: 0.25 }}
                        className="flex items-start gap-3 text-sm text-muted-foreground"
                      >
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                        <span className="leading-relaxed">{b}</span>
                      </motion.li>
                    ))}
                  </ul>
                )}

                {isTheme && (
                  <div className="mt-6 space-y-5">
                    <div className="flex gap-2">
                      {MODES.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => applyTheme(theme, m.id)}
                          className={cn(
                            'flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all',
                            mode === m.id
                              ? 'border-primary bg-primary/5 text-foreground'
                              : 'border-border text-muted-foreground hover:bg-muted/40'
                          )}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {THEMES.map((t) => {
                        const sw = t.swatch[resolveMode(mode)] || t.swatch.dark;
                        const selected = theme === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => applyTheme(t.id, mode)}
                            className={cn(
                              'group flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all',
                              selected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:bg-muted/40'
                            )}
                          >
                            <div className="h-10 w-10 rounded-full overflow-hidden shrink-0 flex">
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

          <div className="flex flex-col gap-4 border-t border-border px-6 py-4 sm:grid sm:grid-cols-3 sm:items-center sm:px-10">
            <div className="flex justify-start">
              <Button variant="outline" size="sm" onClick={finish}>
                Saltar tutorial
              </Button>
            </div>

            <div className="flex items-center justify-center gap-2">
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

            <div className="flex justify-end gap-2">
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
      )}

      <AnimatePresence>
        {step === 1 && (
          <motion.div
            key="walkthrough-panel"
            initial={{ opacity: 0, y: 24, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 24, x: '-50%' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto fixed bottom-10 left-1/2 w-[min(92vw,40rem)] rounded-2xl border border-border bg-card text-card-foreground shadow-lg transition-colors duration-300"
            style={{ zoom: scale }}
          >
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {STEPS[1].walkthrough.map((w, i) => {
                  const Icon = w.icon;
                  const on = walk === i;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setWalk(i)}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-xl border px-3 py-3 text-center transition-all',
                        on
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted/40'
                      )}
                    >
                      <Icon className="h-6 w-6" />
                      <span className="text-sm font-medium">{w.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">{STEPS[1].walkthrough[walk].desc}</p>
              <div className="grid grid-cols-3 items-center gap-3 pt-1">
                <div className="flex justify-start">
                  <Button variant="outline" size="sm" onClick={finish}>
                    Saltar tutorial
                  </Button>
                </div>
                <div className="flex items-center justify-center gap-2">
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
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={back}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Atrás
                  </Button>
                  <Button size="sm" onClick={next}>
                    Siguiente
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
