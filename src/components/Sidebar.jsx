import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Compass, Settings as SettingsIcon, ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { settings } from '../lib/settings.js';

const navItems = [
  { to: '/biblioteca', icon: BookOpen, label: 'Biblioteca' },
  { to: '/explorar', icon: Compass, label: 'Explorar' },
  { to: '/ajustes', icon: SettingsIcon, label: 'Ajustes' }
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(settings.get().sidebarCollapsed);
  const location = useLocation();

  useEffect(() => settings.subscribe((s) => setCollapsed(s.sidebarCollapsed)), []);

  const toggle = () => settings.set({ sidebarCollapsed: !collapsed });

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 196 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className="h-full flex flex-col border-r border-border bg-sidebar overflow-hidden"
    >
      <nav className="flex-1 flex flex-col gap-1 p-3">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <NavLink key={item.to} to={item.to}>
              <div
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative',
                  collapsed && 'justify-center px-0 gap-0',
                  isActive ? 'text-sidebar-accent-foreground' : 'text-sidebar-foreground'
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
                    'relative z-10 whitespace-nowrap overflow-hidden transition-[max-width,opacity,transform] duration-300',
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

      <div className="p-3 border-t border-border">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={toggle}
          className={cn(
            'flex items-center justify-center w-full gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
            collapsed && 'gap-0'
          )}
        >
          <motion.div animate={{ rotate: collapsed ? -180 : 0 }} transition={{ duration: 0.3 }}>
            <ChevronLeft className="w-4 h-4" />
          </motion.div>
          <span
            className={cn(
              'whitespace-nowrap overflow-hidden transition-[max-width,opacity,transform] duration-300',
              collapsed ? 'max-w-0 opacity-0 translate-x-2' : 'max-w-[120px] opacity-100 translate-x-0'
            )}
          >
            Colapsar
          </span>
        </motion.button>
      </div>
    </motion.aside>
  );
}
