import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { px, useScale } from '../../lib/useScale.js';
import { Input } from './input.jsx';

const searchText = (value) => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export function Dropdown({
  value,
  multiple = false,
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
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const listRef = useRef(null);
  const selectedRef = useRef(null);
  const btnRef = useRef(null);
  const searchRef = useRef(null);

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
    const zoom = portal ? Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1 : 1;
    const desiredHeight = parseFloat(px(menuMaxHeight, sc, 200)) * zoom;
    const below = Math.max(0, viewportBottom - r.bottom - gap - viewportPadding);
    const above = Math.max(0, r.top - viewportTop - gap - viewportPadding);
    const naturalHeight = menuRef.current ? menuRef.current.scrollHeight * zoom : desiredHeight;
    const openAbove = below < Math.min(desiredHeight, naturalHeight) && above > below;
    const availableHeight = openAbove ? above : below;
    const maxHeight = Math.min(desiredHeight, availableHeight);
    const height = Math.min(naturalHeight, maxHeight);
    const width = menuWidth ? Math.min(r.width, window.innerWidth - 16) : r.width;
    const left = menuWidth ? Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) : r.left;
    const top = openAbove
      ? Math.max(viewportTop + viewportPadding, r.top - gap - height)
      : Math.max(viewportTop + viewportPadding, Math.min(r.bottom + gap, viewportBottom - viewportPadding - height));
    setPos({ top: top / zoom, left: left / zoom, width: width / zoom, maxHeight: maxHeight / zoom });
  };

  useLayoutEffect(() => {
    if (!open) return;
    if (multiple) searchRef.current?.focus({ preventScroll: true });
    else if (portal && menuWidth) {
      const option = selectedRef.current ?? listRef.current?.querySelector('button');
      option?.focus({ preventScroll: true });
    }
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
      if (rootRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = multiple ? null : options.find((o) => o.value === value);
  const normalizedQuery = searchText(query.trim());
  const visibleOptions = multiple && normalizedQuery
    ? options.filter((option) => searchText(option.label).includes(normalizedQuery))
    : options;
  const buttonLabel = multiple && value.length ? `${placeholder} (${value.length})` : current?.buttonLabel ?? current?.label ?? placeholder;

  const menu = open && (
    <div
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-multiselectable={multiple || undefined}
      style={{
        ...(portal && pos ? { top: pos.top, left: pos.left, maxHeight: `${pos.maxHeight}px`, ...(menuWidth ? { width: pos.width, minWidth: pos.width } : { minWidth: pos.width }) } : null),
        ...(portal ? null : { marginTop: px(4, sc, 3), maxHeight: px(menuMaxHeight, sc, 200) }),
        fontSize: px(14, sc, 12)
      }}
      className={cn(
        portal ? 'fixed z-[60]' : 'absolute z-40',
        'min-w-full overflow-hidden rounded-lg border border-border bg-card shadow-2xl',
        menuClassName
      )}
      data-scrollable
    >
      <div
        ref={listRef}
        className="dd-scroll overflow-y-auto"
        style={{
          maxHeight: portal && pos ? `${pos.maxHeight}px` : px(menuMaxHeight, sc, 200),
          padding: `${px(4, sc, 3)} ${px(4, sc, 3)} ${px(4, sc, 3)} ${px(4, sc, 3)}`
        }}
      >
        {multiple && (
          <div className="sticky top-0 z-10 bg-card pb-1">
            <Input
              ref={searchRef}
              className="h-9"
              aria-label={`Buscar en ${ariaLabel}`}
              placeholder="Buscar género…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
        {multiple && visibleOptions.length === 0 && <p className="px-2 py-2 text-muted-foreground">No se encontraron géneros.</p>}
        {visibleOptions.map((o) => {
          const active = multiple ? value.includes(o.value) : o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={active}
              ref={active && !multiple ? selectedRef : null}
              onClick={() => {
                if (multiple) {
                  onChange(active ? value.filter((item) => item !== o.value) : [...value, o.value]);
                } else {
                  onChange(o.value);
                  setOpen(false);
                  if (portal && menuWidth) btnRef.current?.focus({ preventScroll: true });
                }
              }}
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
              {multiple && active && <Check aria-hidden className="ml-2 inline h-3.5 w-3.5" />}
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
        onClick={() => {
          if (!open) setQuery('');
          setOpen(!open);
        }}
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
        <span className="min-w-0 flex-1 truncate text-left">{buttonLabel}</span>
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

