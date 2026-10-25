import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils.js';
import { useScale, px } from '../../lib/useScale.js';

export function Dialog({ open, onClose, title, description, children, className, dialogStyle, hideDivider, bodyClassName, bodyPaddingTop = 12, scrollableBody = true, scale }) {
  const sc = scale ?? 1;
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
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
              <div className={cn('shrink-0', !hideDivider && 'border-b border-border')} style={{ padding: `${px(24, sc, 18)} ${px(24, sc, 18)} ${px(12, sc, 9)}` }}>
                {title && <h2 className="font-semibold tracking-tight" style={{ fontSize: px(18, sc, 15) }}>{title}</h2>}
                {description && <p className="text-muted-foreground mt-1" style={{ fontSize: px(13, sc, 11), marginTop: px(4, sc, 3) }}>{description}</p>}
              </div>
            )}
            <div
              className={cn(
                scrollableBody ? 'overflow-y-auto' : 'overflow-hidden',
                bodyClassName
              )}
              style={{ padding: `${px(bodyPaddingTop, sc, bodyPaddingTop * 0.75)} ${px(24, sc, 18)} ${px(24, sc, 18)}` }}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

