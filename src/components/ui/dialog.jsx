import { motion, AnimatePresence } from 'framer-motion';
import { useId, useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/utils.js';
import { useScale, px, fontPx } from '../../lib/useScale.js';

const activeDialogs = [];
const FOCUSABLE_SELECTOR = '[autofocus], button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="option"], [tabindex]:not([tabindex="-1"])';

function DialogContent({ onClose, title, ariaLabel, description, children, className, dialogStyle, hideDivider, bodyClassName, headerPaddingTop = 24, headerPaddingBottom = 12, bodyPaddingTop = 12, bodyPaddingBottom = 24, bodyPaddingX = 24, descriptionMarginTop = 4, scrollableBody = true, scale }) {
  const currentScale = useScale();
  const sc = scale ?? currentScale;
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const id = useId();
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    activeDialogs.push(dialog);
    const frame = requestAnimationFrame(() => {
      if (activeDialogs[activeDialogs.length - 1] !== dialog) return;
      const firstFocusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
        .find((element) => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
      (firstFocusable || dialog).focus({ preventScroll: true });
    });

    const onKeyDown = (event) => {
      if (activeDialogs[activeDialogs.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        const owner = event.target instanceof Element
          ? event.target.closest('[data-dialog-owner]')?.getAttribute('data-dialog-owner')
          : null;
        if (owner === id) return;
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const ownedPortals = [...document.querySelectorAll('[data-dialog-owner]')]
        .filter((element) => element.getAttribute('data-dialog-owner') === id);
      const scope = [dialog, ...ownedPortals];
      const containsFocus = scope.some((element) => element.contains(document.activeElement));
      const focusedListbox = document.activeElement instanceof Element
        ? document.activeElement.closest('[role="listbox"]')
        : null;
      if (focusedListbox?.getAttribute('data-dialog-owner') === id) {
        event.preventDefault();
        const trigger = [...dialog.querySelectorAll('[aria-controls]')]
          .find((element) => element.getAttribute('aria-controls') === focusedListbox.id);
        const targets = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
          .filter((element) => !element.closest('[role="listbox"]')
            && element.getAttribute('aria-hidden') !== 'true'
            && element.getClientRects().length > 0);
        const triggerIndex = targets.indexOf(trigger);
        const next = event.shiftKey
          ? targets[triggerIndex - 1] || targets[targets.length - 1]
          : targets[triggerIndex + 1] || targets[0];
        (next || dialog).focus({ preventScroll: true });
        return;
      }
      const focusable = [...new Set(scope.flatMap((element) => [...element.querySelectorAll(FOCUSABLE_SELECTOR)]))]
        .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeIndex = focusable.indexOf(document.activeElement);
      if (event.shiftKey && (activeIndex === 0 || activeIndex === -1 || !containsFocus)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (activeIndex === focusable.length - 1 || activeIndex === -1 || !containsFocus)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      const activeIndex = activeDialogs.lastIndexOf(dialog);
      if (activeIndex !== -1) activeDialogs.splice(activeIndex, 1);
      const nextDialog = activeDialogs[activeDialogs.length - 1];
      const previousOwner = previousFocus instanceof Element
        ? previousFocus.closest('[data-dialog-owner]')?.getAttribute('data-dialog-owner')
        : null;
      const canRestoreFocus = !nextDialog
        || nextDialog.contains(previousFocus)
        || previousOwner === nextDialog.getAttribute('data-dialog-id');
      if (canRestoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [id]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        ref={dialogRef}
        data-dialog-id={id}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel || 'Diálogo'}
        aria-labelledby={title ? `${id}-title` : undefined}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className={cn(
          'relative bg-card border border-border/50 rounded-2xl shadow-sm w-full max-w-lg max-h-[90vh] overflow-hidden',
          className
        )}
        style={dialogStyle}
      >
        {(title || description) && (
          <div className={cn('shrink-0', !hideDivider && 'border-b border-border')} style={{ padding: `${px(headerPaddingTop, sc, headerPaddingTop * 0.75)} ${px(24, sc, 18)} ${px(headerPaddingBottom, sc, headerPaddingBottom * 0.75)}` }}>
            {title && <h2 id={`${id}-title`} className="font-semibold tracking-tight" style={{ fontSize: fontPx(18, sc, 15) }}>{title}</h2>}
            {description && <p id={`${id}-description`} className="text-muted-foreground mt-1" style={{ fontSize: fontPx(13, sc, 11), marginTop: px(descriptionMarginTop, sc, descriptionMarginTop * 0.75) }}>{description}</p>}
          </div>
        )}
        <div
          className={cn(
            scrollableBody ? 'overflow-y-auto' : 'overflow-hidden',
            bodyClassName
          )}
          style={{ padding: `${px(bodyPaddingTop, sc, bodyPaddingTop * 0.75)} ${px(bodyPaddingX, sc, bodyPaddingX * 0.75)} ${px(bodyPaddingBottom, sc, bodyPaddingBottom * 0.75)}` }}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export function Dialog({ open, ...props }) {
  return (
    <AnimatePresence>
      {open && <DialogContent {...props} />}
    </AnimatePresence>
  );
}

