import { useState } from 'react';
import { cn } from '../lib/utils.js';
import { px } from '../lib/useScale.js';

function ExtensionChoice({ manifest, current, checked, onChange, scale }) {
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  return (
    <label className={cn(
      'flex items-center rounded-lg border border-border px-3 py-2.5',
      current ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent/50',
      checked && !current && 'bg-accent/40'
    )} style={{ gap: px(12, scale, 9), minHeight: px(56, scale, 46) }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={current}
        onChange={onChange}
        aria-label={current ? `${manifest.name}, fuente actual` : `Buscar en ${manifest.name}`}
        style={{ accentColor: 'hsl(var(--primary))', width: px(16, scale, 13), height: px(16, scale, 13), flexShrink: 0 }}
      />
      <span className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-secondary text-secondary-foreground font-semibold" style={{ width: px(36, scale, 30), height: px(36, scale, 30), fontSize: px(14, scale, 12) }}>
        {manifest.icon && !logoUnavailable
          ? <img src={manifest.icon} alt="" className="h-full w-full object-cover" onError={() => setLogoUnavailable(true)} />
          : (manifest.name?.[0] || '?').toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" style={{ fontSize: px(14, scale, 12) }}>{manifest.name}</span>
      <span className="shrink-0 text-muted-foreground" style={{ fontSize: px(12, scale, 10) }}>
        {current ? 'Fuente actual' : ''}
      </span>
    </label>
  );
}

export function MigrationSources({ manifests, sourceId, targetIds, onChange, scale }) {
  const targetManifests = manifests.filter((manifest) => manifest.id !== sourceId);
  return (
    <>
      <div className="mb-2 flex items-center justify-between" style={{ fontSize: px(13, scale, 11) }}>
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
      <div className="dd-scroll flex flex-col overflow-y-auto pr-1" style={{ maxHeight: px(300, scale, 240), gap: px(6, scale, 4) }}>
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
