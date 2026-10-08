import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { px } from '../../lib/useScale.js';

export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '',
  className,
  menuClassName,
  portal,
  style,
  scale = 1
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const selectedRef = useRef(null);
  const btnRef = useRef(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
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
      ref={listRef}
      role="listbox"
      style={{
        ...(portal && pos ? { top: pos.top, left: pos.left, minWidth: pos.width } : null),
        marginTop: px(4, scale, 3),
        maxHeight: px(256, scale, 200),
        padding: px(4, scale, 3),
        fontSize: px(14, scale, 12)
      }}
      className={cn(
        portal ? 'fixed z-[60]' : 'absolute z-40',
        'min-w-full overflow-y-auto rounded-lg border border-border bg-card shadow-2xl',
        menuClassName
      )}
      data-scrollable
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
              paddingLeft: px(10, scale, 8),
              paddingRight: px(10, scale, 8),
              paddingTop: px(6, scale, 4),
              paddingBottom: px(6, scale, 4),
              fontSize: px(14, scale, 12)
            }}
          >
            {o.label}
          </button>
        );
      })}
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
        className="flex items-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          gap: px(8, scale, 6),
          height: px(32, scale, 27),
          width: '100%',
          paddingLeft: px(12, scale, 10),
          paddingRight: px(10, scale, 8),
          fontSize: px(14, scale, 12)
        }}
      >
        <span className="flex-1 truncate text-left">{current ? current.label : placeholder}</span>
        <ChevronDown
          className={cn('shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
          style={{ width: px(14, scale, 12), height: px(14, scale, 12) }}
        />
      </button>

      {portal
        ? menu && createPortal(menu, document.body)
        : menu}
    </div>
  );
}

