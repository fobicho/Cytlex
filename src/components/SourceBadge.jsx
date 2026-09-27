import { useState } from 'react';
import { cn } from '../lib/utils.js';

export function SourceBadge({ m, className }) {
  const [ok, setOk] = useState(true);
  return (
    <div
      className={cn(
        'w-7 h-7 rounded-lg bg-secondary text-secondary-foreground grid place-items-center text-xs font-bold shrink-0 overflow-hidden',
        className
      )}
    >
      {m.icon && ok ? (
        <img src={m.icon} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setOk(false)} />
      ) : (
        (m.name?.[0] || '?').toUpperCase()
      )}
    </div>
  );
}
