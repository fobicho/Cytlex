import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils.js';
import { useScale, px } from '../../lib/useScale.js';

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
  const scale = useScale();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center justify-center text-center', className)}
      style={{
        paddingTop: px(compact ? 32 : 64, scale, compact ? 24 : 40),
        paddingBottom: px(compact ? 32 : 64, scale, compact ? 24 : 40),
        paddingLeft: px(compact ? 16 : 24, scale, 12),
        paddingRight: px(compact ? 16 : 24, scale, 12)
      }}
    >
      {face && (
        <motion.div
          aria-hidden
          className={cn('font-mono leading-none select-none', TONES[tone] || TONES.neutral)}
          style={{
            fontSize: px(compact ? 30 : 48, scale, compact ? 22 : 32),
            marginBottom: px(compact ? 12 : 16, scale, compact ? 9 : 12)
          }}
          animate={reduce ? undefined : { y: [0, -5, 0], rotate: [0, -1.5, 1.5, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {face}
        </motion.div>
      )}

      <h3
        className="font-semibold text-foreground"
        style={{ fontSize: px(compact ? 14 : 16, scale, compact ? 12 : 13) }}
      >
        {title}
      </h3>

      {description && (
        <p
          className="text-muted-foreground max-w-sm"
          style={{
            fontSize: px(compact ? 12 : 14, scale, compact ? 10 : 11),
            marginTop: px(6, scale, 4),
            marginBottom: action ? px(24, scale, 18) : 0
          }}
        >
          {description}
        </p>
      )}

      {action && (
        <div style={{ marginTop: !description ? px(24, scale, 18) : 0 }}>
          {action}
        </div>
      )}
    </motion.div>
  );
}
