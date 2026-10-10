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
import { useScale, px } from '../lib/useScale.js';

function Switch({ on, onChange, label, scale = 1 }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        'relative rounded-full transition-colors shrink-0',
        on ? 'bg-primary' : 'bg-muted'
      )}
      style={{
        height: px(24, scale, 20),
        width: px(44, scale, 38)
      }}
    >
      <span
        className="absolute rounded-full bg-background shadow transition-all"
        style={{
          top: px(2, scale, 1.5),
          height: px(20, scale, 17),
          width: px(20, scale, 17),
          left: on ? `calc(${px(44, scale, 38)} - ${px(22, scale, 19)}px)` : px(2, scale, 1.5)
        }}
      />
    </button>
  );
}

function Row({ title, desc, right, first, last, className, scale = 1 }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between',
        !last && 'border-b border-border',
        className
      )}
      style={{
        gap: px(16, scale, 11),
        paddingTop: first ? '0' : px(16, scale, 11),
        paddingBottom: last ? '0' : px(16, scale, 11)
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-tight" style={{ fontSize: px(14, scale, 12) }}>
          {title}
        </div>
        {desc && (
          <div
            className="text-muted-foreground leading-snug"
            style={{ fontSize: px(12, scale, 10), marginTop: px(4, scale, 3) }}
          >
            {desc}
          </div>
        )}
      </div>
      {right && <div className="shrink-0 flex items-center">{right}</div>}
    </div>
  );
}

function Segmented({ value, options, onChange, scale = 1 }) {
  return (
    <div className="flex" style={{ gap: px(8, scale, 5) }}>
      {options.map(([val, label]) => (
        <Button
          key={val}
          size="sm"
          variant={value === val ? 'default' : 'outline'}
          onClick={() => onChange(val)}
          style={{
            height: px(36, scale, 30),
            fontSize: px(14, scale, 12),
            paddingLeft: px(12, scale, 9),
            paddingRight: px(12, scale, 9)
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function Kbd({ children, scale = 1 }) {
  return (
    <kbd
      className="rounded-md border border-border bg-muted text-muted-foreground font-mono"
      style={{
        fontSize: px(11, scale, 9),
        paddingLeft: px(6, scale, 4),
        paddingRight: px(6, scale, 4),
        paddingTop: px(2, scale, 1),
        paddingBottom: px(2, scale, 1)
      }}
    >
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
  const scale = useScale();

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
          scale={scale}
          first
          title="Modo"
          desc="Claro u oscuro"
          right={
            <Segmented
              scale={scale}
              value={s.mode}
              onChange={(m) => set({ mode: m })}
              options={[['dark', 'Oscuro'], ['light', 'Claro']]}
            />
          }
        />
        <div className="pt-6">
          <h3 className="font-medium mb-3" style={{ fontSize: px(14, scale, 12) }}>
            Tema
          </h3>
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
                  style={{ padding: px(16, scale, 11), gap: px(16, scale, 11) }}
                >
                  <div className="flex gap-2 mb-3" style={{ marginBottom: px(12, scale, 8), gap: px(8, scale, 6) }}>
                    <span
                      className="rounded-full border border-border"
                      style={{ background: sw[0], width: px(28, scale, 22), height: px(28, scale, 22) }}
                    />
                    <span
                      className="rounded-full border border-border"
                      style={{ background: sw[1], width: px(28, scale, 22), height: px(28, scale, 22) }}
                    />
                  </div>
                  <div className="font-medium" style={{ fontSize: px(14, scale, 12) }}>
                    {t.name}
                  </div>
                  <div className="text-muted-foreground" style={{ fontSize: px(12, scale, 10) }}>
                    {t.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-border mt-6" />
        <Row
          scale={scale}
          last
          title="Pantalla completa"
          desc="Oculta los bordes de la ventana"
          right={
            <Button
              variant="secondary"
              size="sm"
              onClick={onToggleFullscreen}
              style={{
                height: px(36, scale, 30),
                fontSize: px(14, scale, 12),
                paddingLeft: px(12, scale, 9),
                paddingRight: px(12, scale, 9)
              }}
            >
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
          scale={scale}
          first
          last={s.libraryView !== 'grid'}
          title="Vista"
          desc="Cuadrícula de portadas o lista compacta"
          right={
            <Segmented
              scale={scale}
              value={s.libraryView}
              onChange={(v) => set({ libraryView: v })}
              options={[['grid', 'Grid'], ['list', 'Lista']]}
            />
          }
        />
        {s.libraryView === 'grid' && (
          <>
            <Row
              scale={scale}
              title="Tamaño de las portadas"
              desc="Ajusta el tamaño manteniendo la proporción"
              right={
                <div className="flex items-center gap-3">
                  <Minus
                    className="shrink-0 text-muted-foreground"
                    style={{ width: px(14, scale, 12), height: px(14, scale, 12) }}
                    aria-hidden="true"
                  />
                  <input
                    type="range"
                    min={60}
                    max={260}
                    step={10}
                    value={s.libraryCoverSize}
                    onChange={(e) => set({ libraryCoverSize: Number(e.target.value) })}
                    aria-label="Tamaño de las portadas"
                    className="rounded-full bg-muted accent-primary cursor-pointer"
                    style={{ width: px(160, scale, 110), height: px(6, scale, 4) }}
                  />
                  <Plus
                    className="shrink-0 text-muted-foreground"
                    style={{ width: px(14, scale, 12), height: px(14, scale, 12) }}
                    aria-hidden="true"
                  />
                  <span
                    className="text-muted-foreground text-center"
                    style={{ fontSize: px(14, scale, 12), minWidth: px(46, scale, 38) }}
                  >
                    {s.libraryCoverSize}px
                  </span>
                </div>
              }
            />
            <Row
              scale={scale}
              last
              title="Mostrar capítulos sin leer"
              desc="Muestra un contador en cada portada"
              right={
                <Switch
                  scale={scale}
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
        scale={scale}
        first
        last
        title="Modo por defecto"
        desc="Vertical continuo o paginado"
        right={
          <Segmented
            scale={scale}
            value={s.readerMode}
            onChange={(m) => set({ readerMode: m })}
            options={[['vertical', 'Vertical'], ['paginado', 'Paginado']]}
          />
        }
      />
    );
  } else if (section === 'categorias') {
    const counts = new Map();
    for (const f of lib.favs()) {
      for (const id of f.cats || []) counts.set(id, (counts.get(id) || 0) + 1);
    }

    content = (
      <div className="flex flex-col">
        {cats.map((c, i) => (
          <div
            key={c.id}
            className={cn(
              'flex items-center border-b border-border',
              i === cats.length - 1 && 'border-0'
            )}
            style={{
              gap: px(6, scale, 4),
              paddingTop: i === 0 ? '0' : px(10, scale, 7),
              paddingBottom: i === cats.length - 1 ? '0' : px(10, scale, 7)
            }}
          >
            <Input
              value={c.name}
              onChange={(e) => renameLocal(c.id, e.target.value)}
              onBlur={() => commitRename(c.id)}
              className="bg-muted/50 border-none focus:bg-muted transition-colors"
              aria-label="Nombre de categoría"
              style={{
                height: px(34, scale, 28),
                fontSize: px(14, scale, 12),
                paddingLeft: px(12, scale, 9),
                paddingRight: px(12, scale, 9)
              }}
            />
            <span
              className="shrink-0 tabular-nums text-muted-foreground text-center"
              style={{ fontSize: px(12, scale, 10), minWidth: px(28, scale, 22) }}
              title={`${counts.get(c.id) || 0} mangas en esta categoría`}
            >
              {counts.get(c.id) || 0}
            </span>
            <Button
              variant="ghost"
              size="icon"
              title="Eliminar categoría"
              aria-label={`Eliminar categoría ${c.name}`}
              onClick={() => removeCat(c.id)}
              className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
            >
              <Trash2 style={{ width: px(15, scale, 13), height: px(15, scale, 13) }} />
            </Button>
          </div>
        ))}

        {cats.length === 0 && (
          <p className="text-muted-foreground" style={{ fontSize: px(14, scale, 12) }}>
            No hay categorías. Crea la primera para organizar tu biblioteca.
          </p>
        )}

        <div
          className="flex items-center"
          style={{ gap: px(6, scale, 4), paddingTop: px(12, scale, 9) }}
        >
          <Input
            placeholder="Nueva categoría…"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCat()}
            className="bg-muted/50 border-none focus:bg-muted transition-colors"
            aria-label="Nueva categoría"
            style={{
              height: px(34, scale, 28),
              fontSize: px(14, scale, 12),
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          />
          <Button
            size="icon"
            title="Añadir categoría"
            aria-label="Añadir categoría"
            onClick={addCat}
            className="shrink-0 rounded-lg"
            style={{ width: px(34, scale, 28), height: px(34, scale, 28) }}
          >
            <Plus style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
          </Button>
        </div>
      </div>
    );
  } else if (section === 'extensiones') {
    content = (
      <div>
        <Row
          scale={scale}
          first
          title="Avisar de actualizaciones"
          desc="Revisa el repositorio y avisa cuando una extensión tenga versión nueva."
          right={
            <Switch
              scale={scale}
              on={s.extUpdateNotify}
              onChange={(v) => set({ extUpdateNotify: v })}
              label="Avisar de actualizaciones de extensiones"
            />
          }
        />
        <Row
          scale={scale}
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
                scale={scale}
                on={s.notifyBackground}
                onChange={toggleBackground}
                label="Avisos de extensiones en segundo plano"
              />
            </div>
          }
        />
        <div className="border-t border-border mt-6" />
        <div
          className="text-muted-foreground mt-4 mb-1.5"
          style={{ fontSize: px(12, scale, 10) }}
        >
          Repositorio de extensiones
        </div>
        <Input
          readOnly
          value={s.extIndexUrl || DEFAULT_INDEX_URL}
          className="bg-muted/50 border-none font-mono"
          aria-label="Repositorio de extensiones"
          style={{
            height: px(36, scale, 30),
            fontSize: px(12, scale, 10),
            paddingLeft: px(12, scale, 9),
            paddingRight: px(12, scale, 9)
          }}
        />
        <p className="text-muted-foreground mt-2" style={{ fontSize: px(14, scale, 12) }}>
          Este repositorio aporta las fuentes a Cytlex. No se edita: las extensiones se instalan y
          desinstalan individualmente desde <b className="text-foreground">Explorar › Extensiones</b>.
        </p>
      </div>
    );
  } else if (section === 'notificaciones') {
    content = (
      <div>
        <Row
          scale={scale}
          first
          title="Avisar de capítulos nuevos"
          desc="Revisa los mangas de tu biblioteca y avisa cuando aparezca un capítulo nuevo."
          right={
            <Switch
              scale={scale}
              on={s.notifyEnabled}
              onChange={(v) => set({ notifyEnabled: v })}
              label="Avisar de capítulos nuevos"
            />
          }
        />
        <Row
          scale={scale}
          title="Comprobar cada"
          desc="Cada cuántas horas se revisa la biblioteca."
          right={
            <div className={cn(!s.notifyEnabled && 'pointer-events-none opacity-50')} aria-disabled={!s.notifyEnabled}>
              <Dropdown
                scale={scale}
                style={{ width: px(132, scale, 108) }}
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
          scale={scale}
          last
          title="Notificaciones en segundo plano"
          right={
            <Switch
              scale={scale}
              on={s.notifyBackground}
              onChange={toggleBackground}
              label="Notificaciones en segundo plano"
            />
          }
        />
        {bgErr && (
          <p className="text-destructive mt-2" style={{ fontSize: px(14, scale, 12) }}>
            {bgErr}
          </p>
        )}
      </div>
    );
  } else if (section === 'seguimiento') {
    content = (
      <div>
        <Row
          scale={scale}
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
                style={{
                  height: px(36, scale, 30),
                  fontSize: px(14, scale, 12),
                  paddingLeft: px(12, scale, 9),
                  paddingRight: px(12, scale, 9)
                }}
              >
                <LogOut className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                Desconectar
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={connect}
                disabled={authBusy}
                style={{
                  height: px(36, scale, 30),
                  fontSize: px(14, scale, 12),
                  paddingLeft: px(12, scale, 9),
                  paddingRight: px(12, scale, 9)
                }}
              >
                {authBusy ? (
                  <Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                ) : (
                  <Link2 className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                )}
                Conectar
              </Button>
            )
          }
        />

        {authErr && (
          <p className="text-destructive py-4" style={{ fontSize: px(14, scale, 12) }}>
            {authErr}
          </p>
        )}

        <Row
          scale={scale}
          title="Mangas vinculados"
          desc={
            linkedCount
              ? `${linkedCount} ${linkedCount === 1 ? 'manga vinculado' : 'mangas vinculados'}`
              : 'Sin vínculos. Vincúlalos desde la ficha de cada manga.'
          }
          right={
            <div className="flex items-center" style={{ gap: px(8, scale, 6) }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => anilist.clearCache()}
                style={{
                  height: px(36, scale, 30),
                  fontSize: px(14, scale, 12),
                  paddingLeft: px(12, scale, 9),
                  paddingRight: px(12, scale, 9)
                }}
              >
                <RefreshCw className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                Refrescar caché
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { window.location.hash = '#/seguimiento'; }}
                style={{
                  height: px(36, scale, 30),
                  fontSize: px(14, scale, 12),
                  paddingLeft: px(12, scale, 9),
                  paddingRight: px(12, scale, 9)
                }}
              >
                Ver mi lista
              </Button>
            </div>
          }
        />

        <Row
          scale={scale}
          last
          title="Idioma de la sinopsis"
          desc="AniList guarda el título original del manga"
          right={
            <Segmented
              scale={scale}
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
              i === SHORTCUTS.length - 1 && 'border-0'
            )}
            style={{
              paddingTop: i === 0 ? '0' : px(16, scale, 11),
              paddingBottom: i === SHORTCUTS.length - 1 ? '0' : px(16, scale, 11)
            }}
          >
            <span className="leading-tight" style={{ fontSize: px(14, scale, 12) }}>
              {sc.desc}
            </span>
            <span className="flex items-center shrink-0" style={{ gap: px(4, scale, 3) }}>
              {sc.keys.map((k) => (
                <Kbd key={k} scale={scale}>
                  {k}
                </Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <div
        className="grid items-stretch flex-1"
        style={{
          gap: px(24, scale, 16),
          gridTemplateColumns: `${px(220, scale, 190)} 1fr`
        }}
      >
        <Card className="hover:shadow-sm">
          <nav
            className="flex flex-col"
            aria-label="Categorías de ajustes"
            style={{
              padding: px(8, scale, 6),
              gap: px(4, scale, 2)
            }}
          >
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const on = sec.id === section;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => { setSection(sec.id); sessionSeccion = sec.id; }}
                  className={cn(
                    'flex items-center rounded-lg font-medium transition-colors text-left',
                    on
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                  style={{
                    gap: px(12, scale, 8),
                    paddingLeft: px(12, scale, 8),
                    paddingRight: px(12, scale, 8),
                    paddingTop: px(10, scale, 7),
                    paddingBottom: px(10, scale, 7),
                    fontSize: px(14, scale, 12)
                  }}
                >
                  <Icon
                    className="shrink-0"
                    style={{ width: `${Math.round(16 * scale)}px`, height: `${Math.round(16 * scale)}px` }}
                  />
                  {sec.label}
                </button>
              );
            })}
          </nav>
        </Card>

        <Card className="hover:shadow-sm">
          <div style={{ padding: px(24, scale, 16) }}>{content}</div>
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
