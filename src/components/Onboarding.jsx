import { useState, useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Library, Compass, Settings as SettingsIcon, Minus, Plus, Check, LoaderCircle } from 'lucide-react';
import { THEMES, MODES } from '../lib/themes.js';
import { resolveMode, settings } from '../lib/settings.js';
import { cn } from '../lib/utils.js';
import { useScale } from '../lib/useScale.js';
import { Button } from './ui/button.jsx';

const STEPS = [
  {
    title: 'Bienvenido a Cytlex',
    body: '¡Bienvenido lector, que gusto tenerte por aquí! Espero que este mini tutorial introductorio te sirva para entender el funcionamiento de Cytlex, aunque tampoco es tan difícil de usar..\n\nSi es tu primera vez entrando, te recomiendo completarlo, ya que te ayudará a familiarizarte con la aplicación. Siempre podrás saltar este tutorial presionando el botón **Saltar tutorial** abajo a la izquierda.'
  },
  {
    title: 'Un paseo por la app'
  },
  {
    title: 'Configura la apariencia',
    body: 'Selecciona tus colores favoritos y la escala a la que quieras ver todo. Puedes cambiarlo cuando quieras en **Ajustes**.'
  },
  {
    title: 'Repositorio de extensiones',
    body: 'Agrega el repositorio oficial para instalar extensiones desde **Explorar**. También puedes omitir este paso y agregar otro repositorio compatible más adelante, aunque en lo personal recomiendo instalar este.\n\nAlgunas extensiones pueden ofrecer contenido para adultos **(+18)**. Para mostrarlas, tendrás que confirmar que eres mayor de edad en **Ajustes -> Extensiones**.'
  },
  {
    title: 'Todo listo',
    body: '¡Ya estás preparado para empezar con tus lecturas! Instala las extensiones que quieras usar, explora el catálogo y descubre los próximos mangas que quieras leer.\n\nCytlex nace como un proyecto pasional, sin fines de lucro y 100% por y para la comunidad. Si luego de usarla consideras que es una buena aplicación, puedes aportar la cantidad que desees de manera voluntaria, para seguir dándole mantención constante. <3'
  }
];

const DEFAULT_EXTENSION_REPOSITORY = 'https://fobicho.github.io/Cytlex/index.json';
const WALKTHROUGH_VIEWS = [
  { id: 'biblioteca', label: 'Biblioteca', icon: Library, desc: 'Organiza tus mangas de manera sencilla en distintas categorías.' },
  { id: 'explorar', label: 'Explorar', icon: Compass, desc: 'Busca tus mangas preferidos y administra tus extensiones.' },
  { id: 'ajustes', label: 'Ajustes', icon: SettingsIcon, desc: 'Configura la aplicación a tu gusto, con una amplia gama de modificaciones distintas.' }
];
const SETTINGS_SECTION_IDS = ['apariencia', 'biblioteca', 'lector', 'categorias', 'extensiones', 'notificaciones', 'seguimiento', 'respaldo', 'atajos'];
const STEP_CONTENT_VARIANTS = {
  enter: (direction) => ({ opacity: 0, x: direction === 0 ? 0 : direction > 0 ? 24 : -24 }),
  center: { opacity: 1, x: 0 },
  exit: (direction) => ({ opacity: 0, x: direction === 0 ? 0 : direction > 0 ? -24 : 24 })
};

export default function Onboarding({ onDone, onExitStart, onRevealApp, onHideApp, enteringWithSplash = false }) {
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => settings.get().mode);
  const [exiting, setExiting] = useState(false);
  const [walkthroughView, setWalkthroughView] = useState('biblioteca');
  const [repoUrl, setRepoUrl] = useState(() => (settings.get().extIndexUrl || '').trim());
  const [addingRepository, setAddingRepository] = useState(false);
  const previousStep = useRef(step);
  const hasMounted = useRef(false);
  const scale = useScale();
  const reduceMotion = useReducedMotion();
  const skipDotAnimation = Math.abs(step - previousStep.current) === 1 && Math.max(step, previousStep.current) <= 2;
  const stepDirection = step < previousStep.current ? -1 : 1;
  const motionDirection = reduceMotion ? 0 : stepDirection;
  const firstCardEntrance = enteringWithSplash && !hasMounted.current;

  useEffect(() => {
    hasMounted.current = true;
  }, []);

  useEffect(() => {
    previousStep.current = step;
  }, [step]);

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
      const routes = {
        biblioteca: '#/biblioteca',
        explorar: '#/explorar?tab=mangas',
        ajustes: `#/ajustes?tutorial=1&section=${SETTINGS_SECTION_IDS[0]}`
      };
      window.location.hash = routes[walkthroughView];
    } else {
      if (typeof onHideApp === 'function') onHideApp();
    }
  }, [step, walkthroughView, onRevealApp, onHideApp]);

  useEffect(() => {
    const syncWalkthroughView = () => {
      const path = window.location.hash.slice(1).split('?')[0];
      if (path === '/biblioteca') setWalkthroughView('biblioteca');
      else if (path === '/explorar') setWalkthroughView('explorar');
      else if (path === '/ajustes') setWalkthroughView('ajustes');
    };
    window.addEventListener('hashchange', syncWalkthroughView);
    return () => window.removeEventListener('hashchange', syncWalkthroughView);
  }, []);

  useEffect(() => {
    if (step !== 1 || walkthroughView === 'biblioteca') return;
    let tab = 'mangas';
    let sectionIndex = 0;
    const timer = window.setInterval(() => {
      if (walkthroughView === 'explorar') {
        tab = tab === 'mangas' ? 'extensiones' : 'mangas';
        window.location.hash = `#/explorar?tab=${tab}`;
      } else {
        sectionIndex = (sectionIndex + 1) % SETTINGS_SECTION_IDS.length;
        window.location.hash = `#/ajustes?tutorial=1&section=${SETTINGS_SECTION_IDS[sectionIndex]}`;
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [step, walkthroughView]);

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
  const isRepository = step === 3;
  const isReady = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;
  const uiScale = settings.get().uiScale || 1;
  const hasOfficialRepository = repoUrl === DEFAULT_EXTENSION_REPOSITORY;
  const hasOtherRepository = !!repoUrl && !hasOfficialRepository;

  return (
    <motion.div
      className={`fixed inset-0 z-[60] p-4 transition-colors duration-300 ${step === 1 ? 'pointer-events-none bg-transparent' : 'pointer-events-auto bg-background flex items-center justify-center'}`}
      initial={{ y: '0%' }}
      animate={{ y: exiting ? '-100%' : '0%' }}
      transition={{ duration: exiting ? 0.8 : 0, ease: exiting ? [0.76, 0, 0.24, 1] : 'linear' }}
    >
      <LayoutGroup id="onboarding-surfaces">
        <AnimatePresence mode="wait">
          {step !== 1 && (
            <motion.div
              key="step-card"
              layoutId="onboarding-container"
              layout="position"
              className="relative w-full max-w-3xl pointer-events-auto"
              initial={{
                opacity: 0,
                transform: `translateY(${reduceMotion ? '0px' : firstCardEntrance ? '100vh' : '0px'})`
              }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
              exit={{ opacity: 0 }}
              transition={{
                duration: firstCardEntrance && !reduceMotion ? 0.8 : 0.3,
                ease: firstCardEntrance && !reduceMotion ? [0.76, 0, 0.24, 1] : [0.22, 1, 0.36, 1],
                layout: { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
              }}
              style={{ transformOrigin: 'center' }}
            >
              <motion.div
                animate={{ transform: `scale(${scale})` }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="relative w-full overflow-hidden rounded-3xl border border-border bg-card text-card-foreground transition-colors duration-300"
                style={{ transformOrigin: 'center' }}
              >
          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <AnimatePresence mode="wait" custom={motionDirection}>
              <motion.div
                key={step}
                custom={motionDirection}
                variants={STEP_CONTENT_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="h-[320px]"
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
                  <div className={cn('mb-6', step >= 2 && 'mb-2')}>
                    <h2 className="text-2xl font-semibold tracking-tight font-display">{STEPS[step].title}</h2>
                  </div>
                )}

                {STEPS[step].body && (
                  <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-line">
                    {STEPS[step].body.split(/(\*\*[^*]+\*\*|Cytlex)/g).map((part, i) => {
                      if (part.startsWith('**') && part.endsWith('**')) {
                        return <strong key={i}>{part.slice(2, -2)}</strong>;
                      }
                      return part === 'Cytlex' ? <span key={i} className="font-display font-semibold">{part}</span> : part;
                    })}
                  </p>
                )}

                {isReady && (
                  <Button
                    size="sm"
                    className="mt-5"
                    onClick={() => {
                      const url = 'https://ko-fi.com/fobicho';
                      if (window.cytlex?.openExternal) window.cytlex.openExternal(url);
                      else window.open(url, '_blank', 'noopener');
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4 mr-1.5">
                      <path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298" />
                    </svg>
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
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-2">
                      {MODES.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => applyTheme(theme, m.id)}
                          className={cn(
                            'flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all',
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
                              'group flex items-center gap-3 rounded-xl border px-3 py-1.5 text-left transition-all',
                              selected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:bg-muted/40'
                            )}
                          >
                            <div className="h-7 w-7 rounded-full overflow-hidden shrink-0 flex">
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

                {isTheme && (
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-2">
                    <span className="shrink-0 text-sm font-medium">Tamaño de la interfaz</span>
                    <button
                      type="button"
                      onClick={() => settings.set({ uiScale: Math.max(0.8, uiScale - 0.05) })}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Reducir escala"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      type="range"
                      min={0.8}
                      max={1.2}
                      step={0.05}
                      value={uiScale}
                      onChange={(e) => settings.set({ uiScale: Number(e.target.value) })}
                      aria-label="Tamaño de la interfaz"
                      className="h-1.5 min-w-0 flex-1 cursor-pointer rounded-full bg-muted accent-primary"
                    />
                    <button
                      type="button"
                      onClick={() => settings.set({ uiScale: Math.min(1.2, uiScale + 0.05) })}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Aumentar escala"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <span className="min-w-10 text-right text-sm text-muted-foreground">
                      {Math.round(uiScale * 100)}%
                    </span>
                  </div>
                )}

                {isRepository && (
                  <div className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            Repositorio oficial de{' '}
                            <span className="inline-flex items-center gap-1 align-middle">
                              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-4 w-4 rounded-[4px]" />
                              <span className="font-display font-semibold tracking-tight">Cytlex</span>
                            </span>
                          </p>
                          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            {DEFAULT_EXTENSION_REPOSITORY}
                          </p>
                          {hasOtherRepository && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Ya hay otro repositorio configurado; al continuar con este se reemplazará.
                            </p>
                          )}
                        </div>
                        <Button
                          className="shrink-0"
                          disabled={hasOfficialRepository || addingRepository}
                          onClick={() => {
                            setAddingRepository(true);
                            setTimeout(() => {
                              settings.set({ extIndexUrl: DEFAULT_EXTENSION_REPOSITORY });
                              setRepoUrl(DEFAULT_EXTENSION_REPOSITORY);
                              setAddingRepository(false);
                            }, 800);
                          }}
                        >
                          {addingRepository ? (
                            <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Agregando…</>
                          ) : hasOfficialRepository ? (
                            <><Check className="mr-2 h-4 w-4" />Repositorio agregado</>
                          ) : hasOtherRepository ? 'Usar repositorio oficial' : 'Agregar repositorio oficial'}
                        </Button>
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
                  transition={{ duration: skipDotAnimation ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
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
              <Button size="sm" className="w-28" onClick={next}>
                {step === STEPS.length - 1 ? 'Comenzar' : 'Siguiente'}
                {step < STEPS.length - 1 && <ArrowRight className="h-4 w-4 ml-1" />}
              </Button>
            </div>
          </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="walkthrough-panel"
              layoutId="onboarding-container"
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: 0.25, ease: 'easeOut' },
                layout: { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
              }}
              className="pointer-events-auto fixed bottom-10 left-1/2 w-[min(92vw,40rem)]"
              style={{ translate: '-50% 0' }}
            >
              <motion.div
                animate={{ transform: `scale(${scale})` }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-2xl border border-border bg-card text-card-foreground shadow-lg transition-colors duration-300"
                style={{ transformOrigin: 'center bottom' }}
              >
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {WALKTHROUGH_VIEWS.map(({ id, label, icon: Icon }) => {
                  const selected = walkthroughView === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setWalkthroughView(id)}
                      aria-pressed={selected}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-xl border px-3 py-3 text-center transition-all',
                        selected
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted/40'
                      )}
                    >
                      <Icon className="h-6 w-6" />
                      <span className="text-sm font-medium">{label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">
                {WALKTHROUGH_VIEWS.find(({ id }) => id === walkthroughView)?.desc}
              </p>
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
                      transition={{ duration: skipDotAnimation ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
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
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </motion.div>
  );
}
