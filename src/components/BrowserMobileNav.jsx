import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { BookOpen, Compass, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { SOURCE_CATALOG_HOME_EVENT, resetSubrouteScroll } from '../lib/searchState.js';

const RESET_PAGE_EVENT = 'cytlex:reset-page';

const items = [
  { to: '/biblioteca', label: 'Biblioteca', icon: BookOpen },
  { to: '/explorar', label: 'Explorar', icon: Compass },
  { to: '/ajustes', label: 'Ajustes', icon: SettingsIcon }
];
const ICON_EASE = [0.23, 1, 0.32, 1];

function AnimatedNavIcon({ to, Icon, animate }) {
  if (to === '/biblioteca') {
    return (
      <span className="relative grid h-full w-full place-items-center">
        <Icon className={cn('browser-mobile-nav__glyph', animate && 'is-entering')} />
        {animate && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <motion.path
              d="M21 18V5a2 2 0 0 0-2-2h-3.4A3.6 3.6 0 0 0 12 6.6V21a3 3 0 0 1 3-3h4a2 2 0 0 1 2 2Z"
              fill="hsl(var(--sidebar-background))"
              initial={{ transform: 'perspective(72px) rotateY(0deg)', opacity: 1 }}
              animate={{ transform: 'perspective(72px) rotateY(-180deg)', opacity: 0 }}
              transition={{ duration: 0.42, ease: ICON_EASE }}
              style={{ transformBox: 'view-box', transformOrigin: '50% 50%', backfaceVisibility: 'hidden' }}
            />
          </svg>
        )}
      </span>
    );
  }

  if (to === '/explorar') {
    return (
      <svg className={cn('browser-mobile-nav__glyph browser-mobile-nav__glyph--compass', animate && 'is-entering')} viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <motion.path
          d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"
          initial={animate ? { transform: 'rotate(-360deg)' } : false}
          animate={{ transform: 'rotate(0deg)' }}
          transition={{ duration: 0.42, ease: ICON_EASE }}
          style={{ transformBox: 'view-box', transformOrigin: '50% 50%' }}
        />
      </svg>
    );
  }

  return (
    <motion.span
      initial={animate ? { transform: 'rotate(-90deg)' } : false}
      animate={{ transform: 'rotate(0deg)' }}
      transition={{ duration: 0.24, ease: ICON_EASE }}
      className="grid h-full w-full place-items-center"
    >
      <Icon className={cn('browser-mobile-nav__glyph browser-mobile-nav__glyph--settings', animate && 'is-entering')} />
    </motion.span>
  );
}

let lastExploreListRoute = '/explorar?tab=mangas';
let lastLibraryListRoute = '/biblioteca';

function activeSection(location) {
  if (location.pathname === '/biblioteca') return '/biblioteca';
  if (location.pathname === '/explorar' || location.pathname === '/resultados') return '/explorar';
  if (location.pathname === '/ajustes') return '/ajustes';
  if (location.pathname.startsWith('/manga')) {
    const from = new URLSearchParams(location.search).get('from');
    if (from === 'biblioteca') return '/biblioteca';
    if (from === 'explorar' || from === 'fuentes' || from === 'resultados') return '/explorar';
  }
  return '';
}

function activeScroller() {
  const main = document.querySelector('main');
  return Array.from(main?.querySelectorAll('.library-page-scroll, .catalog-page-scroll, .settings-section-scroll') || [])
    .find((element) => element.offsetParent !== null) || main;
}

export default function BrowserMobileNav({ tutorialNavOnly = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const pendingQuickSearchReset = useRef(false);
  const active = activeSection(location);
  const activeIndex = items.findIndex(({ to }) => to.split('?')[0] === active);
  const reduceMotion = useReducedMotion();
  const previousActiveIndex = useRef(activeIndex);
  const [activeVisit, setActiveVisit] = useState(0);

  useEffect(() => {
    if (previousActiveIndex.current === activeIndex) return;
    previousActiveIndex.current = activeIndex;
    setActiveVisit((visit) => visit + 1);
  }, [activeIndex]);

  useEffect(() => {
    if (activeSection(location) !== '/explorar') return;
    if (!location.pathname.startsWith('/manga')) lastExploreListRoute = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (activeSection(location) !== '/biblioteca') return;
    if (!location.pathname.startsWith('/manga')) lastLibraryListRoute = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!pendingQuickSearchReset.current || new URLSearchParams(location.search).has('quick')) return;
    pendingQuickSearchReset.current = false;
    window.dispatchEvent(new Event(RESET_PAGE_EVENT));
  }, [location.search]);

  const handleExploreClick = (event, selected) => {
    if (!selected) {
      resetSubrouteScroll(lastExploreListRoute);
      return;
    }
    const main = activeScroller();

    if (location.pathname.startsWith('/manga')) {
      event.preventDefault();
      resetSubrouteScroll(lastExploreListRoute);
      navigate(lastExploreListRoute);
      return;
    }

    if (location.pathname === '/explorar' && new URLSearchParams(location.search).has('quick')) {
      event.preventDefault();
      pendingQuickSearchReset.current = true;
      navigate('/explorar?tab=mangas', { replace: true });
      return;
    }

    if (main?.querySelector('[data-source-catalog-active="true"]')) {
      event.preventDefault();
      window.dispatchEvent(new Event(SOURCE_CATALOG_HOME_EVENT));
      main.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (main?.scrollTop > 1) {
      event.preventDefault();
      main.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    event.preventDefault();
  };

  const handleLibraryClick = (event, selected) => {
    if (!selected) {
      resetSubrouteScroll(lastLibraryListRoute);
      return;
    }
    event.preventDefault();
    const main = activeScroller();

    if (location.pathname.startsWith('/manga')) {
      resetSubrouteScroll(lastLibraryListRoute);
      navigate(lastLibraryListRoute);
      return;
    }

    if (main?.scrollTop > 1) main.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSettingsClick = (event, selected) => {
    if (!selected) return;
    event.preventDefault();
    const main = activeScroller();
    if (main?.scrollTop > 1) main.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <nav inert={tutorialNavOnly} className="browser-mobile-nav md:hidden" aria-label="Navegación principal">
      {activeIndex !== -1 && (
        <motion.span
          aria-hidden="true"
          className="browser-mobile-nav__indicator"
          initial={false}
          animate={{ x: `${activeIndex * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 }}
        />
      )}
      {items.map(({ to, label, icon: Icon }, index) => {
        const selected = activeIndex === index;
        return (
          <Link
            key={to}
            to={to === '/explorar' ? lastExploreListRoute : to === '/biblioteca' ? lastLibraryListRoute : to}
            aria-current={selected ? 'page' : undefined}
            className={cn('browser-mobile-nav__item', selected && 'is-active')}
            onClick={to === '/biblioteca'
              ? (event) => handleLibraryClick(event, selected)
              : to === '/explorar'
                ? (event) => handleExploreClick(event, selected)
                : (event) => handleSettingsClick(event, selected)}
          >
            <span
              key={selected ? `active-${activeVisit}` : 'inactive'}
              aria-hidden="true"
              className="grid h-[19px] w-[19px] place-items-center"
            >
              <AnimatedNavIcon to={to} Icon={Icon} animate={selected && activeVisit > 0 && !reduceMotion} />
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
