import { useEffect, useState } from 'react';
import { Minus, Plus, Palette, Library as LibraryIcon, BookOpen, Puzzle, Keyboard, Tags, Trash2, Link2, RefreshCw, LogOut, Loader2, Bell } from 'lucide-react';
import { settings } from '../lib/settings.js';
import { lib } from '../lib/library.js';
import { anilist } from '../lib/anilist.js';
import { session } from '../lib/session.js';
import { tracking } from '../lib/tracking.js';
import { DEFAULT_INDEX_URL } from '../lib/extensions.js';
import { THEMES } from '../lib/themes.js';
import { notifyHours } from '../lib/notify.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Dropdown } from '../components/ui/dropdown.jsx';
import { Dialog } from '../components/ui/dialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { Input } from '../components/ui/input.jsx';
import { cn } from '../lib/utils.js';

function Switch({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors shrink-0',
        on ? 'bg-primary' : 'bg-muted'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all',
          on ? 'left-[22px]' : 'left-0.5'
        )}
      />
    </button>
  );
}

function Row({ title, desc, right, first, last, className }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4',
        first ? 'pt-0 pb-4' : last ? 'pt-4 pb-0' : 'py-4',
        !last && 'border-b border-border',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">{title}</div>
        {desc && <div className="text-xs text-muted-foreground mt-1 leading-snug">{desc}</div>}
      </div>
      {right && <div className="shrink-0 flex items-center">{right}</div>}
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex gap-2">
      {options.map(([val, label]) => (
        <Button
          key={val}
          size="sm"
          variant={value === val ? 'default' : 'outline'}
          onClick={() => onChange(val)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function Kbd({ children }) {
  return (
    <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
      {children}
    </kbd>
  );
}

const SECTIONS = [
  { id: 'apariencia', label: 'Apariencia', icon: Palette },
  { id: 'biblioteca', label: 'Biblioteca', icon: LibraryIcon },
  { id: 'lector', label: 'Lector', icon: BookOpen },
  { id: 'categorias', label: 'Categorías', icon: Tags },
  { id: 'extensiones', label: 'Extensiones', icon: Puzzle },
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell },
  { id: 'seguimiento', label: 'Seguimiento', icon: Link2 },
  { id: 'atajos', label: 'Atajos', icon: Keyboard }
];

const SHORTCUTS = [
  { keys: ['F11'], desc: 'Pantalla completa' },
  { keys: ['←', '→'], desc: 'Página anterior / siguiente' }
];

let sessionSeccion = '';

export default function Settings({ isFullscreen, onToggleFullscreen }) {
  const [s, setS] = useState(settings.get());
  const [section, setSection] = useState(() => sessionSeccion || 'apariencia');
  const [cats, setCats] = useState(() => lib.cats());
  const [newCat, setNewCat] = useState('');
  const [linkedCount, setLinkedCount] = useState(() => tracking.linkedCount());
  const [authState, setAuthState] = useState({ connected: false });
  const [authViewer, setAuthViewer] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState('');
  const { toast } = useToast();
  const [bgErr, setBgErr] = useState('');

  const toggleBackground = async (on) => {
    setBgErr('');
    if (on) {
      const ok = await window.cytlex?.confirmTask?.();
      if (!ok) return;
    }
    const r = await window.cytlex?.setBackgroundCheck?.(on, notifyHours());
    if (r?.ok === false) {
      setBgErr(r.error || 'No se pudo registrar la tarea.');
      return;
    }
    set({ notifyBackground: on });
  };

  useEffect(() => settings.subscribe(setS), []);
  useEffect(() => tracking.subscribe(() => setLinkedCount(tracking.linkedCount())), []);
  useEffect(() => {
    (async () => {
      const st = await session.status();
      setAuthState(st);
      if (st.connected) setAuthViewer(await session.viewer());
    })();
  }, []);

  const connect = async () => {
    setAuthBusy(true);
    setAuthErr('');
    try {
      const r = await session.login();
      if (!r?.cancelled) {
        setAuthState({ connected: true });
        setAuthViewer(await session.viewer());
      }
    } catch (e) {
      setAuthErr(String(e?.message || e));
    }
    setAuthBusy(false);
  };

  const set = (patch) => setS(settings.set(patch));

  const renameLocal = (id, name) =>
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  const commitRename = (id) =>
    setCats(lib.renameCat(id, cats.find((c) => c.id === id)?.name || ''));
  const [pendingCat, setPendingCat] = useState(null);

  const removeCat = (id) => {
    const name = cats.find((c) => c.id === id)?.name || '';
    const inside = lib.favs().filter((f) => (f.cats || []).includes(id));
    if (inside.length === 0) {
      setCats(lib.removeCat(id));
      return;
    }
    setPendingCat({ id, name, inside });
  };

  const confirmRemoveCat = () => {
    if (!pendingCat) return;
    for (const m of pendingCat.inside) {
      tracking.unlink(m.url, m.sourceId || 'leercapitulo');
      chapterIndex.drop(m.url, m.sourceId || 'leercapitulo');
    }
    lib.removeFavs(pendingCat.inside);
    setCats(lib.removeCat(pendingCat.id));
    toast({
      title: `Categoría "${pendingCat.name}" eliminada`,
      description: `${pendingCat.inside.length} ${pendingCat.inside.length === 1 ? 'manga eliminado' : 'mangas eliminados'} de la biblioteca`,
      variant: 'info'
    });
    setPendingCat(null);
  };
  const addCat = () => {
    const v = newCat.trim();
    if (!v) return;
    setCats(lib.addCat(v));
    setNewCat('');
  };

  let content;
  if (section === 'apariencia') {
    content = (
      <div>
        <Row
          first
          title="Modo"
          desc="Claro u oscuro"
          right={
            <Segmented
              value={s.mode}
              onChange={(m) => set({ mode: m })}
              options={[['dark', 'Oscuro'], ['light', 'Claro']]}
            />
          }
        />
        <div className="pt-6">
          <h3 className="text-sm font-medium mb-3">Tema</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {THEMES.map((t) => {
              const on = s.theme === t.id;
              const sw = t.swatch[s.mode] || t.swatch.dark;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => set({ theme: t.id })}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-colors',
                    on ? 'border-primary ring-2 ring-ring' : 'border-border hover:bg-accent'
                  )}
                >
                  <div className="flex gap-2 mb-3">
                    <span className="w-7 h-7 rounded-full border border-border" style={{ background: sw[0] }} />
                    <span className="w-7 h-7 rounded-full border border-border" style={{ background: sw[1] }} />
                  </div>
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-border mt-6" />
        <Row
          last
          title="Pantalla completa"
          desc="Oculta los bordes de la ventana"
          right={
            <Button variant="secondary" size="sm" onClick={onToggleFullscreen}>
              {isFullscreen ? 'Salir' : 'Activar'}
            </Button>
          }
        />
      </div>
    );
  } else if (section === 'biblioteca') {
    content = (
      <div>
        <Row
          first
          last={s.libraryView !== 'grid'}
          title="Vista"
          desc="Cuadrícula de portadas o lista compacta"
          right={
            <Segmented
              value={s.libraryView}
              onChange={(v) => set({ libraryView: v })}
              options={[['grid', 'Grid'], ['list', 'Lista']]}
            />
          }
        />
        {s.libraryView === 'grid' && (
          <>
            <Row
              title="Tamaño de las portadas"
              desc="Ajusta el tamaño manteniendo la proporción"
              right={
                <div className="flex items-center gap-3">
                  <Minus className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <input
                    type="range"
                    min={60}
                    max={260}
                    step={10}
                    value={s.libraryCoverSize}
                    onChange={(e) => set({ libraryCoverSize: Number(e.target.value) })}
                    aria-label="Tamaño de las portadas"
                    className="w-40 h-1.5 rounded-full bg-muted accent-primary cursor-pointer"
                  />
                  <Plus className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm text-muted-foreground min-w-[46px] text-center">{s.libraryCoverSize}px</span>
                </div>
              }
            />
            <Row
              last
              title="Mostrar capítulos sin leer"
              desc="Muestra un contador en cada portada"
              right={
                <Switch
                  on={s.libraryShowUnread}
                  onChange={(v) => set({ libraryShowUnread: v })}
                  label="Mostrar capítulos sin leer"
                />
              }
            />
          </>
        )}
      </div>
    );
  } else if (section === 'lector') {
    content = (
      <Row
        first
        last
        title="Modo por defecto"
        desc="Vertical continuo o paginado"
        right={
          <Segmented
            value={s.readerMode}
            onChange={(m) => set({ readerMode: m })}
            options={[['vertical', 'Vertical'], ['paginado', 'Paginado']]}
          />
        }
      />
    );
  } else if (section === 'categorias') {
    content = (
      <div className="flex flex-col">
        {cats.map((c, i) => (
          <div
            key={c.id}
            className={cn(
              'flex items-center gap-2 border-b border-border',
              i === 0 ? 'pt-0 pb-4' : 'py-4',
              i === cats.length - 1 && 'border-0 pb-0'
            )}
          >
            <Input
              value={c.name}
              onChange={(e) => renameLocal(c.id, e.target.value)}
              onBlur={() => commitRename(c.id)}
              className="h-9 bg-muted/50 border-none"
              aria-label="Nombre de categoría"
            />
            <Button
              variant="ghost"
              size="icon"
              title="Eliminar categoría"
              aria-label="Eliminar categoría"
              onClick={() => removeCat(c.id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-4">
          <Input
            placeholder="Nueva categoría…"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCat()}
            className="h-9 bg-muted/50 border-none"
            aria-label="Nueva categoría"
          />
          <Button size="icon" title="Añadir categoría" aria-label="Añadir categoría" onClick={addCat}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  } else if (section === 'extensiones') {
    content = (
      <div>
        <Row
          first
          title="Avisar de actualizaciones"
          desc="Revisa el repositorio y avisa cuando una extensión tenga versión nueva."
          right={
            <Switch
              on={s.extUpdateNotify}
              onChange={(v) => set({ extUpdateNotify: v })}
              label="Avisar de actualizaciones de extensiones"
            />
          }
        />
        <Row
          last
          title="Avisos en segundo plano"
          desc={
            s.extUpdateNotify
              ? 'Comprueba con la app cerrada y avisa por el sistema. Al abrir Cytlex siempre te indica si hay novedades.'
              : 'Activa el aviso anterior para poder comprobar con la app cerrada.'
          }
          right={
            <div
              className={cn(!s.extUpdateNotify && 'pointer-events-none opacity-50')}
              aria-disabled={!s.extUpdateNotify}
            >
              <Switch
                on={s.notifyBackground}
                onChange={toggleBackground}
                label="Avisos de extensiones en segundo plano"
              />
            </div>
          }
        />
        <div className="border-t border-border mt-6" />
        <div className="text-xs text-muted-foreground mt-4 mb-1.5">Repositorio de extensiones</div>
        <Input
          readOnly
          value={s.extIndexUrl || DEFAULT_INDEX_URL}
          className="bg-muted/50 border-none font-mono text-xs"
          aria-label="Repositorio de extensiones"
        />
        <p className="text-sm text-muted-foreground mt-2">
          Este repositorio aporta las fuentes a Cytlex. No se edita: las extensiones se instalan y
          desinstalan individualmente desde <b className="text-foreground">Explorar › Extensiones</b>.
        </p>
      </div>
    );
  } else if (section === 'notificaciones') {
    content = (
      <div>
        <Row
          first
          title="Avisar de capítulos nuevos"
          desc="Revisa los mangas de tu biblioteca y avisa cuando aparezca un capítulo nuevo."
          right={
            <Switch
              on={s.notifyEnabled}
              onChange={(v) => set({ notifyEnabled: v })}
              label="Avisar de capítulos nuevos"
            />
          }
        />
        <Row
          title="Comprobar cada"
          desc="Cada cuántas horas se revisa la biblioteca."
          right={
            <div className={cn(!s.notifyEnabled && 'pointer-events-none opacity-50')} aria-disabled={!s.notifyEnabled}>
              <Dropdown
                className="w-[132px]"
                value={notifyHours()}
                onChange={(v) => set({ notifyHours: Number(v) })}
                ariaLabel="Comprobar cada"
                portal
                options={[
                  { value: 6, label: '6 horas' },
                  { value: 12, label: '12 horas' },
                  { value: 24, label: '1 día' }
                ]}
              />
            </div>
          }
        />
        <Row
          last
          className="min-h-[55px]"
          title="Notificaciones en segundo plano"
          right={
            <Switch
              on={s.notifyBackground}
              onChange={toggleBackground}
              label="Notificaciones en segundo plano"
            />
          }
        />
        {bgErr && <p className="text-sm text-destructive mt-2">{bgErr}</p>}
      </div>
    );
  } else if (section === 'seguimiento') {
    content = (
      <div>
        <Row
          first
          title="Cuenta de AniList"
          desc={
            authState.connected
              ? `Conectada${authViewer?.name ? ` como ${authViewer.name}` : ''}${
                  authState.expiresAt
                    ? ` · caduca el ${new Date(authState.expiresAt).toLocaleDateString('es-ES')}`
                    : ''
                }`
              : authState.expired
                ? 'La sesión anterior caducó. Vuelve a conectarte.'
                : 'Sin conectar.'
          }
          right={
            authState.connected ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await session.logout();
                  anilist.clearCache();
                  setAuthState({ connected: false });
                  setAuthViewer(null);
                }}
              >
                <LogOut className="w-4 h-4 mr-2" /> Desconectar
              </Button>
            ) : (
              <Button size="sm" onClick={connect} disabled={authBusy}>
                {authBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                Conectar
              </Button>
            )
          }
        />

        {authErr && <p className="text-sm text-destructive py-4">{authErr}</p>}

        <Row
          title="Mangas vinculados"
          desc={
            linkedCount
              ? `${linkedCount} ${linkedCount === 1 ? 'manga vinculado' : 'mangas vinculados'}`
              : 'Sin vínculos. Vincúlalos desde la ficha de cada manga.'
          }
          right={
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => anilist.clearCache()}>
                <RefreshCw className="w-4 h-4 mr-2" /> Refrescar caché
              </Button>
              <Button variant="secondary" size="sm" onClick={() => { window.location.hash = '#/seguimiento'; }}>
                Ver mi lista
              </Button>
            </div>
          }
        />

        <Row
          last
          title="Idioma de la sinopsis"
          desc="AniList guarda el título original del manga"
          right={
            <Segmented
              value={s.anilistSynopsisLang}
              onChange={(v) => set({ anilistSynopsisLang: v })}
              options={[['romaji', 'Romaji'], ['english', 'Inglés']]}
            />
          }
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col">
        {SHORTCUTS.map((sc, i) => (
          <div
            key={sc.desc}
            className={cn(
              'flex items-center justify-between gap-4 border-b border-border',
              i === 0 ? 'pt-0 pb-4' : 'py-4',
              i === SHORTCUTS.length - 1 && 'border-0 pb-0'
            )}
          >
            <span className="text-sm leading-tight">{sc.desc}</span>
            <span className="flex items-center gap-1 shrink-0">
              {sc.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-stretch flex-1">
        <Card className="hover:shadow-sm">
          <nav className="p-2 flex flex-col gap-1" aria-label="Categorías de ajustes">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const on = sec.id === section;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => { setSection(sec.id); sessionSeccion = sec.id; }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
                    on
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {sec.label}
                </button>
              );
            })}
          </nav>
        </Card>

        <Card className="hover:shadow-sm">
          <div className="p-6">{content}</div>
        </Card>
      </div>

      <Dialog
        open={!!pendingCat}
        onClose={() => setPendingCat(null)}
        title="Eliminar categoría"
        description={
          pendingCat
            ? `"${pendingCat.name}" contiene ${pendingCat.inside.length} ${pendingCat.inside.length === 1 ? 'manga' : 'mangas'}. Si continúas, se eliminarán de la biblioteca y se desvincularán del seguimiento.`
            : ''
        }
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPendingCat(null)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirmRemoveCat}>
            Eliminar
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
