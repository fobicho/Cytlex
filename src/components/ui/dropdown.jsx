import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export function Dropdown({ value, options, onChange, ariaLabel, placeholder = '', className, menuClassName, portal }) {
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
      style={portal && pos ? { top: pos.top, left: pos.left, minWidth: pos.width } : undefined}
      className={cn(
        portal ? 'fixed z-[60]' : 'absolute z-40',
        'mt-1 min-w-full max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-2xl',
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
              'block w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-8 w-full rounded-lg border border-border bg-background pl-3 pr-2.5 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex-1 truncate text-left">{current ? current.label : placeholder}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {portal
        ? menu && createPortal(menu, document.body)
        : menu}
    </div>
  );
}

