import * as React from 'react';
import { motion } from 'framer-motion';
import { usePerformanceMode } from '../../lib/usePerformanceMode.js';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../lib/i18n.js';
import { useLanguageLayoutMotion } from '../../lib/languageLayoutMotion.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-border bg-transparent hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-lg px-8',
        icon: 'h-10 w-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

function localizeChildren(children, t) {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') return t(child);
    if (!React.isValidElement(child) || child.props.children == null) return child;
    return React.cloneElement(child, undefined, localizeChildren(child.props.children, t));
  });
}

const Button = React.forwardRef(({ className, variant, size, children, ...props }, ref) => {
  const { t, isLanguagePreview } = useI18n();
  const reduceMotion = usePerformanceMode();
  const languageLayoutMotion = useLanguageLayoutMotion();
  const animateLanguageLayout = isLanguagePreview || languageLayoutMotion;
  const localizedProps = {
    ...props,
    ...(typeof props.title === 'string' ? { title: t(props.title) } : {}),
    ...(typeof props['aria-label'] === 'string' ? { 'aria-label': t(props['aria-label']) } : {})
  };
  return (
    <motion.button
      layout={animateLanguageLayout && !reduceMotion ? 'size' : false}
      transition={animateLanguageLayout && !reduceMotion
        ? { layout: { duration: 0.24, ease: [0.23, 1, 0.32, 1] } }
        : undefined}
      className={cn(
        buttonVariants({ variant, size, className }),
        animateLanguageLayout && 'transition-colors active:scale-100'
      )}
      ref={ref}
      {...localizedProps}
    >
      {localizeChildren(children, t)}
    </motion.button>
  );
});
Button.displayName = 'Button';

export { Button, buttonVariants };
