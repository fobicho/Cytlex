import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { BookOpen, Compass, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { SOURCE_CATALOG_HOME_EVENT } from '../lib/searchState.js';

const items = [
  { to: '/biblioteca', label: 'Biblioteca', icon: BookOpen },
  { to: '/explorar', label: 'Explorar', icon: Compass },
  { to: '/ajustes', label: 'Ajustes', icon: SettingsIcon }
];

let lastExploreRoute = '/explorar?tab=mangas';

function activeSection(location) {
  if (location.pathname === '/biblioteca') return '/biblioteca';
  if (location.pathname === '/explorar' || location.pathname === '/resultados') return '/explorar';
  if (location.pathname.startsWith('/manga')) {
    const from = new URLSearchParams(location.search).get('from');
    return from === 'biblioteca' ? '/biblioteca' : '/explorar';
  }
  return location.pathname;
}

export default function BrowserMobileNav() {
  const location = useLocation();
  const [exploreRoute, setExploreRoute] = useState(() => {
    if (location.pathname === '/explorar' || location.pathname === '/resultados') {
      lastExploreRoute = `${location.pathname}${location.search}`;
    }
    return lastExploreRoute;
  });
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
    if (location.pathname !== '/explorar' && location.pathname !== '/resultados') return;
    lastExploreRoute = `${location.pathname}${location.search}`;
    setExploreRoute(lastExploreRoute);
  }, [location.pathname, location.search]);

  return (
    <nav className="browser-mobile-nav md:hidden" aria-label="Navegación principal">
      {activeIndex !== -1 && (
        <motion.span
          aria-hidden="true"
          className="browser-mobile-nav__indicator"
          initial={false}
          animate={{ x: `${activeIndex * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
        />
      )}
      {items.map(({ to, label, icon: Icon }, index) => {
        const selected = activeIndex === index;
        return (
          <Link
            key={to}
            to={to === '/explorar' ? exploreRoute : to}
            aria-current={selected ? 'page' : undefined}
            className={cn('browser-mobile-nav__item', selected && 'is-active')}
            onClick={(event) => {
              if (!selected || location.pathname !== '/explorar') return;
              const main = document.querySelector('main');
              if (!main?.querySelector('[data-source-catalog-selected="true"]')) return;
              event.preventDefault();
              window.dispatchEvent(new Event(SOURCE_CATALOG_HOME_EVENT));
              main.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <motion.span
              key={selected ? `active-${activeVisit}` : 'inactive'}
              aria-hidden="true"
              className="grid h-[19px] w-[19px] place-items-center"
              initial={selected && activeVisit > 0 && !reduceMotion
                ? { transform: 'translateY(1px) scale(0.94)', opacity: 0.8 }
                : false}
              animate={{ transform: 'translateY(0) scale(1)', opacity: 1 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            >
              <Icon />
            </motion.span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
