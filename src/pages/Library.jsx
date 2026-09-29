import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { lib } from '../lib/library.js';
import { settings } from '../lib/settings.js';
import MangaCard from '../components/MangaCard.jsx';
import { extensions } from '../lib/extensions.js';
import { makeCoverThumb } from '../lib/covers.js';
import { checkLibrary } from '../lib/notify.js';
import { useToast } from '../components/Toast.jsx';
import { Button } from '../components/ui/button.jsx';
import { cn } from '../lib/utils.js';

export default function Library() {
  const [cats, setCats] = useState(() => lib.cats());
  const [sel, setSel] = useState(() => {
    const last = settings.get().libraryCategory;
    const list = lib.cats();
    return list.some((c) => c.id === last) ? last : list[0]?.id || '';
  });
  const [favs, setFavs] = useState(() => lib.favs());
  const [view, setView] = useState(settings.get().libraryView);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();

  const runCheck = async () => {
    setChecking(true);
    try {
      const found = await checkLibrary({ silent: true, force: true });
      const n = found.length;
      if (n === 0) {
        toast({ title: 'Todo está al día', description: 'No hay capítulos nuevos en tu biblioteca.', variant: 'info' });
      } else {
        toast({
          title: n === 1 ? '1 obra actualizada' : `${n} obras actualizadas`,
          description: 'Hay capítulos nuevos disponibles.',
          variant: 'success'
        });
      }
    } catch {
      toast({ title: 'No se pudo comprobar', description: 'Revisa tu conexión e inténtalo de nuevo.', variant: 'error' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => settings.subscribe((s) => setView(s.libraryView)), []);
  useEffect(() => {
    if (cats.some((c) => c.id === sel)) {
      if (settings.get().libraryCategory !== sel) settings.set({ libraryCategory: sel });
      return;
    }
    setSel(cats[0]?.id || '');
  }, [cats, sel]);

  const remove = (manga) => {
    lib.toggleFav(manga);
    setFavs(lib.favs());
  };

  const shown = favs
    .filter((f) => (f.cats || []).includes(sel))
    .slice()
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base', numeric: true }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let changed = false;
      for (const f of shown) {
        if (f.cover && !(f.coverLocal || '').startsWith('data:')) {
          const local = await makeCoverThumb(f.cover);
          if (cancelled) return;
          if (local) {
            lib.updateFav(f.url, { coverLocal: local }, f.sourceId);
            changed = true;
          }
        }
      }
      if (changed && !cancelled) setFavs(lib.favs());
    })();
    return () => { cancelled = true; };
  }, [favs, sel]);

  return (
    <div className="min-h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-6 mb-6">
        {cats.map((c) => {
          const active = c.id === sel;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSel(c.id)}
              className={cn(
                'pb-2 text-sm font-medium border-b-2 transition-colors',
                active
                  ? 'text-foreground border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              {c.name}
            </button>
          );
        })}
        <div className="ml-auto">
          <Button
            size="sm"
            variant="secondary"
            disabled={checking || !favs.length}
            onClick={runCheck}
            title="Buscar actualizaciones"
            className="rounded-lg"
          >
            {checking ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {checking ? 'Buscando…' : 'Buscar actualizaciones'}
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex-1 grid place-items-center text-center text-muted-foreground">
          <div>
            <div className="font-mono text-5xl mb-4">:(</div>
            <p className="text-sm">Tu biblioteca está vacía</p>
          </div>
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-8">
          {shown.map((m, i) => {
            const sid = m.sourceId || 'leercapitulo';
            return <MangaCard key={i} m={m} sourceId={sid} unavailable={!extensions.isInstalled(sid)} minimal from="biblioteca" />;
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((m, i) => {
            const sid = m.sourceId || 'leercapitulo';
            const unavailable = !extensions.isInstalled(sid);
            return (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
                <a
                  href={`#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sid)}&from=biblioteca`}
                  className={cn('flex items-center gap-3 flex-1 min-w-0', unavailable && 'pointer-events-none opacity-60')}
                  aria-disabled={unavailable}
                  tabIndex={unavailable ? -1 : undefined}
                >
                  {m.cover && (
                    <img
                      src={m.cover}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-10 h-14 object-cover rounded-lg shrink-0 bg-black"
                    />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{m.title}</span>
                  </span>
                </a>
                <Button variant="ghost" size="sm" onClick={() => remove(m)} title="Quitar de biblioteca">
                  Quitar
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

