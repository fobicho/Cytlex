import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { usePerformanceMode } from '../lib/usePerformanceMode.js';
import { ArrowLeft, ArrowRight, Library, Compass, Settings as SettingsIcon, Check, CheckCheck, LoaderCircle } from 'lucide-react';
import { THEMES, MODES } from '../lib/themes.js';
import { resolveMode, settings } from '../lib/settings.js';
import { useI18n } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';
import { useScale } from '../lib/useScale.js';
import { Button } from './ui/button.jsx';
import LanguageToggle from './LanguageToggle.jsx';
import { GENTLE_FLOAT_MOTION, GENTLE_FLOAT_TRANSITION } from './ui/empty-state.jsx';
import CytlexLogoMark from './CytlexLogoMark.jsx';
import Settings from '../pages/Settings.jsx';
import BackupProgress from './BackupProgress.jsx';
import { useLocation, useNavigate } from 'react-router-dom';

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
    body: 'Selecciona tus colores favoritos. Puedes cambiarlos cuando quieras en **Ajustes**.'
  },
  {
    title: 'Repositorio de extensiones',
    body: 'Agrega el repositorio oficial para instalar extensiones desde **Explorar**. También puedes omitir este paso y agregar otro repositorio compatible más adelante, aunque en lo personal recomiendo instalar este.\n\nAlgunas extensiones pueden ofrecer contenido para adultos **(+18)**. Para mostrarlas, tendrás que confirmar que eres mayor de edad en **Ajustes -> Extensiones**.'
  },
  {
    title: '¿Tienes tu respaldo preparado?',
    body: 'Si no es primera vez que usas Cytlex y tienes preparado tu respaldo, puedes importarlo con el botón debajo.\n\n¡Los usuarios de Mihon también son bienvenidos!'
  },
  {
    title: 'Todo listo',
    body: '¡Ya estás preparado para empezar con tus lecturas! Instala las extensiones que quieras usar, explora el catálogo y descubre los próximos mangas que quieras leer.\n\nCytlex nace como un proyecto pasional, sin fines de lucro y 100% por y para la comunidad. Si luego de usarla consideras que es una buena aplicación, puedes aportar la cantidad que desees de manera voluntaria, para seguir dándole mantención constante. <3'
  }
];

const DEFAULT_EXTENSION_REPOSITORY = 'https://fobicho.github.io/Cytlex/index.json';
const WALKTHROUGH_VIEWS = [
  { id: 'biblioteca', label: 'Biblioteca', icon: Library, desc: 'Organiza tus mangas de manera sencilla en distintas categorías.' },
  { id: 'explorar', label: 'Explorar', icon: Compass, desc: 'Busca tus mangas preferidos, administra tus extensiones y revisa las fuentes.' },
  { id: 'ajustes', label: 'Ajustes', icon: SettingsIcon, desc: 'Configura la aplicación a tu gusto, con una amplia gama de modificaciones distintas.' }
];
const SETTINGS_SECTION_IDS = ['apariencia', 'biblioteca', 'lector', 'categorias', 'extensiones', 'seguimiento', 'respaldo', 'atajos'];
const STEP_CONTENT_VARIANTS = {
  enter: (direction) => ({ opacity: 0, scale: direction === 0 ? 1 : direction > 0 ? 0.92 : 1.08 }),
  center: { opacity: 1, scale: 1, y: 0 },
  exit: (direction) => ({ opacity: 0, scale: direction === 0 ? 1 : direction > 0 ? 1.08 : 0.92 })
};

export default function Onboarding({ onDone, onExitStart, onRevealApp, onHideApp, onTutorialImportBusyChange, onTutorialImportProgressChange, tutorialImportBusy = false, tutorialImportProgress = null, enteringWithSplash = false, language = 'es', onLanguageChange }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => settings.get().mode);
  const [exiting, setExiting] = useState(false);
  const [walkthroughView, setWalkthroughView] = useState('biblioteca');
  const [repoUrl, setRepoUrl] = useState(() => (settings.get().extIndexUrl || '').trim());
  const [addingRepository, setAddingRepository] = useState(false);
  const [navigationVisible, setNavigationVisible] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const navigationTimer = useRef(null);
  const contentRef = useRef(null);
  const importControls = useRef(null);
  const previousStep = useRef(step);
  const hasMounted = useRef(false);
  const scale = useScale();
  const reduceMotion = usePerformanceMode();
  const stepDirection = step < previousStep.current ? -1 : 1;
  const motionDirection = reduceMotion ? 0 : stepDirection;
  const firstCardEntrance = enteringWithSplash && !hasMounted.current;

  useEffect(() => {
    hasMounted.current = true;
    return () => clearTimeout(navigationTimer.current);
  }, []);

  useEffect(() => {
    previousStep.current = step;
  }, [step]);

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [step]);

  useEffect(() => {
    document.documentElement.classList.add('tutorial-open');
    document.body.classList.add('tutorial-open');
    return () => {
      document.documentElement.classList.remove('tutorial-open');
      document.body.classList.remove('tutorial-open');
    };
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => {
      if (typeof onDone === 'function') onDone();
    }, 800);
    return () => clearTimeout(t);
  }, [exiting, onDone]);

  useEffect(() => {
    if (step === 0 && location.pathname !== '/') {
      navigate('/', { replace: true });
    }
  }, [step, location.pathname, navigate]);

  useEffect(() => {
    if (step === 1) {
      const routes = {
        biblioteca: '/biblioteca',
        explorar: '/explorar?tab=mangas',
        ajustes: `/ajustes?tutorial=1&section=${SETTINGS_SECTION_IDS[0]}`
      };
      navigate(routes[walkthroughView]);
    } else if (!exiting) {
      if (typeof onHideApp === 'function') onHideApp();
    }
  }, [step, walkthroughView, exiting, onHideApp, navigate]);

  useEffect(() => {
    if (location.pathname === '/biblioteca') setWalkthroughView('biblioteca');
    else if (location.pathname === '/explorar') setWalkthroughView('explorar');
    else if (location.pathname === '/ajustes') setWalkthroughView('ajustes');
  }, [location.pathname]);

  useEffect(() => {
    if (step !== 1 || walkthroughView === 'biblioteca') return;
    let tab = 'mangas';
    let sectionIndex = 0;
    const timer = window.setInterval(() => {
      if (walkthroughView === 'explorar') {
        tab = tab === 'mangas' ? 'extensiones' : 'mangas';
        navigate(`/explorar?tab=${tab}`);
      } else {
        sectionIndex = (sectionIndex + 1) % SETTINGS_SECTION_IDS.length;
        navigate(`/ajustes?tutorial=1&section=${SETTINGS_SECTION_IDS[sectionIndex]}`);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [step, walkthroughView, navigate]);

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
    navigate('/biblioteca');
    if (typeof onExitStart === 'function') onExitStart();
    setExiting(true);
  }, [onExitStart, navigate]);

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const isTheme = step === 2;
  const isRepository = step === 3;
  const isBackup = step === 4;
  const importingBackup = isBackup && tutorialImportBusy && !!tutorialImportProgress;
  const showImportStatus = isBackup && (importingBackup || !!importResult);
  const isReady = step === STEPS.length - 1;
  const showLanguageToggle = step !== 1 && navigationVisible;
  const progress = ((step + 1) / STEPS.length) * 100;
  const hasOfficialRepository = repoUrl === DEFAULT_EXTENSION_REPOSITORY;
  const hasOtherRepository = !!repoUrl && !hasOfficialRepository;
  return (
    <motion.div
      className={`onboarding-overlay fixed inset-0 z-[60] flex flex-col items-center overflow-hidden p-3 sm:p-4 transition-colors duration-300 ${step === 1 ? 'pointer-events-none bg-transparent' : 'pointer-events-auto bg-background'}`}
      initial={{ y: '0%' }}
      animate={{ y: exiting ? '-100%' : '0%' }}
      transition={{ duration: exiting ? 0.8 : 0, ease: exiting ? [0.76, 0, 0.24, 1] : 'linear' }}
    >
      <motion.div
        initial={false}
        animate={{ y: showLanguageToggle ? 0 : '-110vh' }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        className={`absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[80] sm:left-4 sm:top-[calc(env(safe-area-inset-top)+1rem)] ${step === 1 ? 'pointer-events-none' : 'pointer-events-auto'}`}
      >
        <LanguageToggle
          value={language}
          onChange={onLanguageChange}
          className="shadow-md"
        />
      </motion.div>
      <LayoutGroup id="onboarding-surfaces">
        <AnimatePresence mode="wait" custom={motionDirection}>
          {step !== 1 && (
            <motion.div
              key={`step-card-${step}`}
              layout={reduceMotion ? false : 'position'}
              custom={motionDirection}
              variants={STEP_CONTENT_VARIANTS}
              className="relative my-auto flex w-full max-w-3xl shrink-0 flex-col items-center pointer-events-auto"
              initial={firstCardEntrance ? { opacity: 0, y: reduceMotion ? 0 : '100vh' } : 'enter'}
              animate="center"
              exit="exit"
              onAnimationComplete={(definition) => {
                if (definition === 'center' && step === 0 && !navigationTimer.current) {
                  navigationTimer.current = setTimeout(() => setNavigationVisible(true), 1000);
                }
              }}
              transition={{
                duration: firstCardEntrance && !reduceMotion ? 0.8 : 0.2,
                ease: firstCardEntrance && !reduceMotion ? [0.76, 0, 0.24, 1] : [0.22, 1, 0.36, 1],
                layout: { duration: reduceMotion ? 0 : 0.24, ease: [0.23, 1, 0.32, 1] }
              }}
              style={{ transformOrigin: 'center' }}
            >
              <motion.div
                animate={{ transform: `scale(${scale})` }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1], layout: { duration: 0.28, ease: [0.77, 0, 0.175, 1] } }}
                className="onboarding-card relative flex h-auto min-h-0 max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] w-full flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground transition-colors duration-300"
                style={{ transformOrigin: 'center' }}
              >
          <div ref={contentRef} className={cn(
            'onboarding-content min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-6 md:px-10 md:pt-6 md:pb-10',
            (isTheme || isRepository || isBackup || isReady) && 'onboarding-content--theme'
          )}>
            <div className="onboarding-step-body flex flex-col">
                {step === 0 ? (
                  <div className="mb-6 flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="text-xl font-semibold tracking-tight font-display sm:text-2xl">{t('Bienvenido a')}</span>
                    <motion.div
                      className="flex items-center gap-1.5 sm:gap-2"
                      animate={reduceMotion ? { y: 0, rotate: 0 } : GENTLE_FLOAT_MOTION}
                      transition={reduceMotion ? { duration: 0 } : GENTLE_FLOAT_TRANSITION}
                    >
                      <CytlexLogoMark className="h-10 w-10" reduceMotion={reduceMotion} />
                      <h2 className="text-xl font-semibold tracking-tight font-brand sm:text-2xl">Cytlex</h2>
                    </motion.div>
                  </div>
                ) : (
                  <div className={cn('onboarding-step-heading mb-6', step >= 2 ? 'mb-2' : 'mt-2')}>
                    <h2 className="onboarding-step-title text-2xl font-semibold tracking-tight font-display">{t(showImportStatus ? (importingBackup ? 'Importando respaldo' : importResult === 'complete' ? 'Respaldo importado' : 'No se pudo importar el respaldo') : STEPS[step].title)}</h2>
                  </div>
                )}

                {!showImportStatus && STEPS[step].body && (
                  <p className={cn('onboarding-step-description text-base text-muted-foreground whitespace-pre-line', isRepository ? 'leading-normal' : 'leading-relaxed')}>
                    {t(STEPS[step].body).split(/(\*\*[^*]+\*\*|Cytlex)/g).map((part, i) => {
                      if (part.startsWith('**') && part.endsWith('**')) {
                        return <strong key={i}>{part.slice(2, -2)}</strong>;
                      }
                      return part === 'Cytlex' ? <span key={i} className="font-brand font-semibold">{part}</span> : part;
                    })}
                  </p>
                )}

                {showImportStatus && (
                  <div className="mt-3" role="status" aria-live="polite">
                    <p className="text-base leading-relaxed text-muted-foreground">
                      {t(importingBackup ? 'Estamos preparando tu biblioteca. Esto puede tardar unos momentos.' : importResult === 'complete' ? 'Tu biblioteca está lista. Puedes continuar con el tutorial.' : 'Puedes volver a intentarlo desde esta pantalla.')}
                    </p>
                    {importingBackup ? (
                      <div className="mt-5"><BackupProgress progress={tutorialImportProgress} scale={scale} compact /></div>
                    ) : (
                      <div className="mt-5 flex items-center gap-3 border border-border bg-secondary/40 px-4 py-3">
                        {importResult === 'complete' ? <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /> : <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />}
                        <span className="text-sm font-medium">{t(importResult === 'complete' ? 'Importación completada' : 'Importación interrumpida')}</span>
                      </div>
                    )}
                    {!importingBackup && <div className="mt-5 flex justify-end"><Button variant="outline" onClick={() => setImportResult(null)}>{t('Importar otro respaldo')}</Button></div>}
                  </div>
                )}
                {isBackup && !showImportStatus && (
                  <>
                    <div className="onboarding-import-actions mt-5 flex flex-row-reverse flex-wrap items-end justify-start gap-2">
                      <Button onClick={() => importControls.current?.importBackup()}>{t('Importar respaldo de Cytlex')}</Button>
                      <Button variant="outline" onClick={() => importControls.current?.importMihon()}>{t('Importar respaldo de Mihon')}</Button>
                    </div>
                  </>
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
                    {t('Apoyar en Ko-fi')}
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
                  <div className="mt-3 space-y-2">
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
                          {t(m.name)}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3">
                      {THEMES.map((themeOption) => {
                        const sw = themeOption.swatch[resolveMode(mode)] || themeOption.swatch.dark;
                        const selected = theme === themeOption.id;
                        return (
                          <button
                            key={themeOption.id}
                            onClick={() => applyTheme(themeOption.id, mode)}
                            className={cn(
                              'group flex min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-all sm:gap-3 sm:px-3 sm:py-1.5',
                              selected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:bg-muted/40'
                            )}
                          >
                            <div className="h-6 w-6 rounded-full overflow-hidden shrink-0 flex sm:h-7 sm:w-7">
                              <span className="flex-1" style={{ background: sw[0] }} />
                              <span className="flex-1" style={{ background: sw[1] }} />
                            </div>
                            <div className="min-w-0">
                              <p className="break-words text-xs font-medium leading-tight sm:text-sm">{t(themeOption.name)}</p>
                              <p className="break-words text-[11px] leading-tight text-muted-foreground sm:text-xs">{t(themeOption.desc)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isRepository && (
                  <div className="onboarding-repository-card mt-4 rounded-xl border border-border bg-muted/30 p-3 sm:mt-6 sm:p-5">
                      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-x-1 text-sm font-medium">
                            <span>{t('Repositorio oficial de')}</span>
                            <CytlexLogoMark className="h-4 w-4" reduceMotion={reduceMotion} decorative />
                            <span className="font-brand font-semibold tracking-tight">Cytlex</span>
                          </p>
                          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            {DEFAULT_EXTENSION_REPOSITORY}
                          </p>
                          {hasOtherRepository && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {t('Ya hay otro repositorio configurado; al continuar con este se reemplazará.')}
                            </p>
                          )}
                        </div>
                        <Button
                          layout={false}
                          aria-pressed={hasOfficialRepository}
                          className={cn(
                            'h-9 w-full shrink-0 transition-colors active:scale-100 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-100 sm:h-10 sm:w-52',
                            hasOfficialRepository && 'border border-primary/40 bg-primary/15 text-primary hover:bg-primary/15'
                          )}
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
            </div>
          </div>


              </motion.div>
            </motion.div>
          )}
          {step === 1 && (
            <motion.div
              key="walkthrough-panel"
              layout={reduceMotion ? false : 'position'}
              custom={motionDirection}
              variants={STEP_CONTENT_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              onAnimationStart={(definition) => {
                if (definition === 'center' && typeof onRevealApp === 'function') onRevealApp();
              }}
              transition={{
                duration: 0.2,
                ease: 'easeOut',
                layout: { duration: reduceMotion ? 0 : 0.24, ease: [0.23, 1, 0.32, 1] }
              }}
              className="pointer-events-auto fixed bottom-[calc(5.5rem_+_env(safe-area-inset-bottom))] left-1/2 w-[min(92vw,40rem)] md:bottom-24"
              style={{ translate: '-50% 0' }}
            >
              <motion.div
                animate={{ transform: `scale(${scale})` }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-2xl border border-border bg-card text-card-foreground shadow-lg transition-colors duration-300"
                style={{ transformOrigin: 'center bottom' }}
              >
            <div className="space-y-3 px-3 py-3 sm:px-5 sm:py-4">
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
                        'flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center transition-all sm:gap-2 sm:px-3 sm:py-3',
                        selected
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted/40'
                      )}
                    >
                      <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                      <span className="text-xs font-medium sm:text-sm">{t(label)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                {t(WALKTHROUGH_VIEWS.find(({ id }) => id === walkthroughView)?.desc || '')}
              </p>
            </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
          {isBackup && createPortal(
            <div className="fixed inset-0 z-[70] pointer-events-none">
              <Settings
                tutorialImportControls={importControls}
                onTutorialImportBusyChange={onTutorialImportBusyChange}
                onTutorialImportProgressChange={onTutorialImportProgressChange}
                onTutorialImportResult={setImportResult}
              />
            </div>,
            document.body
          )}
          <motion.div initial={false} animate={{ opacity: navigationVisible ? 1 : 0, y: navigationVisible || reduceMotion ? 0 : 'calc(100% + env(safe-area-inset-bottom))' }} transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.23, 1, 0.32, 1] }} inert={!navigationVisible} className="onboarding-footer pointer-events-auto fixed bottom-[env(safe-area-inset-bottom)] inset-x-0 mx-auto z-10 grid w-full max-w-3xl grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 bg-card border border-border px-4 py-3 sm:grid-cols-3 sm:gap-4 sm:px-10 sm:py-4">
            <div className="flex justify-start">
              <Button variant="outline" size="sm" className="px-1.5 sm:px-3" onClick={finish} disabled={importingBackup}>
                {t('Saltar tutorial')}
              </Button>
            </div>

            <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-2 sm:static sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:translate-x-0 sm:translate-y-0">
              {STEPS.map((_, i) => (
                <motion.span
                  key={i}
                  animate={{ width: i === step ? 28 : 8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    'h-2 rounded-full',
                    i === step ? 'bg-primary' : i < step ? 'bg-primary/40' : 'bg-muted-foreground/30'
                  )}
                />
              ))}
            </div>

            <div className="col-start-2 row-start-1 flex justify-end gap-2 sm:col-start-3 sm:row-start-1">
              {step > 0 && (
                <Button variant="outline" size="sm" className="w-10 px-0 md:w-auto md:px-3" aria-label={t('Atrás')} onClick={back} disabled={importingBackup}>
                  <ArrowLeft className="h-4 w-4 md:mr-1" />
                  <span className="hidden md:inline">{t('Atrás')}</span>
                </Button>
              )}
              <Button
                size="sm"
                className="w-10 px-0 md:w-28 md:px-3"
                aria-label={t(step === STEPS.length - 1 ? 'Comenzar' : 'Siguiente')}
                onClick={next}
                disabled={importingBackup}
              >
                {step === STEPS.length - 1 ? (
                  <>
                    <span className="hidden md:inline">{t('Comenzar')}</span>
                    <CheckCheck className="h-4 w-4 md:hidden" />
                  </>
                ) : (
                  <>
                    <span className="hidden md:inline">{t('Siguiente')}</span>
                    <ArrowRight className="h-4 w-4 md:ml-1" />
                  </>
                )}
              </Button>
            </div>
          </motion.div>
    </motion.div>
  );
}
