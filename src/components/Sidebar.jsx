import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Compass, Settings as SettingsIcon, ChevronsRight } from 'lucide-react';
import { RESET_PAGE_EVENT } from '../App.jsx';
import { cn } from '../lib/utils.js';
import { settings } from '../lib/settings.js';
import { useScale } from '../lib/useScale.js';

const navItems = [
  { to: '/biblioteca', icon: BookOpen, label: 'Biblioteca' },
  { to: '/explorar', icon: Compass, label: 'Explorar' },
  { to: '/ajustes', icon: SettingsIcon, label: 'Ajustes' }
];

const EASE = [0.25, 0.1, 0.25, 1];
const DURATION = 0.3;
const SIDEBAR_WIDTH = { expanded: 196, collapsed: 72 };
const SIDEBAR_SCALE_MIN = 0.72;

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(settings.get().sidebarCollapsed);
  const location = useLocation();
  const scale = useScale(SIDEBAR_SCALE_MIN);

  useEffect(() => settings.subscribe((s) => setCollapsed(s.sidebarCollapsed)), []);

  const toggle = () => settings.set({ sidebarCollapsed: !collapsed });

  return (
    <motion.aside
      initial={false}
      animate={{ width: Math.round((collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded) * scale) }}
      transition={{ duration: DURATION, ease: EASE }}
      className="h-full flex flex-col border-r border-border bg-sidebar overflow-hidden"
    >
      <nav
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col"
        style={{
          gap: `${Math.max(2, Math.round(4 * scale))}px`,
          padding: `${Math.max(6, Math.round(12 * scale))}px`
        }}
      >
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
                  'flex items-center rounded-lg font-medium',
                  'transition-[gap,color,background-color,border-color,text-decoration-color,fill,stroke] duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
                  'relative',
                  isActive
                    ? 'text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50'
                )}
                style={{
                  gap: collapsed ? 0 : `${Math.max(7, Math.round(12 * scale))}px`,
                  paddingTop: `${Math.max(7, Math.round(10 * scale))}px`,
                  paddingBottom: `${Math.max(7, Math.round(10 * scale))}px`,
                    paddingLeft: `${Math.max(6, Math.round(8 * scale))}px`,
                  paddingRight: '0px',
                  justifyContent: 'flex-start',
                  fontSize: `${Math.max(11, Math.round(14 * scale))}px`
                }}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-pill"
                    className="absolute inset-0 rounded-lg bg-sidebar-accent"
                    transition={{ type: 'spring', stiffness: 340, damping: 34, mass: 0.9 }}
                  />
                )}
                <div
                  className="relative z-10 shrink-0 grid place-items-center"
                  style={{
                    width: `${Math.max(20, Math.round(32 * scale))}px`,
                    height: `${Math.max(14, Math.round(20 * scale))}px`
                  }}
                >
                  <item.icon
                    style={{
                      width: `${Math.max(14, Math.round(20 * scale))}px`,
                      height: `${Math.max(14, Math.round(20 * scale))}px`
                    }}
                  />
                </div>
                <span
                  className={cn(
                    'relative z-10 whitespace-nowrap overflow-hidden transition-[max-width,opacity,transform] duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
                    collapsed ? 'max-w-0 opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'
                  )}
                  style={{
                    maxWidth: collapsed ? 0 : `${Math.round(160 * scale)}px`
                  }}
                >
                  {item.label}
                </span>
              </div>
            </NavLink>
          );
        })}

        <div
          className="shrink-0 rounded-lg border border-primary/40 bg-primary/5"
          style={{
            marginTop: 'auto',
            padding: '0px'
          }}
        >
          <button
            type="button"
            onClick={() => {
              const url = 'https://ko-fi.com/fobicho';
              if (window.cytlex?.openExternal) window.cytlex.openExternal(url);
              else window.open(url, '_blank', 'noopener');
            }}
            title="Apoyar en Ko-fi"
            aria-label="Apoyar en Ko-fi"
            className={cn(
              'w-full flex items-center rounded-md font-medium',
              'transition-[gap,color,background-color,border-color,text-decoration-color,fill,stroke] duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
              'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50'
            )}
            style={{
              justifyContent: 'flex-start',
              gap: collapsed ? 0 : `${Math.max(6, Math.round(8 * scale))}px`,
              paddingTop: `${Math.max(7, Math.round(10 * scale))}px`,
              paddingBottom: `${Math.max(7, Math.round(10 * scale))}px`,
              paddingLeft: `${Math.max(6, Math.round(8 * scale))}px`,
              paddingRight: `${Math.max(6, Math.round(8 * scale))}px`,
              fontSize: `${Math.max(11, Math.round(14 * scale))}px`
            }}
          >
            <div
              className="shrink-0 grid place-items-center"
              style={{
                width: `${Math.max(16, Math.round(20 * scale))}px`,
                height: `${Math.max(16, Math.round(20 * scale))}px`,
                marginLeft: `${Math.round(6 * scale)}px`
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                style={{
                  width: `${Math.max(14, Math.round(20 * scale))}px`,
                  height: `${Math.max(14, Math.round(20 * scale))}px`
                }}
              >
                <path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298" />
              </svg>
            </div>
            <span
              className={cn(
                'whitespace-nowrap overflow-hidden transition-[max-width,opacity,transform,margin-left] duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
                collapsed ? 'max-w-0 opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'
              )}
              style={{
                maxWidth: collapsed ? 0 : `${Math.round(160 * scale)}px`,
                marginLeft: collapsed ? 0 : `${Math.max(3, Math.round(5 * scale))}px`
              }}
            >
              Apoyar en Ko-fi
            </span>
          </button>
        </div>
      </nav>

      <div
        className="shrink-0 border-t border-border"
        style={{ padding: `${Math.max(8, Math.round(12 * scale))}px` }}
      >
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.94 }}
          onClick={toggle}
          aria-label={collapsed ? 'Expandir menu lateral' : 'Colapsar menu lateral'}
          title={collapsed ? 'Expandir' : 'Colapsar'}
          className="flex items-center justify-center w-full rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          style={{ paddingTop: `${Math.max(6, Math.round(8 * scale))}px`, paddingBottom: `${Math.max(6, Math.round(8 * scale))}px` }}
        >
          <motion.span
            className="flex items-center justify-center"
            animate={{ rotate: collapsed ? 0 : 180 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.7 }}
          >
            <ChevronsRight
              style={{ width: `${Math.max(11, Math.round(16 * scale))}px`, height: `${Math.max(11, Math.round(16 * scale))}px` }}
            />
          </motion.span>
        </motion.button>
      </div>
    </motion.aside>
  );
}

