import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary border border-primary/20',
        success: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20',
        warning: 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
        outline: 'border border-border text-muted-foreground'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
