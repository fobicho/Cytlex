import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Compass, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../lib/utils.js';

const items = [
  { to: '/biblioteca', label: 'Biblioteca', icon: BookOpen },
  { to: '/explorar?tab=mangas', label: 'Explorar', icon: Compass },
  { to: '/ajustes', label: 'Ajustes', icon: SettingsIcon }
];

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
  const active = activeSection(location);

  return (
    <nav className="browser-mobile-nav md:hidden" aria-label="Navegación principal">
      {items.map(({ to, label, icon: Icon }) => {
        const section = to.split('?')[0];
        const selected = active === section;
        return (
          <NavLink
            key={section}
            to={to}
            aria-current={selected ? 'page' : undefined}
            className={cn('browser-mobile-nav__item', selected && 'is-active')}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
