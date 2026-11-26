import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, ChevronsRight, Compass, Settings as SettingsIcon } from 'lucide-react';
import { RESET_PAGE_EVENT } from '../App.jsx';
import { cn } from '../lib/utils.js';
import { exploreHomeRoute, exploreReturnRoute, libraryReturnRoute, SOURCE_CATALOG_HOME_EVENT, resetSubrouteScroll } from '../lib/searchState.js';
import { settings, SIDEBAR_WIDTH } from '../lib/settings.js';
import { useI18n } from '../lib/i18n.js';
import { useScale, px, fontPx } from '../lib/useScale.js';
import CytlexLogoMark from './CytlexLogoMark.jsx';

const navItems = [
  { to: '/biblioteca', label: 'Biblioteca', icon: BookOpen },
  { to: '/explorar', label: 'Explorar', icon: Compass },
  { to: '/ajustes', label: 'Ajustes', icon: SettingsIcon }
];

const SIDEBAR_GLYPHS = '彼らのすべての機器と器具はまるで命があるかのようだった';
const randomSidebarGlyphs = () => Array.from({ length: 12 }, () =>
  SIDEBAR_GLYPHS[Math.floor(Math.random() * SIDEBAR_GLYPHS.length)]
).join('');

const EASE = [0.25, 0.1, 0.25, 1];
const DURATION = 0.3;
const SIDEBAR_SCALE_MIN = 0.72;
function ActiveRouteLabel({ label, active, centered = false }) {
  const [glyphs] = useState(randomSidebarGlyphs);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!document.getElementById('cytlex-sidebar-noto-jp')) {
      const font = document.createElement('link');
      font.id = 'cytlex-sidebar-noto-jp';
      font.rel = 'stylesheet';
      font.href = 'https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-sans-jp@5.3.1/wght.css';
      document.head.appendChild(font);
    }
  }, []);

  return (
    <span className="sidebar-active-route-label">
      <AnimatePresence initial={false}>
        {active && (
          <motion.span
            key="glyph-ticker"
            aria-hidden="true"
            className="sidebar-glyph-viewport"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.68 }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: 'easeOut' } }}
            transition={{
              opacity: {
                duration: 0.2,
                ease: reduceMotion ? 'easeOut' : 'easeIn'
              }
            }}
          >
            <span className={cn('sidebar-glyph-track', reduceMotion && 'sidebar-glyph-track-static')}>
              {[0, 1, 2, 3].map((copy) => <span key={copy}>{glyphs}</span>)}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
      {active && <span key="leading" aria-hidden="true" className="sidebar-glyph-leading" style={centered ? { flex: '1 1 0', minWidth: 0 } : undefined} />}
      <motion.span
        key="route-name"
        layout={reduceMotion ? false : 'position'}
        transition={{ layout: { duration: 0.24, ease: [0.23, 1, 0.32, 1] } }}
        className={cn('sidebar-active-route-name', active && 'sidebar-active-route-name-selected')}
      >
        {label}
      </motion.span>
      {active && <span key="trailing" aria-hidden="true" className="sidebar-glyph-trailing" style={centered ? { flex: '1 1 0' } : undefined} />}
    </span>
  );
}

function routeSection(location) {
  if (location.pathname === '/biblioteca') return '/biblioteca';
  if (location.pathname === '/explorar' || location.pathname === '/resultados') return '/explorar';
  if (location.pathname.startsWith('/manga')) {
    const from = new URLSearchParams(location.search).get('from');
    if (from === 'biblioteca') return '/biblioteca';
    if (from === 'explorar' || from === 'fuentes' || from === 'resultados') return '/explorar';
  }
  return '';
}

export default function Sidebar({ tutorialNavOnly = false }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(settings.get().sidebarCollapsed);
  const location = useLocation();
  const navigate = useNavigate();
  const scale = useScale(SIDEBAR_SCALE_MIN);
  const reduceMotion = useReducedMotion();
  const navIconCenter = Math.max(6, Math.round(12 * scale))
    + Math.max(6, Math.round(8 * scale))
    + Math.max(20, Math.round(32 * scale)) / 2;
  const logoSize = Math.max(18, Math.round(24 * scale));
  const logoOffset = navIconCenter - logoSize / 2;
  const ribbonLogoSize = Math.max(22, Math.round(30 * scale));
  const ribbonLogoOffset = navIconCenter - ribbonLogoSize / 2;
  const headerHeight = px(38, scale, 34);
  const supportLabel = t('Donaciones');
  const renderBrand = (key) => (
    <span key={key} className="sidebar-ribbon-brand flex shrink-0 items-center" style={{ gap: px(8, scale, 6) }}>
      <CytlexLogoMark decorative reduceMotion={reduceMotion} strokeWidth={0} themeColor style={{ width: ribbonLogoSize, height: ribbonLogoSize }} />
      <span className="sidebar-ribbon-brand-name whitespace-nowrap self-center font-brand font-semibold leading-[1.2] tracking-tight" style={{ fontSize: fontPx(18, scale) }}>Cytlex</span>
    </span>
  );
  const renderRibbonSegment = (copyIndex) => (
    <span key={copyIndex} className="sidebar-ribbon-segment flex shrink-0 items-center">
      {renderBrand(`${copyIndex}-a`)}
      <span className="sidebar-ribbon-separator" aria-hidden="true">·</span>
      {renderBrand(`${copyIndex}-b`)}
      <span className="sidebar-ribbon-separator" aria-hidden="true">·</span>
    </span>
  );

  useEffect(() => settings.subscribe((s) => {
    setCollapsed(s.sidebarCollapsed);
  }), []);

  const toggle = () => settings.set({ sidebarCollapsed: !collapsed });

  return (
    <motion.aside
      initial={false}
      animate={{ width: Math.round((collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.default) * scale) }}
      transition={{ duration: DURATION, ease: EASE }}
      className="relative z-20 h-full flex flex-col border-r border-sidebar-border/70 bg-sidebar overflow-visible"
    >
      <div className="relative flex shrink-0 items-center overflow-hidden border-b border-border/70" style={{ height: headerHeight, minHeight: headerHeight, maxHeight: headerHeight }}>
        {collapsed ? (
          <div className="flex items-center" style={{ paddingLeft: logoOffset, gap: px(8, scale, 6) }}>
            <CytlexLogoMark decorative reduceMotion={reduceMotion} style={{ width: logoSize, height: logoSize }} />
            <span aria-hidden="true" className="whitespace-nowrap font-brand font-bold tracking-tight opacity-0" style={{ fontSize: fontPx(14, scale) }}>Cytlex</span>
          </div>
        ) : reduceMotion ? (
          <span role="img" aria-label="Cytlex" className="flex items-center" style={{ paddingLeft: ribbonLogoOffset }}>
            {renderBrand('static')}
          </span>
        ) : (
          <div className="sidebar-ribbon-viewport" style={{ paddingLeft: ribbonLogoOffset }}>
            <div className="sidebar-ribbon-track" role="img" aria-label="Cytlex">
              {[0, 1].map(renderRibbonSegment)}
            </div>
          </div>
        )}
      </div>
      <nav
        aria-label={t('Navegación principal')}
        inert={tutorialNavOnly}
        className="sidebar-navigation flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col"
        style={{
          gap: `${Math.max(2, Math.round(4 * scale))}px`,
          padding: `${Math.max(6, Math.round(12 * scale))}px`
        }}
      >
        {navItems.map((item) => {
          const isActive = routeSection(location) === item.to || location.pathname === item.to;
          const destination = item.to === '/explorar'
            ? isActive ? exploreHomeRoute(location) : exploreReturnRoute()
            : item.to === '/biblioteca' && !isActive
              ? libraryReturnRoute()
            : item.to;
          const Icon = item.icon;
          const collapsedEnter = reduceMotion ? 'translateX(0)' : 'translateX(-3px)';
          const collapsedExit = reduceMotion ? 'translateX(0)' : 'translateX(3px)';
          const expandedEnter = reduceMotion ? 'translateX(0)' : 'translateX(-3px)';
          const expandedExit = reduceMotion ? 'translateX(0)' : 'translateX(3px)';
          const routeIconSize = Math.max(16, Math.round(20 * scale));
          const routeVerticalPadding = Math.max(7, Math.round(10 * scale));
          const routeHeight = routeIconSize + routeVerticalPadding * 2;
          const transition = { duration: 0.18, ease: [0.23, 1, 0.32, 1] };
          return (
            <NavLink
              key={item.to}
              aria-current={isActive ? 'page' : undefined}
              aria-label={t(item.label)}
              title={collapsed ? t(item.label) : undefined}
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              to={tutorialNavOnly && item.to === '/explorar'
                ? '/explorar?tab=mangas'
                : tutorialNavOnly && item.to === '/ajustes'
                  ? '/ajustes?tutorial=1&section=apariencia'
                  : destination}
              onClick={(event) => {
                if (tutorialNavOnly || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const libraryDetail = location.pathname === '/manga'
                  && new URLSearchParams(location.search).get('from') === 'biblioteca';
                if (item.to === '/biblioteca' && (location.pathname === '/biblioteca' || libraryDetail)) {
                  event.preventDefault();
                  resetSubrouteScroll('/biblioteca');
                  if (location.pathname === '/biblioteca') {
                    const main = document.querySelector('.library-page-scroll') || document.querySelector('main');
                    if (main?.scrollTop > 1) main.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
                  } else {
                    navigate('/biblioteca');
                  }
                  return;
                }
                if (item.to === '/explorar' && isActive && location.pathname === '/explorar') {
                  event.preventDefault();
                  if (`${location.pathname}${location.search}` !== destination) {
                    navigate(destination, { replace: true });
                  }
                  return;
                }
                event.preventDefault();
                if (isActive) {
                  resetSubrouteScroll(destination);
                  if (destination === '/explorar?tab=fuentes') window.dispatchEvent(new Event(SOURCE_CATALOG_HOME_EVENT));
                  window.dispatchEvent(new Event(RESET_PAGE_EVENT));
                }
                navigate(destination, { replace: isActive });
              }}
            >
              <div
                className={cn(
                  'relative flex items-center rounded-md transition-[gap,color,background-color,border-color] duration-200',
                  isActive
                    ? 'bg-primary/10 font-semibold text-primary ring-1 ring-inset ring-primary/25'
                    : 'font-medium text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                )}
                style={{
                  gap: collapsed ? 0 : `${Math.max(7, Math.round(12 * scale))}px`,
                  paddingTop: `${routeVerticalPadding}px`,
                  paddingBottom: `${routeVerticalPadding}px`,
                  paddingLeft: collapsed ? '0px' : `${Math.max(6, Math.round(8 * scale))}px`,
                  paddingRight: '0px',
                  minHeight: `${routeHeight}px`,
                  fontSize: fontPx(14, scale, 11)
                }}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary"
                  />
                )}
                <AnimatePresence initial={false} mode="sync">
                  {collapsed ? (
                    <motion.span
                      key="collapsed-icon"
                      aria-hidden="true"
                      className="absolute inset-0 grid place-items-center leading-none"
                      initial={{ opacity: 0, transform: collapsedEnter }}
                      animate={{ opacity: 1, transform: 'translateX(0) scale(1)' }}
                      exit={{ opacity: 0, transform: collapsedExit }}
                      transition={transition}
                    >
                      <Icon className="shrink-0" aria-hidden="true" strokeWidth={1.9} style={{ width: `${routeIconSize}px`, height: `${routeIconSize}px` }} />
                    </motion.span>
                  ) : (
                    <motion.span
                      key="expanded-label"
                      className="absolute inset-y-0 right-0 flex min-w-0 items-center overflow-hidden"
                      initial={{ opacity: 0, transform: expandedEnter }}
                      animate={{ opacity: 1, transform: 'translateX(0) scale(1)' }}
                      exit={{ opacity: 0, transform: expandedExit }}
                      transition={transition}
                      style={{ left: `${Math.max(6, Math.round(8 * scale))}px` }}
                    >
              <ActiveRouteLabel label={t(item.label)} active={isActive} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </NavLink>
          );
        })}

        <div
          inert={tutorialNavOnly}
          className="shrink-0"
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
            title={supportLabel}
            aria-label={supportLabel}
            className={cn(
              'relative w-full flex items-center rounded-md font-semibold',
              'transition-[gap,color,background-color,border-color,text-decoration-color,fill,stroke] duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
              'bg-primary/10 text-primary ring-1 ring-inset ring-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
            )}
            style={{
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: collapsed ? 0 : `${Math.max(6, Math.round(8 * scale))}px`,
              paddingTop: `${Math.max(7, Math.round(10 * scale))}px`,
              paddingBottom: `${Math.max(7, Math.round(10 * scale))}px`,
              paddingLeft: collapsed ? 0 : `${Math.max(6, Math.round(8 * scale))}px`,
              paddingRight: collapsed ? 0 : `${Math.max(6, Math.round(8 * scale))}px`,
              fontSize: fontPx(14, scale, 11)
            }}
          >
            <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" />
            {collapsed && (
              <div
                className="shrink-0 grid place-items-center"
                style={{
                  width: `${Math.max(16, Math.round(20 * scale))}px`,
                  height: `${Math.max(16, Math.round(20 * scale))}px`
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
            )}
            <span
              className={cn(
                'min-w-0 whitespace-nowrap overflow-hidden leading-normal transition-[max-width,opacity,transform,margin-left] duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
                collapsed ? 'max-w-0 opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'
              )}
              style={{
                flex: collapsed ? '0 1 0' : '1 1 0',
                maxWidth: collapsed ? 0 : 'none',
                marginLeft: 0,
                transitionDuration: collapsed ? '180ms' : '300ms'
              }}
            >
              <ActiveRouteLabel label={supportLabel} active={!collapsed} centered />
            </span>
          </button>
        </div>
      </nav>

      <div
        inert={tutorialNavOnly}
        className="shrink-0"
        style={{ padding: `0 ${Math.max(6, Math.round(12 * scale))}px ${Math.max(6, Math.round(12 * scale))}px` }}
      >
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.94 }}
          onClick={toggle}
          aria-label={collapsed ? t('Expandir menu lateral') : t('Colapsar menu lateral')}
          aria-expanded={!collapsed}
          title={collapsed ? t('Expandir') : t('Colapsar')}
          className="mx-auto grid shrink-0 place-items-center bg-transparent text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          style={{
            width: `${Math.max(36, Math.round(40 * scale))}px`,
            height: `${Math.max(36, Math.round(40 * scale))}px`,
            padding: 0
          }}
        >
          <motion.span
            className="flex items-center justify-center"
            animate={{ rotate: collapsed ? 0 : 180 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.7 }}
          >
            <ChevronsRight
              style={{ width: `${Math.max(15, Math.round(18 * scale))}px`, height: `${Math.max(15, Math.round(18 * scale))}px` }}
            />
          </motion.span>
        </motion.button>
      </div>
    </motion.aside>
  );
}

