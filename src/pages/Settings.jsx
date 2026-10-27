import { useEffect, useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { Minus, Plus, Palette, Library as LibraryIcon, BookOpen, Puzzle, Keyboard, Tags, Trash2, Link2, RefreshCw, LogOut, Loader2, Bell, Heart, X, Database, Download, Upload } from 'lucide-react';
import { resolveMode, settings } from '../lib/settings.js';
import { lib } from '../lib/library.js';
import { anilist } from '../lib/anilist.js';
import { session } from '../lib/session.js';
import { tracking } from '../lib/tracking.js';
import { MODES, THEMES } from '../lib/themes.js';
import { notifyHours } from '../lib/notify.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { compressBackup, createBackup, parseBackup, readBackupFile, restoreBackup } from '../lib/backup.js';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Dropdown } from '../components/ui/dropdown.jsx';
import { Dialog } from '../components/ui/dialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { Input } from '../components/ui/input.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

function Switch({ on, onChange, label, disabled = false, scale = 1 }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative rounded-full transition-colors shrink-0 disabled:cursor-wait disabled:opacity-60',
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
          left: on ? `calc(${px(44, scale, 38)} - ${px(22, scale, 19)})` : px(2, scale, 1.5)
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

function ConnectHint({ open, hintRef, scale, reduceMotion, className }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={hintRef}
          role="status"
          initial={{
            opacity: 0,
            transform: reduceMotion ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.98)'
          }}
          animate={{ opacity: 1, transform: 'translateY(0) scale(1)' }}
          exit={{
            opacity: 0,
            transform: reduceMotion ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.98)'
          }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className={cn('absolute right-0 top-full z-20 mt-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground shadow-lg whitespace-nowrap', className)}
          style={{ fontSize: px(12, scale, 10) }}
        >
          ¡Conecta tu cuenta primero!
        </motion.div>
      )}
    </AnimatePresence>
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
            paddingRight: px(12, scale, 9),
            minWidth: px(40, scale, 32),
            justifyContent: 'center'
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
  { id: 'respaldo', label: 'Respaldo', icon: Database },
  { id: 'atajos', label: 'Atajos', icon: Keyboard }
];

const SHORTCUTS = [
  { keys: ['Ctrl', 'Espacio'], desc: 'Abrir la búsqueda rápida de mangas' },
  { keys: ['F11'], desc: 'Pantalla completa' },
  { keys: ['←', '→'], desc: 'Página anterior / siguiente' }
];

let sessionSeccion = '';

export default function Settings({ tutorialPreview = false }) {
  const location = useLocation();
  const [s, setS] = useState(settings.get());
  const [section, setSection] = useState(() => sessionSeccion || 'apariencia');
  const [cats, setCats] = useState(() => lib.cats());
  const [newCat, setNewCat] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [linkedCount, setLinkedCount] = useState(() => tracking.linkedCount());
  const [authState, setAuthState] = useState({ connected: false });
  const [authViewer, setAuthViewer] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState('');
  const [connectHintFor, setConnectHintFor] = useState(null);
  const connectHintRef = useRef(null);
  const { toast } = useToast();
  const [bgErr, setBgErr] = useState('');
  const [bgBusy, setBgBusy] = useState(false);
  const [confirmBackground, setConfirmBackground] = useState(false);
  const [confirmAdultExtensions, setConfirmAdultExtensions] = useState(false);
  const [confirmRemoveRepo, setConfirmRemoveRepo] = useState(false);
  const [backupCandidate, setBackupCandidate] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupFileInputRef = useRef(null);
  const removeRepoRef = useRef(null);
  const settingsRootRef = useRef(null);
  const scaleTransitionTimeoutRef = useRef(null);
  const [showDonate, setShowDonate] = useState(
    () => !document.body.classList.contains('tutorial-open') && !settings.get().donationSeen
  );
  const scale = useScale();
  const reduceMotion = useReducedMotion();

  const applyBackgroundSetting = async (on) => {
    const previous = settings.get().notifyBackground;
    setBgBusy(true);
    set({ notifyBackground: on });
    try {
      const r = await window.cytlex?.setBackgroundCheck?.(on, notifyHours());
      if (r?.ok === false) {
        set({ notifyBackground: previous });
        setBgErr(r.error || 'No se pudo registrar la tarea.');
      }
    } catch (error) {
      set({ notifyBackground: previous });
      setBgErr(String(error?.message || 'No se pudo registrar la tarea.'));
    } finally {
      setBgBusy(false);
    }
  };

  const toggleBackground = (on) => {
    setBgErr('');
    if (on) {
      setConfirmBackground(true);
      return;
    }
    applyBackgroundSetting(false);
  };

  useEffect(() => settings.subscribe(setS), []);
  useEffect(() => () => {
    if (tutorialPreview) sessionSeccion = '';
  }, [tutorialPreview]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextSection = params.get('tutorial') === '1' ? params.get('section') : null;
    if (!SECTIONS.some(({ id }) => id === nextSection)) return;
    setSection(nextSection);
    sessionSeccion = nextSection;
  }, [location.search]);
  useEffect(() => () => {
    window.clearTimeout(scaleTransitionTimeoutRef.current);
    settingsRootRef.current?.classList.remove('ui-scale-transition');
  }, []);
  useEffect(() => tracking.subscribe(() => setLinkedCount(tracking.linkedCount())), []);
  useEffect(() => {
    if (!connectHintFor) return;
    const timer = window.setTimeout(() => setConnectHintFor(null), 3000);
    const dismissOutside = (event) => {
      if (!connectHintRef.current?.contains(event.target)) setConnectHintFor(null);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [connectHintFor]);
  useEffect(() => {
    if (!confirmRemoveRepo) return;
    const onDown = (e) => {
      if (removeRepoRef.current && !removeRepoRef.current.contains(e.target)) {
        setConfirmRemoveRepo(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmRemoveRepo]);
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
        setConnectHintFor(null);
      }
    } catch (e) {
      setAuthErr(String(e?.message || e));
    }
    setAuthBusy(false);
  };

  const set = (patch) => setS(settings.set(patch));
  const setUiScale = (value) => {
    const root = settingsRootRef.current;
    if (!reduceMotion && root) {
      root.classList.add('ui-scale-transition');
      window.clearTimeout(scaleTransitionTimeoutRef.current);
      scaleTransitionTimeoutRef.current = window.setTimeout(() => {
        root.classList.remove('ui-scale-transition');
      }, 240);
    }
    set({ uiScale: value });
  };
  const setAppearance = (patch) => {
    const run = () => flushSync(() => set(patch));
    if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
      document.startViewTransition(run);
    } else {
      run();
    }
  };

  const addRepo = () => {
    const url = repoInput.trim();
    if (!url) return;
    set({ extIndexUrl: url });
    setRepoInput('');
  };

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

  const backupFileName = () => `cytlex-respaldo-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`;

  const exportBackup = async () => {
    setBackupBusy(true);
    try {
      const content = JSON.stringify(createBackup());
      if (window.cytlex?.saveBackup) {
        const result = await window.cytlex.saveBackup({ content, fileName: backupFileName() });
        if (result?.canceled) return;
        if (!result?.ok) throw new Error(result?.error || 'No se pudo guardar el respaldo.');
      } else {
        const compressed = await compressBackup(content);
        const blob = new Blob([compressed], { type: 'application/gzip' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = backupFileName();
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast({ title: 'Respaldo exportado', description: 'El archivo se guardó correctamente.', variant: 'success' });
    } catch (error) {
      toast({ title: 'No se pudo exportar el respaldo', description: error.message, variant: 'error' });
    } finally {
      setBackupBusy(false);
    }
  };

  const loadBackupContent = (content, fileName) => {
    try {
      const backup = parseBackup(content);
      setBackupCandidate({ ...backup, fileName });
    } catch (error) {
      toast({ title: 'Respaldo no válido', description: error.message, variant: 'error' });
    }
  };

  const importBackup = async () => {
    if (!window.cytlex?.openBackup) {
      backupFileInputRef.current?.click();
      return;
    }
    setBackupBusy(true);
    try {
      const result = await window.cytlex.openBackup();
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.error || 'No se pudo abrir el archivo.');
      loadBackupContent(result.content, result.fileName);
    } catch (error) {
      toast({ title: 'No se pudo importar el respaldo', description: error.message, variant: 'error' });
    } finally {
      setBackupBusy(false);
    }
  };

  const confirmBackupImport = () => {
    if (!backupCandidate) return;
    try {
      restoreBackup(backupCandidate.data);
      setBackupCandidate(null);
      toast({ title: 'Respaldo restaurado', description: 'Cytlex se recargará para aplicar los datos.', variant: 'success' });
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      toast({ title: 'No se pudo restaurar el respaldo', description: error.message, variant: 'error' });
    }
  };

  let content;
  if (section === 'apariencia') {
    content = (
      <div>
        <Row
          scale={scale}
          first
          title="Modo"
          desc="Cambia los colores que se ven en la aplicación"
          right={
            <Segmented
              scale={scale}
              value={s.mode}
              onChange={(m) => setAppearance({ mode: m })}
              options={MODES.map(({ id, name }) => [id, name])}
            />
          }
        />
        <div style={{ paddingTop: px(16, scale, 11) }}>
          <h3 className="font-medium leading-tight mb-3" style={{ fontSize: px(14, scale, 12) }}>
            Tema
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {THEMES.map((t) => {
              const on = s.theme === t.id;
              const sw = t.swatch[resolveMode(s.mode)] || t.swatch.dark;
              return (
                <button
                  key={t.id}
                  type="button"
                    onClick={() => setAppearance({ theme: t.id })}
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
        <div className="border-t border-border" style={{ marginTop: px(16, scale, 11) }} />
        <Row
          scale={scale}
          last
          title="Tamaño de la interfaz"
          desc="Ajusta el tamaño general de la UI"
          right={
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setUiScale(Math.max(0.8, (s.uiScale || 1) - 0.05))}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Reducir escala"
              >
                <Minus style={{ width: px(14, scale, 12), height: px(14, scale, 12) }} />
              </button>
              <input
                type="range"
                min={0.8}
                max={1.2}
                step={0.05}
                value={s.uiScale || 1}
                onChange={(e) => setUiScale(Number(e.target.value))}
                aria-label="Tamaño de la interfaz"
                className="rounded-full bg-muted accent-primary cursor-pointer"
                style={{ width: px(160, scale, 110), height: px(6, scale, 4) }}
              />
              <button
                type="button"
                onClick={() => setUiScale(Math.min(1.2, (s.uiScale || 1) + 0.05))}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Aumentar escala"
              >
                <Plus style={{ width: px(14, scale, 12), height: px(14, scale, 12) }} />
              </button>
              <span
                className="text-muted-foreground text-center"
                style={{ fontSize: px(14, scale, 12), minWidth: px(46, scale, 38) }}
              >
                {Math.round((s.uiScale || 1) * 100)}%
              </span>
            </div>
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
          title="Vista"
          desc="Elige cómo se despliegan los mangas en la biblioteca"
          right={
            <Segmented
              scale={scale}
              value={s.libraryView}
              onChange={(v) => set({ libraryView: v })}
              options={[['grid', 'Portadas'], ['list', 'Compacta']]}
            />
          }
        />
        <Row
          scale={scale}
          title="Capítulos por fila"
          desc="Cantidad de capítulos por fila en la ficha de un manga"
          right={
            <Segmented
              scale={scale}
              value={s.chaptersPerRow}
              onChange={(v) => set({ chaptersPerRow: v })}
              options={[[1, '1'], [2, '2'], [3, '3']]}
            />
          }
        />
        <Row
          scale={scale}
          last
          title="Mostrar capítulos sin leer"
          desc="Muestra el contador de capítulos restantes de cada manga en la biblioteca"
          right={
            <Switch
              scale={scale}
              on={s.libraryShowUnread}
              onChange={(v) => set({ libraryShowUnread: v })}
              label="Mostrar capítulos sin leer"
            />
          }
        />
      </div>
    );
  } else if (section === 'lector') {
    content = (
      <>
        <Row
          scale={scale}
          first
          title="Modo por defecto"
          desc="Elige tu modo de lectura predeterminado"
          right={
            <Segmented
              scale={scale}
              value={s.readerMode}
              onChange={(m) => set({ readerMode: m })}
              options={[['vertical', 'Vertical'], ['paginado', 'Paginado (ID)'], ['paginado-rtl', 'Paginado (DI)']]}
            />
          }
        />
        <Row
          scale={scale}
          last
          title="Doble página"
          desc="Muestra dos páginas a la vez en modo paginado"
          right={
            <Switch
              scale={scale}
              on={s.readerDoublePage}
              onChange={(v) => set({ readerDoublePage: v })}
              label="Doble página"
            />
          }
        />
      </>
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
          title="Mostrar extensiones +18"
          desc="Algunas extensiones podrían  no mostrarse sin esta opción activa"
          right={
            <Switch
              scale={scale}
              on={s.showAdultExtensions}
              onChange={(v) => {
                if (v) setConfirmAdultExtensions(true);
                else set({ showAdultExtensions: false });
              }}
              label="Mostrar extensiones +18"
            />
          }
        />
        <div style={{ marginTop: px(18, scale, 12) }}>
          <div className="font-medium leading-tight mb-2" style={{ fontSize: px(14, scale, 12) }}>
            Repositorio de extensiones
          </div>
        </div>
        <div className="flex items-center" style={{ gap: px(8, scale, 6) }}>
          <Input
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRepo(); }}
            placeholder="https://…/index.json"
            spellCheck={false}
            className="bg-muted/50 border-none font-mono"
            aria-label="Repositorio de extensiones"
            style={{
              height: px(34, scale, 28),
              fontSize: px(13, scale, 11),
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          />
          <Button
            size="icon"
            title="Añadir repositorio"
            aria-label="Añadir repositorio"
            onClick={addRepo}
            className="shrink-0 rounded-lg"
            style={{ width: px(34, scale, 28), height: px(34, scale, 28) }}
          >
            <Plus style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
          </Button>
        </div>
        {s.extIndexUrl && (
          <div
            className="flex items-center border-t border-border"
            style={{ gap: px(6, scale, 4), marginTop: px(10, scale, 7), paddingTop: px(10, scale, 7) }}
          >
            <span
              className="flex-1 min-w-0 truncate font-mono text-foreground"
              title={s.extIndexUrl}
              style={{ fontSize: px(13, scale, 11) }}
            >
              {s.extIndexUrl}
            </span>
            <div
              ref={removeRepoRef}
              className="relative flex items-center justify-center shrink-0"
              style={{ width: px(34, scale, 28), height: px(34, scale, 28) }}
            >
              <Button
                variant="ghost"
                size="icon"
                title="Quitar repositorio"
                aria-label="Quitar repositorio"
                onClick={() => setConfirmRemoveRepo(true)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                style={{ width: px(34, scale, 28), height: px(34, scale, 28) }}
              >
                <Trash2 style={{ width: px(15, scale, 13), height: px(15, scale, 13) }} />
              </Button>
              <AnimatePresence>
                {confirmRemoveRepo && (
                  <motion.div
                    key="confirm-remove-repo"
                    initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                    exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                    transition={{ duration: 0.14, ease: 'easeOut' }}
                    className="absolute z-20 rounded-lg border border-border bg-card shadow-lg"
                    style={{ top: '100%', left: '50%', marginTop: px(6, scale, 4), padding: px(8, scale, 6) }}
                  >
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setConfirmRemoveRepo(false);
                        set({ extIndexUrl: '' });
                      }}
                      style={{ height: px(28, scale, 24), fontSize: px(12, scale, 10), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                    >
                      Quitar
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    );
  } else if (section === 'notificaciones') {
    content = (
      <div>
        <Row
          scale={scale}
          first
          title="Avisar de capítulos nuevos"
          desc="Avisa de novedades en tus mangas guardados cada vez que se ingresa"
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
          title="Avisar de actualizaciones de extensiones"
          desc="Avisa de novedades en tus extensiones instaladas cada vez que se ingresa"
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
          title="Comprobar cada"
          desc="Elige cada cuántas horas quieres que se revisen las novedades"
          right={
             <div className={cn('flex items-center', !s.notifyEnabled && !s.extUpdateNotify && 'pointer-events-none opacity-50')} aria-disabled={!s.notifyEnabled && !s.extUpdateNotify}>
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
          desc={
            s.notifyEnabled || s.extUpdateNotify
              ? 'Comprueba si hay novedades aún con Cytlex cerrado'
              : 'Activa algún aviso anterior para poder comprobar actualizaciones con Cytlex cerrado'
          }
          right={
            <div
              className={cn('flex items-center', !s.notifyEnabled && !s.extUpdateNotify && 'pointer-events-none opacity-50')}
              aria-disabled={!s.notifyEnabled && !s.extUpdateNotify}
            >
              <Switch
                scale={scale}
                on={s.notifyBackground}
                onChange={toggleBackground}
                disabled={bgBusy}
                label="Notificaciones en segundo plano"
              />
            </div>
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
              ? `Conectado${authViewer?.name ? ` como ${authViewer.name}` : ''}`
              : authState.expired
                ? 'Sesión caducada, vuelve a conectarte'
                : 'Sin conectar'
          }
          right={
            authState.connected ? (
              <Button
                variant="destructive"
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
          title="Mostrar portada de AniList"
          desc="Cambia las portadas de tus mangas guardados por las de AniList (solo mangas vinculados)"
          right={
            <div className="relative flex items-center">
              <Switch
                scale={scale}
                on={s.anilistCover}
                onChange={(v) => {
                  if (!authState.connected) {
                    setConnectHintFor('cover');
                    return;
                  }
                  setConnectHintFor(null);
                  set({ anilistCover: v });
                }}
                label="Mostrar portada de AniList"
              />
              <ConnectHint
                open={connectHintFor === 'cover'}
                hintRef={connectHintRef}
                scale={scale}
                reduceMotion={reduceMotion}
                className="mt-2"
              />
            </div>
          }
        />
        <Row
          scale={scale}
          last
          title="Mangas vinculados"
          desc={
            linkedCount
              ? `${linkedCount} ${linkedCount === 1 ? 'manga vinculado' : 'mangas vinculados'}`
              : 'Sin vínculos'
          }
          right={
            <div className="flex items-center" style={{ gap: px(8, scale, 6) }}>
              <div className="relative">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (!authState.connected) {
                      setConnectHintFor('refresh');
                      return;
                    }
                    setConnectHintFor(null);
                    anilist.clearCache();
                  }}
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
                <ConnectHint
                  open={connectHintFor === 'refresh'}
                  hintRef={connectHintRef}
                  scale={scale}
                  reduceMotion={reduceMotion}
                />
              </div>
              <div className="relative">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (!authState.connected) {
                      setConnectHintFor('list');
                      return;
                    }
                    setConnectHintFor(null);
                    window.location.hash = '#/seguimiento';
                  }}
                  style={{
                    height: px(36, scale, 30),
                    fontSize: px(14, scale, 12),
                    paddingLeft: px(12, scale, 9),
                    paddingRight: px(12, scale, 9)
                  }}
                >
                  Ver mi lista
                </Button>
                <ConnectHint
                  open={connectHintFor === 'list'}
                  hintRef={connectHintRef}
                  scale={scale}
                  reduceMotion={reduceMotion}
                />
              </div>
            </div>
          }
        />
      </div>
    );
  } else if (section === 'respaldo') {
    content = (
      <div className="flex flex-col">
        <input
          ref={backupFileInputRef}
          type="file"
          accept=".json,.gz,application/json,application/gzip"
          className="hidden"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            if (file.size > 100 * 1024 * 1024) {
              toast({ title: 'Respaldo demasiado grande', description: 'El límite de importación es 100 MB.', variant: 'error' });
              return;
            }
            try {
              loadBackupContent(await readBackupFile(file), file.name);
            } catch (error) {
              toast({ title: 'No se pudo leer el respaldo', description: error.message, variant: 'error' });
            }
          }}
        />
        <Row
          scale={scale}
          first
          title="Exportar respaldo"
          desc="Guarda una copia de tus datos en el directorio de tu preferencia"
          right={
            <Button
              size="sm"
              onClick={exportBackup}
              disabled={backupBusy}
              style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
            >
              <Download className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
              Exportar
            </Button>
          }
        />
        <Row
          scale={scale}
          last
          title="Importar respaldo"
          desc="Restaura tus datos desde un respaldo creado en Cytlex"
          right={
            <Button
              size="sm"
              variant="secondary"
              onClick={importBackup}
              disabled={backupBusy}
              style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
            >
              <Upload className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
              Importar
            </Button>
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
    <div ref={settingsRootRef} className="min-h-full flex flex-col">
      <AnimatePresence initial={false}>
        {showDonate && (
          <motion.div
            initial={false}
            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ overflow: 'hidden', marginBottom: px(20, scale, 15) }}
          >
            <div
              className="relative flex flex-col rounded-xl border border-primary/25 bg-primary/5 md:flex-row md:items-center"
              style={{ gap: px(12, scale, 9), padding: px(16, scale, 12), paddingRight: px(48, scale, 38) }}
            >
              <div
                className="grid shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
                aria-hidden="true"
                style={{ width: px(36, scale, 30), height: px(36, scale, 30) }}
              >
                <Heart style={{ width: px(18, scale, 15), height: px(18, scale, 15) }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-tight" style={{ fontSize: px(14, scale, 12) }}>
                  ¿Te gusta Cytlex?
                </div>
                <div className="text-muted-foreground leading-relaxed" style={{ fontSize: px(13, scale, 11), marginTop: px(4, scale, 3) }}>
                  Si quieres, puedes apoyar su mantenimiento con una donación. Cada aporte ayuda a seguir mejorando la aplicación.
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  const url = 'https://ko-fi.com/fobicho';
                  if (window.cytlex?.openExternal) window.cytlex.openExternal(url);
                  else window.open(url, '_blank', 'noopener');
                }}
                className="shrink-0 self-start md:self-center"
                style={{
                  height: px(34, scale, 28),
                  fontSize: px(13, scale, 11),
                  gap: px(8, scale, 6),
                  paddingLeft: px(14, scale, 11),
                  paddingRight: px(14, scale, 11)
                }}
              >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: px(15, scale, 13), height: px(15, scale, 13) }}>
                    <path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298" />
                  </svg>
                  Apoyar en Ko-fi
              </Button>
              <button
                type="button"
                onClick={() => {
                  setShowDonate(false);
                  set({ donationSeen: true });
                }}
                aria-label="Cerrar"
                className="absolute right-2 top-2 grid place-items-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                style={{ width: px(24, scale, 20), height: px(24, scale, 20) }}
              >
                <X style={{ width: px(14, scale, 12), height: px(14, scale, 12) }} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
          <div key={section} style={{ padding: px(24, scale, 16) }}>{content}</div>
        </Card>
      </div>

      <Dialog
        open={confirmBackground}
        onClose={() => setConfirmBackground(false)}
        title="Notificaciones en segundo plano"
        description="¿Permitir que Cytlex revise tu biblioteca y extensiones aunque esté cerrado?"
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={() => setConfirmBackground(false)}
            style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => {
              setConfirmBackground(false);
              applyBackgroundSetting(true);
            }}
            style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Permitir
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!backupCandidate}
        onClose={() => setBackupCandidate(null)}
        title="Restaurar respaldo"
        description={`El archivo ${backupCandidate?.fileName || ''} reemplazará tus datos actuales de Cytlex, incluidas la biblioteca, el progreso y los ajustes. Las extensiones instaladas se conservarán. La aplicación se recargará.`}
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={() => setBackupCandidate(null)}
            style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmBackupImport}
            style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Restaurar
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmAdultExtensions}
        onClose={() => setConfirmAdultExtensions(false)}
        title="Confirmación de edad"
        description="¿Confirmas que tienes 18 años o más para mostrar extensiones con contenido para adultos?"
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button variant="outline" onClick={() => setConfirmAdultExtensions(false)} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              set({ showAdultExtensions: true });
              setConfirmAdultExtensions(false);
            }}
            style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Tengo 18 años o más
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!pendingCat}
        onClose={() => setPendingCat(null)}
        title="Eliminar categoría"
        description={
          pendingCat
            ? `"${pendingCat.name}" contiene ${pendingCat.inside.length} ${pendingCat.inside.length === 1 ? 'manga' : 'mangas'}. Se eliminarán de la biblioteca y se desvincularán del seguimiento.`
            : ''
        }
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button variant="outline" onClick={() => setPendingCat(null)} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirmRemoveCat} style={{ height: px(36, scale, 30), fontSize: px(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}>
            Eliminar
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
