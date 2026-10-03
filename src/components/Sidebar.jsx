import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Compass, Settings as SettingsIcon, ChevronsRight } from 'lucide-react';
import { RESET_PAGE_EVENT } from '../App.jsx';
import { cn } from '../lib/utils.js';
import { settings } from '../lib/settings.js';

const navItems = [
  { to: '/biblioteca', icon: BookOpen, label: 'Biblioteca' },
  { to: '/explorar', icon: Compass, label: 'Explorar' },
  { to: '/ajustes', icon: SettingsIcon, label: 'Ajustes' }
];

const EASE = [0.25, 0.1, 0.25, 1];
const DURATION = 0.3;
const SIDEBAR_WIDTH = { expanded: 196, collapsed: 72 };

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(settings.get().sidebarCollapsed);
  const location = useLocation();

  useEffect(() => settings.subscribe((s) => setCollapsed(s.sidebarCollapsed)), []);

  const toggle = () => settings.set({ sidebarCollapsed: !collapsed });

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded }}
      transition={{ duration: DURATION, ease: EASE }}
      className="h-full flex flex-col border-r border-border bg-sidebar overflow-hidden"
    >
      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-1 p-3">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => {
                if (location.pathname === item.to) {
                  window.dispatchEvent(new CustomEvent(RESET_PAGE_EVENT));
                }
              }}
            >
              <div
                className={cn(
                  'flex items-center gap-3 py-2.5 px-[14px] rounded-lg text-sm font-medium transition-colors relative',
                  'transition-[gap] duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
                  collapsed && 'gap-0',
                  isActive
                    ? 'text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-pill"
                    className="absolute inset-0 rounded-lg bg-sidebar-accent"
                    transition={{ type: 'spring', stiffness: 340, damping: 34, mass: 0.9 }}
                  />
                )}
                <item.icon className="w-5 h-5 shrink-0 relative z-10" />
                <span
                  className={cn(
                    'relative z-10 whitespace-nowrap overflow-hidden transition-[max-width,opacity,transform] duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
                    collapsed ? 'max-w-0 opacity-0 translate-x-2' : 'max-w-[160px] opacity-100 translate-x-0'
                  )}
                >
                  {item.label}
                </span>
              </div>
            </NavLink>
          );
        })}
      </nav>

      <div className="shrink-0 p-3 border-t border-border">
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.94 }}
          onClick={toggle}
          aria-label={collapsed ? 'Expandir menu lateral' : 'Colapsar menu lateral'}
          title={collapsed ? 'Expandir' : 'Colapsar'}
          className="flex items-center justify-center w-full py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
<motion.span
            className="flex items-center justify-center"
            animate={{ rotate: collapsed ? 0 : 180 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.7 }}
          >
            <ChevronsRight className="w-4 h-4" />
          </motion.span>
        </motion.button>
      </div>
    </motion.aside>
  );
}

