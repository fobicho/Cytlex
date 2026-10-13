import { cn } from '../../lib/utils.js';

export function Skeleton({ className, ...props }) {
  return <div className={cn('animate-pulse rounded-lg bg-muted/50', className)} {...props} />;
}
