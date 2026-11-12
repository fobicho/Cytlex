import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { useToast } from '../components/Toast.jsx';
import { MigrationSources } from '../components/MigrationSources.jsx';
import { extensions, isExtensionAllowed } from '../lib/extensions.js';
import { getMihonMigration, finishMihonMigration, saveMihonMigration } from '../lib/mihonMigration.js';
import { settings } from '../lib/settings.js';
import { useScale } from '../lib/useScale.js';
import Catalog from './Catalog.jsx';

export default function MihonMigration({ id, location, active }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [, updateIndex] = useState(0);
  const queue = getMihonMigration(id);
  const entry = queue?.entries[queue.index];

  useEffect(() => {
    if (active && !entry) navigate('/biblioteca', { replace: true });
  }, [active, entry, navigate]);

  if (!entry) return null;

  const advance = (migrated) => {
    if (migrated) queue.migrated += 1;
    queue.index += 1;
    if (queue.index < queue.entries.length) {
      updateIndex(queue.index);
      document.querySelector('main')?.scrollTo({ top: 0 });
      return;
    }
    finishMihonMigration(id);
    toast({
      title: 'Importación de Mihon terminada',
      description: `${queue.migrated} migrados · ${queue.index - queue.migrated} omitidos`,
      variant: 'success'
    });
    navigate('/biblioteca', { replace: true });
  };

  return (
    <MigrationStep
      key={queue.index}
      id={`${id}-${queue.index}`}
      entry={entry}
      position={queue.index + 1}
      total={queue.entries.length}
      location={location}
      active={active}
      advance={advance}
    />
  );
}

function MigrationStep({ id, entry, position, total, location, active, advance }) {
  const scale = useScale();
  const manifests = extensions.sources().map(({ manifest }) => manifest)
    .filter((manifest) => isExtensionAllowed(manifest, !!settings.get().showAdultExtensions));
  const [targetIds, setTargetIds] = useState(() => manifests.map(({ id }) => id));
  const [query, setQuery] = useState(entry.manga.title);
  const [search, setSearch] = useState('');
  const selectedIds = targetIds.filter((id) => manifests.some((manifest) => manifest.id === id));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Migrar desde Mihon · {position} de {total}</p>
        <h1 className="break-words text-xl font-semibold">{entry.manga.title}</h1>
        <p className="break-words text-sm text-muted-foreground">Fuente del respaldo: {entry.manga.sourceName}</p>
      </div>
      {search ? (
        <Catalog
          locationOverride={{ ...location, search }}
          active={active}
          migrationInline={{
            origin: 'explorar',
            returnTo: location.pathname + location.search,
            onBack: () => setSearch(''),
            onConfirm: (manga, sourceId, detail) => {
              saveMihonMigration(entry, manga.url, sourceId, detail);
              advance(true);
            }
          }}
        />
      ) : (
        <form className="max-w-lg space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (!query.trim() || !selectedIds.length) return;
          const params = new URLSearchParams({
            tab: 'mangas',
            q: query.trim(),
            migrationFrom: entry.manga.url,
            migrationSource: entry.manga.sourceId,
            migrationTargets: selectedIds.join(','),
            migrationSearchId: id
          });
          setSearch(`?${params}`);
        }}>
          <label className="block text-sm">
            Título para buscar
            <Input className="mt-1" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {manifests.length ? (
            <MigrationSources manifests={manifests} targetIds={selectedIds} onChange={setTargetIds} scale={scale} />
          ) : (
            <p className="text-sm text-muted-foreground">Instala o habilita al menos una fuente para buscar este manga.</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => advance(false)}>Omitir manga</Button>
            <Button type="submit" disabled={!query.trim() || !selectedIds.length}>Buscar</Button>
          </div>
        </form>
      )}
    </div>
  );
}
