import { useI18n } from '../lib/i18n.js';
import { fontPx, px } from '../lib/useScale.js';

export default function BackupProgress({ progress, scale, compact = false }) {
  const { t } = useI18n();
  if (!progress) return null;
  const determinate = progress.total > 0;
  const value = determinate ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div className="space-y-2 rounded-lg border bg-secondary/40" style={{ padding: px(12, scale, 10), marginBottom: compact ? 0 : px(16, scale, 12) }} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground" style={{ fontSize: fontPx(13, scale, 11) }}>{t(progress.label)}</span>
        {determinate && <span className="shrink-0 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }}>{progress.current} {t('de')} {progress.total}</span>}
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t(progress.label)}
        aria-valuemin={0}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? value : undefined}
      >
        <div
          className={`h-full rounded-full bg-primary transition-[width] duration-200 ${determinate ? '' : 'w-2/5 animate-pulse'}`}
          style={determinate ? { width: `${value}%` } : undefined}
        />
      </div>
      {progress.currentLabel && <p className="truncate text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }} title={progress.currentLabel}>{progress.currentLabel}</p>}
    </div>
  );
}
