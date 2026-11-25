import * as React from 'react';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../lib/i18n.js';

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  const { t } = useI18n();
  const localizedProps = {
    ...props,
    ...(typeof props.placeholder === 'string' ? { placeholder: t(props.placeholder) } : {}),
    ...(typeof props['aria-label'] === 'string' ? { 'aria-label': t(props['aria-label']) } : {})
  };
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200',
        className
      )}
      ref={ref}
      {...localizedProps}
    />
  );
});
Input.displayName = 'Input';

export { Input };
