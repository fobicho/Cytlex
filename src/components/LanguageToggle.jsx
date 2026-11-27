import { Languages } from 'lucide-react';
import { useI18n } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';

export default function LanguageToggle({ value, onChange, className }) {
  const { t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('Idioma')}
      className={cn('inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1 text-card-foreground shadow-sm', className)}
    >
      <Languages aria-hidden="true" className="ml-1 h-4 w-4 text-muted-foreground" />
      <div className="relative grid grid-cols-2 rounded-lg p-0.5">
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0.5 left-0.5 w-10 rounded-md bg-primary transition-transform duration-200 ease-out',
            value === 'en' && 'translate-x-full'
          )}
        />
        {[
          ['es', 'SPA'],
          ['en', 'ENG']
        ].map(([language, label]) => (
          <button
            key={language}
            type="button"
            aria-pressed={value === language}
            aria-label={language === 'es' ? t('Español') : t('Inglés')}
            onClick={() => onChange?.(language)}
            className={cn(
              'relative z-10 w-10 rounded-lg px-1 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              value === language ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
