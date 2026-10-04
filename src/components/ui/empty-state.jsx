import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils.js';

const TONES = {
  neutral: 'text-muted-foreground/55',
  sad: 'text-muted-foreground/70',
  prompt: 'text-muted-foreground/60',
  error: 'text-destructive/55'
};

export function EmptyState({
  face,
  title,
  description,
  action,
  tone = 'neutral',
  compact = false,
  className
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6',
        className
      )}
    >
      {face && (
        <motion.div
          aria-hidden
          className={cn(
            'font-mono leading-none select-none',
            TONES[tone] || TONES.neutral,
            compact ? 'text-3xl' : 'text-5xl'
          )}
          animate={reduce ? undefined : { y: [0, -5, 0], rotate: [0, -1.5, 1.5, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {face}
        </motion.div>
      )}

      <h3 className={cn('font-semibold text-foreground', face && (compact ? 'mt-3' : 'mt-4'))}>
        {title}
      </h3>

      {description && (
        <p
          className={cn(
            'text-muted-foreground max-w-sm',
            compact ? 'text-xs mt-1' : 'text-sm mt-1.5',
            action ? (compact ? 'mt-3' : 'mb-6') : 'mt-1'
          )}
        >
          {description}
        </p>
      )}

      {action}
    </motion.div>
  );
}
