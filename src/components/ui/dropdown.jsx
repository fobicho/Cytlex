import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { px, useScale } from '../../lib/useScale.js';

export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '',
  className,
  buttonClassName,
  buttonStyle,
  menuClassName,
  portal,
  menuWidth,
  menuMaxHeight = 256,
  style,
  scale
}) {
  const currentScale = useScale();
  const sc = scale ?? currentScale;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const listRef = useRef(null);
  const selectedRef = useRef(null);
  const btnRef = useRef(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const contentBounds = document.querySelector('main')?.getBoundingClientRect();
    const viewportTop = Math.max(0, contentBounds?.top ?? 0);
    const viewportBottom = Math.min(window.innerHeight, contentBounds?.bottom ?? window.innerHeight);
    if (r.bottom <= viewportTop || r.top >= viewportBottom) {
      setOpen(false);
      return;
    }
    const gap = 4;
    const viewportPadding = 8;
    const desiredHeight = Number.parseInt(px(menuMaxHeight, sc, 200), 10);
    const below = Math.max(0, viewportBottom - r.bottom - gap - viewportPadding);
    const above = Math.max(0, r.top - viewportTop - gap - viewportPadding);
    const naturalHeight = menuRef.current?.scrollHeight || desiredHeight;
    const openAbove = below < Math.min(desiredHeight, naturalHeight) && above > below;
    const availableHeight = openAbove ? above : below;
    const maxHeight = Math.min(desiredHeight, availableHeight);
    const height = Math.min(naturalHeight, maxHeight);
    const width = menuWidth ? Math.min(r.width, window.innerWidth - 16) : r.width;
    const left = menuWidth ? Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) : r.left;
    const top = openAbove
      ? Math.max(viewportTop + viewportPadding, r.top - gap - height)
      : Math.max(viewportTop + viewportPadding, Math.min(r.bottom + gap, viewportBottom - viewportPadding - height));
    setPos({ top, left, width, maxHeight });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const sel = selectedRef.current;
    if (list && sel) list.scrollTop = Math.max(0, sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  const menu = open && (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        ...(portal && pos ? { top: pos.top, left: pos.left, maxHeight: `${pos.maxHeight}px`, ...(menuWidth ? { width: pos.width, minWidth: pos.width } : { minWidth: pos.width }) } : null),
        ...(portal ? null : { marginTop: px(4, sc, 3), maxHeight: px(menuMaxHeight, sc, 200) }),
        fontSize: px(14, sc, 12)
      }}
      className={cn(
        portal ? 'fixed z-[60]' : 'absolute z-40',
        'min-w-full overflow-hidden rounded-lg border border-border bg-card shadow-2xl'
      )}
      data-scrollable
    >
      <div
        ref={listRef}
        className="dd-scroll overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-primary/40 [&::-webkit-scrollbar-thumb:hover]:bg-primary/60"
        style={{
          maxHeight: portal && pos ? `${pos.maxHeight}px` : px(menuMaxHeight, sc, 200),
          padding: `${px(4, sc, 3)} ${px(4, sc, 3)} ${px(4, sc, 3)} ${px(4, sc, 3)}`
        }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={active}
              ref={active ? selectedRef : null}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={cn(
                'block w-full truncate rounded-md text-left transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
              )}
              style={{
                paddingLeft: px(10, sc, 8),
                paddingRight: px(10, sc, 8),
                paddingTop: px(6, sc, 4),
                paddingBottom: px(6, sc, 4),
                fontSize: px(14, sc, 12)
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={cn('relative', className)} style={style}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn('flex items-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', buttonClassName)}
        style={{
          gap: px(8, sc, 6),
          height: px(32, sc, 27),
          width: '100%',
          paddingLeft: px(12, sc, 10),
          paddingRight: px(10, sc, 8),
          fontSize: px(14, sc, 12),
          ...buttonStyle
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left">{current ? current.label : placeholder}</span>
        <ChevronDown
          className={cn('shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
          style={{ width: px(14, sc, 12), height: px(14, sc, 12) }}
        />
      </button>

      {portal
        ? menu && createPortal(menu, document.body)
        : menu}
    </div>
  );
}

