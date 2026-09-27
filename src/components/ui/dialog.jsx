import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils.js';

export function Dialog({ open, onClose, title, description, children, className }) {
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
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className={cn(
              'relative bg-card border border-border/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden',
              className
            )}
          >
            {(title || description) && (
              <div className="px-6 py-4 border-b border-border">
                {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
                {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
              </div>
            )}
            <div className="px-6 pb-8 overflow-y-auto [scrollbar-gutter:stable]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

