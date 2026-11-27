import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { usePerformanceMode } from '../lib/usePerformanceMode.js';
import { BookOpen, Compass, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useI18n } from '../lib/i18n.js';
import { exploreHomeRoute, exploreReturnRoute, libraryReturnRoute, MANGA_CATALOG_HOME_EVENT, SOURCE_CATALOG_HOME_EVENT, resetSubrouteScroll } from '../lib/searchState.js';

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

export default function BrowserMobileNav({ tutorialNavOnly = false }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const active = activeSection(location);
  const activeIndex = items.findIndex(({ to }) => to.split('?')[0] === active);
  const reduceMotion = usePerformanceMode();
  const previousActiveIndex = useRef(activeIndex);
  const [activeVisit, setActiveVisit] = useState(0);

  useEffect(() => {
    if (previousActiveIndex.current === activeIndex) return;
    previousActiveIndex.current = activeIndex;
    setActiveVisit((visit) => visit + 1);
  }, [activeIndex]);

  const handleRouteClick = (to, event, selected) => {
    if (tutorialNavOnly || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const destination = to === '/explorar'
      ? selected ? exploreHomeRoute(location) : exploreReturnRoute()
      : to === '/biblioteca' && !selected
        ? libraryReturnRoute()
      : to;
    const searchParams = new URLSearchParams(location.search);
    const isRegularMangaSearch = to === '/explorar'
      && selected
      && location.pathname === '/explorar'
      && destination === '/explorar?tab=mangas'
      && !searchParams.has('migrationFrom')
      && !searchParams.has('migrationSource')
      && !searchParams.has('migrationTargets');
    if (isRegularMangaSearch) {
      event.preventDefault();
      window.dispatchEvent(new Event(MANGA_CATALOG_HOME_EVENT));
      return;
    }
    const libraryDetail = location.pathname === '/manga'
      && new URLSearchParams(location.search).get('from') === 'biblioteca';
    if (to === '/biblioteca' && (location.pathname === '/biblioteca' || libraryDetail)) {
      event.preventDefault();
      resetSubrouteScroll('/biblioteca');
      if (location.pathname === '/biblioteca') {
        const main = document.querySelector('.library-page-scroll') || document.querySelector('main');
        if (main?.scrollTop > 1) main.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      } else {
        navigate('/biblioteca', { replace: selected });
      }
      return;
    }
    if (to === '/explorar' && selected && location.pathname === '/explorar') {
      event.preventDefault();
      if (`${location.pathname}${location.search}` !== destination) {
        navigate(destination, { replace: true });
      }
      return;
    }
    event.preventDefault();
    if (selected) {
      resetSubrouteScroll(destination);
      if (destination === '/explorar?tab=fuentes') window.dispatchEvent(new Event(SOURCE_CATALOG_HOME_EVENT));
      window.dispatchEvent(new Event(RESET_PAGE_EVENT));
    }
    navigate(destination, { replace: selected });
  };

  return (
    <nav inert={tutorialNavOnly} data-tutorial-nav-only={tutorialNavOnly || undefined} className="browser-mobile-nav md:hidden" aria-label={t('Navegación principal')}>
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
            to={to === '/explorar'
              ? selected ? exploreHomeRoute(location) : exploreReturnRoute()
              : to === '/biblioteca' && !selected
                ? libraryReturnRoute()
              : to}
            aria-current={selected ? 'page' : undefined}
            className={cn('browser-mobile-nav__item', selected && 'is-active')}
            onClick={(event) => handleRouteClick(to, event, selected)}
          >
            <span
              key={selected ? `active-${activeVisit}` : 'inactive'}
              aria-hidden="true"
              className="grid h-[19px] w-[19px] place-items-center"
            >
              <AnimatedNavIcon to={to} Icon={Icon} animate={selected && activeVisit > 0 && !reduceMotion} />
            </span>
            <span>{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
