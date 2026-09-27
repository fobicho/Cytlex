import { useEffect, useState } from 'react';
import { Minus, Plus, Palette, Library as LibraryIcon, BookOpen, Puzzle, Keyboard, Tags, Trash2 } from 'lucide-react';
import { settings } from '../lib/settings.js';
import { lib } from '../lib/library.js';
import { DEFAULT_INDEX_URL } from '../lib/extensions.js';
import { THEMES } from '../lib/themes.js';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { cn } from '../lib/utils.js';

function Row({ title, desc, right }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{right}</div>
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
  { id: 'atajos', label: 'Atajos', icon: Keyboard }
];

const SHORTCUTS = [
  { keys: ['F11'], desc: 'Pantalla completa' },
  { keys: ['H', 'Esc'], desc: 'Mostrar u ocultar controles del lector' },
  { keys: ['←', '→'], desc: 'Página anterior / siguiente' }
];

export default function Settings({ isFullscreen, onToggleFullscreen }) {
  const [s, setS] = useState(settings.get());
  const [section, setSection] = useState('apariencia');
  const [cats, setCats] = useState(() => lib.cats());
  const [newCat, setNewCat] = useState('');

  useEffect(() => settings.subscribe(setS), []);

  const set = (patch) => setS(settings.set(patch));

  const renameLocal = (id, name) =>
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  const commitRename = (id) =>
    setCats(lib.renameCat(id, cats.find((c) => c.id === id)?.name || ''));
  const removeCat = (id) => setCats(lib.removeCat(id));
  const addCat = () => {
    const v = newCat.trim();
    if (!v) return;
    setCats(lib.addCat(v));
    setNewCat('');
  };

  const active = SECTIONS.find((x) => x.id === section);

  let content;
  if (section === 'apariencia') {
    content = (
      <div className="space-y-8">
        <Row
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
        <div>
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
        <Row
          title="Pantalla completa"
          desc="Oculta los bordes de la ventana (F11)"
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
      <Row
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
    );
  } else if (section === 'lector') {
    content = (
      <div>
        <Row
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
        <Row
          title="Zoom inicial"
          desc={`Ancho de página: ${Math.round(s.readerZoom / 2)}%`}
          right={
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Reducir" onClick={() => set({ readerZoom: Math.max(20, s.readerZoom - 10) })}>
                <Minus className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground min-w-[42px] text-center">{s.readerZoom}%</span>
              <Button variant="ghost" size="icon" aria-label="Ampliar" onClick={() => set({ readerZoom: Math.min(200, s.readerZoom + 10) })}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          }
        />
      </div>
    );
  } else if (section === 'categorias') {
    content = (
      <div className="flex flex-col">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
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
        <div className="flex items-center gap-2 pt-3">
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
      <div className="space-y-4">
        <div>
          <div className="text-xs text-muted-foreground mb-1.5">Repositorio de extensiones</div>
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
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col">
        {SHORTCUTS.map((sc) => (
          <div key={sc.desc} className="flex items-center justify-between gap-4 py-3.5 border-b border-border last:border-0">
            <span className="text-sm">{sc.desc}</span>
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
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-8 items-stretch flex-1">
        <Card className="hover:shadow-sm">
          <nav className="p-2 flex flex-col gap-1" aria-label="Categorías de ajustes">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const on = sec.id === section;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setSection(sec.id)}
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
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-3">{active.label}</h2>
            {content}
          </div>
        </Card>
      </div>
    </div>
  );
}
