import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils.js';
import { px, fontPx } from '../lib/useScale.js';

function ExtensionChoice({ manifest, current, checked, onChange, scale }) {
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  return (
    <label className={cn(
      'flex items-center rounded-md px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring',
      current ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent/50',
      checked && !current && 'bg-secondary/50'
    )} style={{ gap: px(12, scale, 9), minHeight: px(48, scale, 42) }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={current}
        onChange={onChange}
        aria-label={current ? `${manifest.name}, fuente actual` : `Buscar en ${manifest.name}`}
        style={{ accentColor: 'hsl(var(--primary))', width: px(16, scale, 13), height: px(16, scale, 13), flexShrink: 0 }}
      />
      <span className="grid shrink-0 place-items-center overflow-hidden bg-secondary text-secondary-foreground font-semibold" style={{ width: px(36, scale, 30), height: px(36, scale, 30), borderRadius: px(12, scale, 9), fontSize: fontPx(14, scale, 12) }}>
        {manifest.icon && !logoUnavailable
          ? <img src={manifest.icon} alt="" className="h-full w-full object-cover" onError={() => setLogoUnavailable(true)} />
          : (manifest.name?.[0] || '?').toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" style={{ fontSize: fontPx(14, scale, 12) }}>{manifest.name}</span>
      <span className="shrink-0 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }}>
        {current ? 'Fuente actual' : ''}
      </span>
    </label>
  );
}

export function MigrationSources({ manifests, sourceId, targetIds, onChange, scale }) {
  const targetManifests = manifests.filter((manifest) => manifest.id !== sourceId);
  const scrollTimer = useRef(null);
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2" style={{ fontSize: fontPx(13, scale, 11) }}>
        <span className="text-muted-foreground">
          {targetIds.length} de {targetManifests.length} fuentes seleccionadas
        </span>
        <div className="flex items-center" style={{ gap: px(12, scale, 9) }}>
          <button
            type="button"
            className="text-primary hover:underline disabled:opacity-50"
            disabled={targetIds.length === targetManifests.length}
            onClick={() => onChange(targetManifests.map((manifest) => manifest.id))}
          >
            Todas
          </button>
          <button
            type="button"
            className="text-primary hover:underline disabled:opacity-50"
            disabled={targetIds.length === 0}
            onClick={() => onChange([])}
          >
            Ninguna
          </button>
        </div>
      </div>
      <div className="page-content-scroll flex flex-col overflow-y-auto overscroll-contain pr-1" style={{ maxHeight: `min(${px(300, scale, 240)}, 45dvh)`, gap: px(4, scale, 3) }} onScroll={(event) => {
        const list = event.currentTarget;
        list.classList.add('is-scrolling');
        clearTimeout(scrollTimer.current);
        scrollTimer.current = setTimeout(() => list.classList.remove('is-scrolling'), 700);
      }}>
        {manifests.map((manifest) => {
          const current = manifest.id === sourceId;
          const checked = !current && targetIds.includes(manifest.id);
          return (
            <ExtensionChoice
              key={manifest.id}
              manifest={manifest}
              current={current}
              checked={checked}
              onChange={() => onChange(checked ? targetIds.filter((id) => id !== manifest.id) : [...targetIds, manifest.id])}
              scale={scale}
            />
          );
        })}
      </div>
    </>
  );
}
