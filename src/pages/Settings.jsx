import { useEffect, useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { Plus, Palette, Library as LibraryIcon, BookOpen, Puzzle, Tags, Trash2, Link2, RefreshCw, LogOut, Loader2, Bell, Heart, X, Database, Download, Upload, CircleHelp, Settings as SettingsIcon } from 'lucide-react';
import { CONTENT_WARNING_RATINGS, resolveMode, settings } from '../lib/settings.js';
import { lib } from '../lib/library.js';
import { anilist } from '../lib/anilist.js';
import { consumeBrowserAuthError, consumeBrowserSettingsSection, session } from '../lib/session.js';
import { tracking } from '../lib/tracking.js';
import { MODES, THEMES } from '../lib/themes.js';
import { notifyHours } from '../lib/notify.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { compressBackup, createBackup, parseBackup, readBackupFile, restoreBackup } from '../lib/backup.js';
import { importMihonBackup, previewMihonBackup } from '../lib/mihonBackup.js';
import { extensions, isExtensionAllowed } from '../lib/extensions.js';
import { Button } from '../components/ui/button.jsx';
import { Dropdown } from '../components/ui/dropdown.jsx';
import { Dialog } from '../components/ui/dialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { Input } from '../components/ui/input.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px, fontPx } from '../lib/useScale.js';
import { clearPersistentLibraryCoverCache, invalidateLibraryCovers } from '../lib/covers.js';
import { clearSourceCache } from '../lib/sourceCache.js';
import SubrouteTabLabel from '../components/SubrouteTabLabel.jsx';

function clearLibraryUnreadCache() {
  localStorage.removeItem('cytlex:libraryUnread:v1');
  localStorage.removeItem('cytlex:libraryUnread:v2');
  window.dispatchEvent(new Event('cytlex:library-unread-reset'));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Importación cancelada.');
  error.name = 'AbortError';
  throw error;
}

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

function Row({ title, desc, right, first, last, className, stackOnMobile = false, scale = 1 }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between',
        stackOnMobile && 'max-md:flex-wrap',
        className
      )}
      style={{
        gap: px(14, scale, 10),
        paddingTop: first ? '0' : px(14, scale, 10),
        paddingBottom: last ? px(10, scale, 7) : px(14, scale, 10)
      }}
    >
      <div className={cn('min-w-0 flex-1', stackOnMobile && 'max-md:min-w-[10rem]')}>
        <div className="font-medium leading-tight" style={{ fontSize: fontPx(14, scale, 12) }}>
          {title}
        </div>
        {desc && (
          <div
            className="text-muted-foreground leading-snug"
            style={{ fontSize: fontPx(12, scale, 10), marginTop: px(4, scale, 3) }}
          >
            {desc}
          </div>
        )}
      </div>
      {right && (
        <div className={cn('shrink-0 flex items-center', stackOnMobile && 'max-md:ml-auto max-md:justify-end')}>
          {right}
        </div>
      )}
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
          style={{ fontSize: fontPx(12, scale, 10) }}
        >
          ¡Conecta tu cuenta primero!
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Segmented({ value, options, onChange, scale = 1, stableLayout = false }) {
  return (
    <div className="flex" style={{ gap: px(8, scale, 5) }}>
      {options.map(([val, label]) => (
        <Button
          key={val}
          size="sm"
          variant={value === val ? 'default' : 'outline'}
          className={stableLayout ? cn(
            'border transition-colors active:scale-100',
            value === val ? 'border-transparent' : 'border-border'
          ) : undefined}
          onClick={() => onChange(val)}
          style={{
            height: px(36, scale, 30),
            fontSize: fontPx(14, scale, 12),
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

const SECTIONS = [
  { id: 'apariencia', label: 'Apariencia', icon: Palette },
  { id: 'biblioteca', label: 'Biblioteca', icon: LibraryIcon },
  { id: 'lector', label: 'Lector', icon: BookOpen },
  { id: 'categorias', label: 'Categorías', icon: Tags },
  { id: 'extensiones', label: 'Extensiones', icon: Puzzle },
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell },
  { id: 'seguimiento', label: 'Seguimiento', icon: Link2 },
  { id: 'respaldo', label: 'Respaldo', icon: Database }
];

const READER_MODES = [
  { value: 'vertical', label: 'Vertical' },
  { value: 'paginado', label: 'Paginado (ID)' },
  { value: 'paginado-rtl', label: 'Paginado (DI)' }
];

const DEFAULT_EXTENSION_REPOSITORY = 'https://fobicho.github.io/Cytlex/index.json';

const extensionForSource = (repository, sourceId) => repository.find((manifest) => (
  manifest.id === sourceId || manifest.config?.sources?.some((source) => source.id === sourceId)
));
const canInstallExtension = (manifest) => !!manifest?.id && (
  (manifest.type === 'module' && !!manifest.main)
  || (manifest.type === 'selector' && !!manifest.baseUrl && !!manifest.selectors)
);

let sessionSeccion = '';

export default function Settings({ tutorialPreview = false }) {
  const location = useLocation();
  const [s, setS] = useState(settings.get());
  const [section, setSection] = useState(() => {
    const restoredSection = consumeBrowserSettingsSection() || sessionSeccion;
    return SECTIONS.some(({ id }) => id === restoredSection) ? restoredSection : 'apariencia';
  });
  const [libraryUnreadTipOpen, setLibraryUnreadTipOpen] = useState(false);
  const libraryUnreadTipRef = useRef(null);
  const [chaptersPerRowTipOpen, setChaptersPerRowTipOpen] = useState(false);
  const chaptersPerRowTipRef = useRef(null);
  const [cats, setCats] = useState(() => lib.cats());
  const [newCat, setNewCat] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [linkedCount, setLinkedCount] = useState(() => tracking.linkedCount());
  const [authState, setAuthState] = useState({ connected: false });
  const [authViewer, setAuthViewer] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState(() => consumeBrowserAuthError());
  const [connectHintFor, setConnectHintFor] = useState(null);
  const connectHintRef = useRef(null);
  const { toast, dismiss } = useToast();
  const [bgErr, setBgErr] = useState('');
  const [bgBusy, setBgBusy] = useState(false);
  const [confirmBackground, setConfirmBackground] = useState(false);
  const [confirmAdultExtensions, setConfirmAdultExtensions] = useState(false);
  const [adultRatingsDialog, setAdultRatingsDialog] = useState(false);
  const [adultRatingsDraft, setAdultRatingsDraft] = useState(() => [...settings.get().adultContentRatings]);
  const [confirmRemoveRepo, setConfirmRemoveRepo] = useState(false);
  const [backupCandidate, setBackupCandidate] = useState(null);
  const [backupInstallOpen, setBackupInstallOpen] = useState(false);
  const [backupReviewOpen, setBackupReviewOpen] = useState(false);
  const [backupMissingSources, setBackupMissingSources] = useState([]);
  const [backupUnavailableSources, setBackupUnavailableSources] = useState([]);
  const [backupInstallManifests, setBackupInstallManifests] = useState([]);
  const [mihonCandidate, setMihonCandidate] = useState(null);
  const [mihonInstallManifests, setMihonInstallManifests] = useState([]);
  const [mihonUnknownEntries, setMihonUnknownEntries] = useState([]);
  const [mihonKeepUnavailable, setMihonKeepUnavailable] = useState(false);
  const [mihonReviewOpen, setMihonReviewOpen] = useState(false);
  const [mihonInstallOpen, setMihonInstallOpen] = useState(false);
  const [mihonBusy, setMihonBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [confirmWebDataReset, setConfirmWebDataReset] = useState(false);
  const [webDataResetBusy, setWebDataResetBusy] = useState(false);
  const backupFileInputRef = useRef(null);
  const backupExportToastRef = useRef(null);
  const mihonFileInputRef = useRef(null);
  const mihonImportControllerRef = useRef(null);
  const removeRepoRef = useRef(null);
  const sectionNavRef = useRef(null);
  const sectionScrollTimerRef = useRef(null);
  const [showDonate, setShowDonate] = useState(
    () => !document.body.classList.contains('tutorial-open') && !settings.get().donationSeen
  );
  const scale = useScale();
  const reduceMotion = useReducedMotion();
  const isBrowserApp = typeof window !== 'undefined' && !window.cytlex;

  const handleSectionScroll = (event) => {
    const scrollArea = event.currentTarget;
    scrollArea.classList.add('is-scrolling');
    clearTimeout(sectionScrollTimerRef.current);
    sectionScrollTimerRef.current = setTimeout(() => scrollArea.classList.remove('is-scrolling'), 700);
  };

  useEffect(() => {
    if (!libraryUnreadTipOpen && !chaptersPerRowTipOpen) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!libraryUnreadTipRef.current?.contains(event.target)) setLibraryUnreadTipOpen(false);
      if (!chaptersPerRowTipRef.current?.contains(event.target)) setChaptersPerRowTipOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setLibraryUnreadTipOpen(false);
        setChaptersPerRowTipOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [libraryUnreadTipOpen, chaptersPerRowTipOpen]);

  useEffect(() => {
    const nav = sectionNavRef.current;
    const activeTab = nav?.querySelector('[aria-current="page"]');
    if (!nav || !activeTab) return;

    const navBounds = nav.getBoundingClientRect();
    const tabBounds = activeTab.getBoundingClientRect();
    const safeInset = px(16, scale, 12);
    const leftEdge = navBounds.left + safeInset;
    const rightEdge = navBounds.right - safeInset;
    const scrollOptions = { behavior: reduceMotion ? 'auto' : 'smooth' };

    if (tabBounds.left < leftEdge) {
      nav.scrollBy({ ...scrollOptions, left: tabBounds.left - leftEdge });
    } else if (tabBounds.right > rightEdge) {
      nav.scrollBy({ ...scrollOptions, left: tabBounds.right - rightEdge });
    }
  }, [section, reduceMotion, scale]);

  const resetWebData = async () => {
    setWebDataResetBusy(true);
    try {
      await Promise.all([clearPersistentLibraryCoverCache(), clearSourceCache()]);
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('cytlex:')) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
      ['fobi:favs', 'fobi:cats:v1', 'fobi:settings:v1', 'fobi:extensions:v1', 'fobi:theme']
        .forEach((key) => localStorage.removeItem(key));
      window.location.reload();
    } catch (error) {
      setWebDataResetBusy(false);
      toast({
        title: 'No se pudieron restablecer todos los datos',
        description: error?.message || 'Inténtalo de nuevo.',
        variant: 'error'
      });
    }
  };

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
    let redirecting = false;
    try {
      const r = await session.login(section);
      redirecting = !!r?.redirecting;
      if (!r?.cancelled) {
        if (redirecting) return;
        setAuthState({ connected: true });
        setAuthViewer(await session.viewer());
        setConnectHintFor(null);
      }
    } catch (e) {
      setAuthErr(String(e?.message || e));
    } finally {
      if (!redirecting) setAuthBusy(false);
    }
  };

  const set = (patch) => setS(settings.set(patch));
  const adjustCoverSize = (amount) => {
    const next = Math.min(240, Math.max(100, s.coverSize + amount));
    if (next !== s.coverSize) set({ coverSize: next });
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
    if (backupExportToastRef.current) dismiss(backupExportToastRef.current);
    backupExportToastRef.current = null;
    setBackupBusy(true);
    try {
      const fileName = backupFileName();
      if (window.cytlex?.saveBackup) {
        const content = JSON.stringify(createBackup());
        const result = await window.cytlex.saveBackup({ content, fileName });
        if (result?.canceled) return;
        if (!result?.ok) throw new Error(result?.error || 'No se pudo guardar el respaldo.');
      } else {
        const content = JSON.stringify(createBackup());
        const isMobile = window.matchMedia('(pointer: coarse)').matches || navigator.userAgentData?.mobile;
        let saved = false;

        if (typeof window.showSaveFilePicker === 'function') {
          const handle = await window.showSaveFilePicker({ suggestedName: fileName });
          const compressed = await compressBackup(content);
          const writable = await handle.createWritable();
          await writable.write(new Blob([compressed], { type: 'application/gzip' }));
          await writable.close();
          saved = true;
        } else if (isMobile && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
          const file = new File([content], fileName.replace(/\.json\.gz$/, '.json'), { type: 'application/json' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Respaldo de Cytlex' });
            saved = true;
          }
        }

        if (!saved) {
          const compressed = await compressBackup(content);
          const blob = new Blob([compressed], { type: 'application/gzip' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast({ title: 'Descarga iniciada', description: 'El navegador inició la descarga del respaldo.', variant: 'info' });
          return;
        }
      }
      backupExportToastRef.current = toast({ title: 'Respaldo exportado', description: 'El archivo se guardó correctamente.', variant: 'success' });
    } catch (error) {
      if (error?.name === 'AbortError') return;
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

  const finishBackupImport = async ({ omitUnavailable = false } = {}) => {
    if (!backupCandidate) return;
    try {
      let data = backupCandidate.data;
      let omittedCount = 0;
      if (omitUnavailable) {
        const excludedIds = new Set(backupUnavailableSources.map((source) => source.id));
        let favorites = [];
        try {
          const value = JSON.parse(data['cytlex:favs'] || '[]');
          if (Array.isArray(value)) favorites = value;
        } catch {}
        const retained = favorites.filter((manga) => !excludedIds.has(manga?.sourceId || 'leercapitulo'));
        omittedCount = favorites.length - retained.length;
        data = {
          ...data,
          'cytlex:favs': JSON.stringify(retained)
        };
      }
      let favorites = [];
      try {
        const value = JSON.parse(data['cytlex:favs'] || '[]');
        if (Array.isArray(value)) favorites = value;
      } catch {}
      const importedCoverUrls = favorites.map((manga) => manga?.cover).filter((cover) => /^https?:\/\//i.test(cover || ''));
      if (importedCoverUrls.length) {
        data = {
          ...data,
          'cytlex:favs': JSON.stringify(favorites.map((manga) => (
            /^https?:\/\//i.test(manga?.cover || '') ? { ...manga, coverLocal: '', coverCached: '' } : manga
          )))
        };
        await invalidateLibraryCovers(importedCoverUrls);
      }
      restoreBackup(data);
      clearLibraryUnreadCache();
      setBackupCandidate(null);
      setBackupInstallOpen(false);
      setBackupReviewOpen(false);
      setBackupMissingSources([]);
      setBackupUnavailableSources([]);
      setBackupInstallManifests([]);
      toast({
        title: 'Respaldo restaurado',
        description: `Cytlex se recargará para aplicar los datos${omittedCount ? `; ${omittedCount} mangas omitidos` : ''}.`,
        variant: 'success'
      });
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      toast({ title: 'No se pudo restaurar el respaldo', description: error.message, variant: 'error' });
    }
  };

  const confirmBackupImport = async () => {
    if (!backupCandidate) return;
    setBackupBusy(true);
    try {
      let favorites = [];
      try {
        const value = JSON.parse(backupCandidate.data['cytlex:favs'] || '[]');
        if (Array.isArray(value)) favorites = value;
      } catch {}
      const sources = new Map();
      favorites.forEach((manga) => {
        const id = manga?.sourceId || 'leercapitulo';
        const resolvedId = extensions.resolveInstalledSource(id, manga?.sourceName, manga?.url) || id;
        const manifest = extensions.manifest(resolvedId);
        const unavailable = !extensions.isInstalled(resolvedId)
          || !isExtensionAllowed(manifest, settings.get().showAdultExtensions);
        if (!unavailable) return;
        const source = sources.get(id) || { id, resolvedId, name: manga?.sourceName || manifest?.name || id, count: 0 };
        source.count += 1;
        sources.set(id, source);
      });
      if (!sources.size) {
        finishBackupImport();
        return;
      }

      const indexUrl = settings.get().extIndexUrl?.trim() || DEFAULT_EXTENSION_REPOSITORY;
      let repository = [];
      if ([...sources.values()].some((source) => !extensions.isInstalled(source.resolvedId))) {
        try { repository = await extensions.repoIndex(indexUrl); } catch {}
      }
      const manifests = new Map();
      const missing = [...sources.values()].filter((source) => !extensions.isInstalled(source.resolvedId)).map((source) => {
        const manifest = extensionForSource(repository, source.id) || extensionForSource(repository, source.resolvedId);
        const fallback = manifest || extensions.manifest(source.resolvedId) || extensions.manifest(source.id);
        const installable = canInstallExtension(fallback);
        if (installable) manifests.set(fallback.id, fallback);
        return { ...source, manifest: installable ? fallback : null };
      });
      setBackupMissingSources(missing);
      setBackupUnavailableSources([...sources.values()]);
      setBackupInstallManifests([...manifests.values()]);
      setBackupReviewOpen(true);
    } catch (error) {
      toast({ title: 'No se pudieron comprobar las extensiones', description: error.message, variant: 'error' });
    } finally {
      setBackupBusy(false);
    }
  };

  const cancelBackupInstall = () => {
    setBackupInstallOpen(false);
    setBackupReviewOpen(false);
    setBackupCandidate(null);
    setBackupMissingSources([]);
    setBackupUnavailableSources([]);
    setBackupInstallManifests([]);
  };

  const keepBackupUnavailable = () => {
    setBackupReviewOpen(false);
    if (backupInstallManifests.length) setBackupInstallOpen(true);
    else finishBackupImport();
  };

  const installBackupExtensions = async () => {
    if (!backupCandidate) return;
    setBackupBusy(true);
    try {
      const indexUrl = settings.get().extIndexUrl?.trim() || DEFAULT_EXTENSION_REPOSITORY;
      for (const manifest of backupInstallManifests) {
        if (!extensions.isInstalled(manifest.id)) await extensions.install(manifest, indexUrl);
      }
      finishBackupImport();
    } catch (error) {
      toast({ title: 'No se pudieron instalar las extensiones', description: `${error.message} No se restauró el respaldo.`, variant: 'error' });
    } finally {
      setBackupBusy(false);
    }
  };

  const loadMihonBackup = async (bytes, fileName) => {
    try {
      const indexUrl = settings.get().extIndexUrl?.trim() || DEFAULT_EXTENSION_REPOSITORY;
      const [repository, repositoryError] = await extensions.repoIndex(indexUrl)
        .then((index) => [index.filter(canInstallExtension), null], (error) => [[], error]);
      const candidate = await previewMihonBackup(bytes, extensions.sources(), repository);
      if (repositoryError && candidate.unmatchedCount) {
        toast({
          title: 'No se pudieron comprobar las extensiones',
          description: 'Vuelve a intentar la importación cuando el repositorio esté disponible.',
          variant: 'error'
        });
        return;
      }
      setMihonUnknownEntries([]);
      setMihonCandidate({ ...candidate, fileName, repository, indexUrl });
    } catch (error) {
      toast({ title: 'Respaldo de Mihon no válido', description: error.message, variant: 'error' });
    }
  };

  const importMihon = async () => {
    if (!window.cytlex?.openMihonBackup) {
      mihonFileInputRef.current?.click();
      return;
    }
    setBackupBusy(true);
    try {
      const result = await window.cytlex.openMihonBackup();
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.error || 'No se pudo abrir el archivo.');
      await loadMihonBackup(result.bytes, result.fileName);
    } catch (error) {
      toast({ title: 'No se pudo leer el respaldo de Mihon', description: error.message, variant: 'error' });
    } finally {
      setBackupBusy(false);
    }
  };

  const finishMihonImport = (keepUnavailable = false, failedInstalls = []) => {
    if (!mihonCandidate) return;
    try {
      const omitted = new Set(keepUnavailable ? [] : mihonUnknownEntries);
      const candidate = {
        ...mihonCandidate,
        entries: mihonCandidate.entries.filter((entry) => !omitted.has(entry))
          .map((entry) => ({ ...entry, manga: { ...entry.manga } }))
      };
      const result = importMihonBackup(candidate);
      clearLibraryUnreadCache();
      setMihonCandidate(null);
      setMihonInstallManifests([]);
      setMihonUnknownEntries([]);
      setMihonKeepUnavailable(false);
      setMihonReviewOpen(false);
      setMihonInstallOpen(false);
      setCats(lib.cats());
      toast({
        title: 'Respaldo de Mihon importado',
        description: `${result.added + result.updated} mangas importados${omitted.size ? `, ${omitted.size} omitidos` : ''}.${failedInstalls.length ? ` No se pudieron instalar: ${failedInstalls.join(', ')}.` : ''}`,
        variant: 'success'
      });
    } catch (error) {
      toast({ title: 'No se pudo importar el respaldo de Mihon', description: error.message, variant: 'error' });
    }
  };

  const confirmMihonImport = async () => {
    if (!mihonCandidate) return;
    setMihonKeepUnavailable(false);
    setMihonBusy(true);
    try {
      const missingEntries = mihonCandidate.entries.filter(({ manga }) => !extensions.isInstalled(manga.sourceId));
      if (missingEntries.length) {
        const manifests = new Map();
        const unknownEntries = [];
        for (const entry of missingEntries) {
          const manifest = extensionForSource(mihonCandidate.repository, entry.manga.sourceId);
          if (manifest) {
            if (isExtensionAllowed(manifest, !!settings.get().showAdultExtensions)) manifests.set(manifest.id, manifest);
          } else {
            unknownEntries.push(entry);
          }
        }
        setMihonInstallManifests([...manifests.values()]);
        setMihonUnknownEntries(unknownEntries);
        if (unknownEntries.length) {
          setMihonReviewOpen(true);
        } else if (manifests.size) {
          setMihonInstallOpen(true);
        } else {
          finishMihonImport();
        }
        return;
      }
      finishMihonImport();
    } catch (error) {
      toast({ title: 'No se pudieron comprobar las extensiones', description: error.message, variant: 'error' });
    } finally {
      setMihonBusy(false);
    }
  };

  const continueMihonImport = (keepUnavailable) => {
    setMihonReviewOpen(false);
    setMihonKeepUnavailable(keepUnavailable);
    if (mihonInstallManifests.length) {
      setMihonInstallOpen(true);
      return;
    }
    finishMihonImport(keepUnavailable);
  };

  const skipMihonMissingSources = () => {
    finishMihonImport(mihonKeepUnavailable);
  };

  const installMihonSources = async () => {
    if (!mihonInstallManifests.length) return;
    const controller = new AbortController();
    mihonImportControllerRef.current = controller;
    const progressToastId = toast({
      title: 'Importando respaldo de Mihon',
      description: 'Instalando extensiones y aplicando los ajustes necesarios…',
      icon: Loader2,
      loading: true,
      duration: null,
      onDismiss: () => controller.abort()
    });
    setMihonBusy(true);
    try {
      const indexUrl = mihonCandidate.indexUrl;
      const failedInstalls = [];
      for (const manifest of mihonInstallManifests) {
        throwIfAborted(controller.signal);
        if (extensions.isInstalled(manifest.id)) continue;
        try {
          await extensions.install(manifest, indexUrl);
        } catch {
          failedInstalls.push(manifest.name || manifest.id);
        }
      }
      throwIfAborted(controller.signal);
      setMihonInstallOpen(false);
      finishMihonImport(mihonKeepUnavailable, failedInstalls);
    } catch (error) {
      if (!controller.signal.aborted && error?.name !== 'AbortError') {
        toast({ title: 'No se pudieron instalar las extensiones', description: `${error.message} No se importaron los mangas.`, variant: 'error' });
      }
    } finally {
      dismiss(progressToastId);
      setMihonBusy(false);
      if (mihonImportControllerRef.current === controller) mihonImportControllerRef.current = null;
    }
  };

  let content;
  if (section === 'apariencia') {
    content = (
      <div>
        <Row
          scale={scale}
          first
          stackOnMobile
          title="Modo"
          desc="Cambia los colores que se ven en la aplicación"
          right={
            <Segmented
              scale={scale}
              stableLayout
              value={s.mode}
              onChange={(m) => setAppearance({ mode: m })}
              options={MODES.map(({ id, name }) => [id, name])}
            />
          }
        />
        <Row
          scale={scale}
          title="Tamaño de portadas"
          desc="Ajusta las portadas en Biblioteca, Explorar, Fuentes y fichas de manga"
          right={
            <div className="flex items-center" style={{ gap: px(6, scale, 4) }}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Reducir tamaño de portadas"
                className="hover:bg-transparent hover:text-foreground"
                disabled={s.coverSize <= 100}
                onClick={() => adjustCoverSize(-10)}
                style={{ width: px(28, scale, 24), height: px(28, scale, 24), fontSize: fontPx(18, scale, 15), lineHeight: 1, alignSelf: 'center' }}
              >
                −
              </Button>
              <div className="relative shrink-0">
                <output
                  aria-label={`Tamaño de portadas: ${s.coverSize} px`}
                  className="flex items-center justify-center gap-1 rounded-lg border border-border bg-background tabular-nums"
                  style={{ width: px(56, scale, 52), height: px(32, scale, 28), fontSize: fontPx(14, scale, 12) }}
                >
                  {s.coverSize}
                  <span className="text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }}>px</span>
                </output>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Aumentar tamaño de portadas"
                className="hover:bg-transparent hover:text-foreground"
                disabled={s.coverSize >= 240}
                onClick={() => adjustCoverSize(10)}
                style={{ width: px(28, scale, 24), height: px(28, scale, 24), fontSize: fontPx(18, scale, 15), lineHeight: 1, alignSelf: 'center' }}
              >
                +
              </Button>
            </div>
          }
        />
        <div style={{ paddingTop: px(14, scale, 10) }}>
          <h3 className="mb-3 font-medium leading-tight md:mb-2" style={{ fontSize: fontPx(14, scale, 12) }}>
            Tema
          </h3>
          <div className="grid grid-cols-2 min-[440px]:grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {THEMES.map((t) => {
              const on = s.theme === t.id;
              const sw = t.swatch[resolveMode(s.mode)] || t.swatch.dark;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAppearance({ theme: t.id })}
                  className={cn(
                    'rounded-xl border-2 p-4 text-left transition-colors md:p-3',
                    on ? 'border-primary bg-card shadow-[inset_0_0_0_1px_hsl(var(--primary))]' : 'border-border/40 bg-card hover:bg-accent/30'
                  )}
                >
                  <div className="mb-3 flex gap-2 md:mb-2 md:gap-1.5">
                    <span
                      className="h-7 w-7 rounded-full border border-border md:h-6 md:w-6"
                      style={{ background: sw[0] }}
                    />
                    <span
                      className="h-7 w-7 rounded-full border border-border md:h-6 md:w-6"
                      style={{ background: sw[1] }}
                    />
                  </div>
                  <div className="font-medium" style={{ fontSize: fontPx(14, scale, 12) }}>
                    {t.name}
                  </div>
                  <div className="text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }}>
                    {t.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
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
          title={
            <>
              Capítulos por fila{' '}
              <button
                ref={chaptersPerRowTipRef}
                type="button"
                className="group relative inline-flex align-middle rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Información sobre capítulos por fila"
                aria-describedby="chapters-per-row-tip"
                onClick={() => {
                  if (window.innerWidth < 768) setChaptersPerRowTipOpen((open) => !open);
                }}
              >
                <CircleHelp aria-hidden="true" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                <span
                  id="chapters-per-row-tip"
                  role="tooltip"
                  className={cn(
                    'pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-card-foreground opacity-0 shadow-lg transition-opacity duration-150 md:group-hover:opacity-100 md:group-focus-visible:opacity-100',
                    chaptersPerRowTipOpen && 'max-md:opacity-100'
                  )}
                >
                  Pro Tip: En celulares se fuerza a un solo capítulo por fila para evitar el desbordamiento de la información.
                </span>
              </button>
            </>
          }
          desc="Cantidad de capítulos por fila en la ficha de un manga"
          right={
            <>
              <span className="rounded-lg border border-border bg-muted px-3 py-2 text-sm md:hidden">1 por fila</span>
              <div className="hidden md:block">
                <Segmented
                  scale={scale}
                  value={s.chaptersPerRow}
                  onChange={(v) => set({ chaptersPerRow: v })}
                  options={[[1, '1'], [2, '2'], [3, '3']]}
                />
              </div>
            </>
          }
        />
        <Row
          scale={scale}
          title={
            <>
              Mostrar capítulos sin leer{' '}
              <button
                ref={libraryUnreadTipRef}
                type="button"
                className="group relative inline-flex align-middle rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Información sobre capítulos sin leer"
                aria-describedby="library-unread-tip"
                onClick={() => {
                  if (window.innerWidth < 768) setLibraryUnreadTipOpen((open) => !open);
                }}
              >
                <CircleHelp aria-hidden="true" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                <span
                  id="library-unread-tip"
                  role="tooltip"
                  className={cn(
                    'pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-card-foreground opacity-0 shadow-lg transition-opacity duration-150 md:group-hover:opacity-100 md:group-focus-visible:opacity-100',
                    libraryUnreadTipOpen && 'max-md:opacity-100'
                  )}
                >
                  Pro Tip: Desactivar esta opción podría mejorar el rendimiento en dispositivos de gama baja-media. Desactivala si ves que el desplazamiento en la biblioteca es muy lento.
                </span>
              </button>
            </>
          }
          desc="Muestra un contador de capítulos restantes de los mangas en la biblioteca"
          right={
            <Switch
              scale={scale}
              on={s.libraryShowUnread}
              onChange={(v) => set({ libraryShowUnread: v })}
              label="Mostrar capítulos sin leer"
            />
          }
        />
        <Row
          scale={scale}
          last
          title="Ocultar mangas ya guardados"
          desc="Oculta en Explorar los mangas que ya están en Biblioteca"
          right={
            <Switch
              scale={scale}
              on={s.hideSavedManga}
              onChange={(v) => set({ hideSavedManga: v })}
              label="Ocultar mangas ya guardados"
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
            <Dropdown
              scale={scale}
              style={{ width: px(150, scale, 128) }}
              value={s.readerMode}
              onChange={(readerMode) => set({ readerMode })}
              ariaLabel="Modo por defecto"
              portal
              options={READER_MODES}
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
      <div className="w-full max-w-4xl">
        {cats.length > 0 ? (
          <div className="overflow-hidden border border-border bg-card">
            {cats.map((c, i) => (
              <div
                key={c.id}
                className={cn('flex items-center', i < cats.length - 1 && 'border-b border-border/70')}
                style={{ gap: px(8, scale, 6), padding: `${px(6, scale, 5)} ${px(8, scale, 6)}` }}
              >
                <Input
                  value={c.name}
                  onChange={(e) => renameLocal(c.id, e.target.value)}
                  onBlur={() => commitRename(c.id)}
                  className="min-w-0 flex-1 border-none bg-transparent transition-colors focus:bg-background"
                  aria-label={`Nombre de la categoría ${c.name}`}
                  style={{
                    height: px(36, scale, 30),
                    fontSize: fontPx(14, scale, 12),
                    paddingLeft: px(10, scale, 7),
                    paddingRight: px(10, scale, 7)
                  }}
                />
                <span
                  className="category-count shrink-0 rounded-md bg-muted text-center tabular-nums text-muted-foreground"
                  style={{
                    minWidth: px(30, scale, 24),
                    padding: `${px(4, scale, 3)} ${px(7, scale, 5)}`,
                    fontSize: fontPx(12, scale, 10)
                  }}
                  title={`${counts.get(c.id) || 0} mangas en esta categoría`}
                >
                  {counts.get(c.id) || 0}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  title={`Eliminar categoría ${c.name}`}
                  aria-label={`Eliminar categoría ${c.name}`}
                  onClick={() => removeCat(c.id)}
                  className="shrink-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  style={{ width: px(34, scale, 29), height: px(34, scale, 29) }}
                >
                  <Trash2 style={{ width: px(15, scale, 13), height: px(15, scale, 13) }} />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p
            className="rounded-xl border border-dashed border-border px-4 py-5 text-muted-foreground"
            style={{ fontSize: fontPx(14, scale, 12) }}
          >
            No hay categorías. Crea la primera para organizar tu biblioteca.
          </p>
        )}

        <div
          className="flex items-center"
          style={{ gap: px(8, scale, 6), marginTop: px(12, scale, 10) }}
        >
          <Input
            placeholder="Nueva categoría…"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCat()}
            className="rounded-none"
            aria-label="Nueva categoría"
            style={{
              height: px(38, scale, 32),
              fontSize: fontPx(14, scale, 12),
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          />
          <Button
            onClick={addCat}
            disabled={!newCat.trim()}
            className="shrink-0 gap-1.5 rounded-none"
            style={{
              height: px(38, scale, 32),
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9),
              fontSize: fontPx(14, scale, 12)
            }}
          >
            <Plus style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
            Añadir
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
          title="Mostrar contenido +18"
          desc="Algunas extensiones y mangas podrían no mostrarse sin esta opción activa"
          right={
            <div className="flex items-center" style={{ gap: px(8, scale, 6) }}>
              {s.showAdultExtensions && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hover:bg-transparent"
                  title="Configurar calificaciones de contenido"
                  aria-label="Configurar calificaciones de contenido"
                  onClick={() => {
                    setAdultRatingsDraft([...s.adultContentRatings]);
                    setAdultRatingsDialog(true);
                  }}
                  style={{ width: px(34, scale, 28), height: px(34, scale, 28) }}
                >
                  <SettingsIcon style={{ width: px(17, scale, 14), height: px(17, scale, 14) }} />
                </Button>
              )}
              <Switch
                scale={scale}
                on={s.showAdultExtensions}
                onChange={(v) => {
                  if (v) setConfirmAdultExtensions(true);
                  else set({ showAdultExtensions: false });
                }}
                label="Mostrar extensiones +18"
              />
            </div>
          }
        />
        <div style={{ marginTop: px(18, scale, 12) }}>
          <div className="font-medium leading-tight mb-2" style={{ fontSize: fontPx(14, scale, 12) }}>
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
              fontSize: fontPx(13, scale, 11),
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
            className="flex items-center"
            style={{ gap: px(6, scale, 4), marginTop: px(10, scale, 7), paddingTop: px(10, scale, 7) }}
          >
            <span
              className="flex-1 min-w-0 truncate font-mono text-foreground"
              title={s.extIndexUrl}
              style={{ fontSize: fontPx(13, scale, 11) }}
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
                      style={{ height: px(28, scale, 24), fontSize: fontPx(12, scale, 10), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
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
          <p className="text-destructive mt-2" style={{ fontSize: fontPx(14, scale, 12) }}>
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
                  fontSize: fontPx(14, scale, 12),
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
                  fontSize: fontPx(14, scale, 12),
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
          <p className="text-destructive py-4" style={{ fontSize: fontPx(14, scale, 12) }}>
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
          stackOnMobile
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
                    fontSize: fontPx(14, scale, 12),
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
                    fontSize: fontPx(14, scale, 12),
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
        <input
          ref={mihonFileInputRef}
          type="file"
          accept=".tachibk,.gz,.proto,application/gzip,application/octet-stream"
          className="hidden"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            if (file.size > 100 * 1024 * 1024) {
              toast({ title: 'Respaldo demasiado grande', description: 'El límite de importación es 100 MB.', variant: 'error' });
              return;
            }
            setBackupBusy(true);
            try {
              await loadMihonBackup(new Uint8Array(await file.arrayBuffer()), file.name);
            } finally {
              setBackupBusy(false);
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
              style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
            >
              <Download className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
              Exportar
            </Button>
          }
        />
        <Row
          scale={scale}
          title="Importar respaldo"
          desc="Restaura tus datos desde un respaldo creado en Cytlex"
          right={
            <Button
              size="sm"
              variant="secondary"
              onClick={importBackup}
              disabled={backupBusy}
              style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
            >
              <Upload className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
              Importar
            </Button>
          }
        />
        <Row
          scale={scale}
          last={!isBrowserApp}
          title="Importar desde Mihon"
          desc="Fusiona mangas, categorías y progreso de lectura sin reemplazar tus datos de Cytlex"
          right={
            <Button
              size="sm"
              variant="secondary"
              onClick={importMihon}
              disabled={backupBusy}
              style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
            >
              <Upload className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
              Importar Mihon
            </Button>
          }
        />
        {isBrowserApp && (
          <Row
            scale={scale}
            last
            title="Restablecer datos de Cytlex"
            desc="Borra la biblioteca, el progreso, los ajustes, las extensiones y la caché guardados en este navegador"
            right={
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setConfirmWebDataReset(true)}
                disabled={webDataResetBusy}
                style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
              >
                <Trash2 className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                Restablecer
              </Button>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
    >
      <AnimatePresence initial={false}>
        {showDonate && (
          <motion.div
            initial={false}
            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ overflow: 'hidden', marginBottom: 0 }}
          >
            <div
              className="relative grid grid-cols-[auto_minmax(0,1fr)] items-start border-b border-border/70 bg-primary/5 md:flex md:items-center"
              style={{ gap: px(12, scale, 9), padding: px(16, scale, 12), paddingRight: px(48, scale, 38) }}
            >
              <div className="contents md:flex md:min-w-0 md:flex-1 md:items-center" style={{ gap: px(12, scale, 9) }}>
                <div
                  className="grid shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
                  aria-hidden="true"
                  style={{ width: px(36, scale, 30), height: px(36, scale, 30) }}
                >
                  <Heart style={{ width: px(18, scale, 15), height: px(18, scale, 15) }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-tight" style={{ fontSize: fontPx(14, scale, 12) }}>
                    ¿Te gusta <span className="font-display font-bold tracking-tight">Cytlex</span>?
                  </div>
                  <div className="text-muted-foreground leading-relaxed" style={{ fontSize: fontPx(13, scale, 11), marginTop: px(4, scale, 3) }}>
                    Si quieres, puedes apoyar su mantenimiento con una donación. Cada aporte ayuda a seguir mejorando la aplicación.
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  const url = 'https://ko-fi.com/fobicho';
                  if (window.cytlex?.openExternal) window.cytlex.openExternal(url);
                  else window.open(url, '_blank', 'noopener');
                }}
                className="col-start-2 min-h-11 shrink-0 self-start shadow-lg shadow-primary/20 md:col-auto md:min-h-0 md:self-center"
                style={{
                  height: px(34, scale, 28),
                  fontSize: fontPx(13, scale, 11),
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
      <nav
        ref={sectionNavRef}
        className={cn(
          'flex w-full min-w-0 shrink-0 items-center overflow-x-auto overscroll-x-contain whitespace-nowrap border-b border-border/70 bg-sidebar no-scrollbar',
          !isBrowserApp && !showDonate && '-mt-2 max-md:-mt-3'
        )}
        aria-label="Secciones de ajustes"
        style={{
          gap: px(24, scale, 16),
          marginBottom: isBrowserApp ? 0 : px(12, scale, 8),
          minHeight: px(38, scale, 34),
          paddingLeft: px(16, scale, 12),
          paddingRight: px(16, scale, 12)
        }}
      >
        {SECTIONS.map((sec) => {
          const on = sec.id === section;
          return (
            <button
              key={sec.id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => { setSection(sec.id); sessionSeccion = sec.id; }}
              className={cn(
                'group relative shrink-0 p-0 transition-colors'
              )}
              style={{ fontSize: fontPx(14, scale), scrollMarginInline: px(16, scale, 12) }}
            >
              <SubrouteTabLabel active={on}>{sec.label}</SubrouteTabLabel>
            </button>
          );
        })}
      </nav>
      <div
        key={section}
        className="settings-section-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain"
        onScroll={handleSectionScroll}
      >
        <div
          className="min-w-0"
          style={{ padding: px(16, scale, 12), paddingTop: px(12, scale, 10), paddingBottom: px(12, scale, 10) }}
        >
          {content}
        </div>
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
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => {
              setConfirmBackground(false);
              applyBackgroundSetting(true);
            }}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Permitir
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmWebDataReset}
        onClose={() => { if (!webDataResetBusy) setConfirmWebDataReset(false); }}
        title="Restablecer datos de Cytlex"
        description="Se borrarán permanentemente la biblioteca, las categorías, el progreso, los ajustes, las extensiones instaladas y las portadas guardadas en este navegador. La página se recargará y volverá a mostrar la introducción. Exporta un respaldo antes si quieres conservar tus datos."
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={() => setConfirmWebDataReset(false)}
            disabled={webDataResetBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={resetWebData}
            disabled={webDataResetBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {webDataResetBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />Restableciendo</> : 'Borrar datos'}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!backupCandidate && !backupInstallOpen && !backupReviewOpen}
        onClose={() => { if (!backupBusy) setBackupCandidate(null); }}
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
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmBackupImport}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {backupBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />Cargando</> : 'Restaurar'}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={backupReviewOpen}
        onClose={() => { if (!backupBusy) cancelBackupInstall(); }}
        title="Mangas con extensiones no disponibles"
        description="El respaldo contiene mangas de extensiones bloqueadas, no instaladas o no disponibles. Elige si quieres omitirlos o conservarlos."
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="space-y-2 text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          {backupUnavailableSources.map((source) => (
            <div key={source.id} className="flex items-center justify-between gap-4">
              <span className="truncate text-foreground" title={source.name}>{source.name}</span>
              <span className="shrink-0">{source.count} mangas</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={cancelBackupInstall}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={() => finishBackupImport({ omitUnavailable: true })}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Omitir y restaurar
          </Button>
          <Button
            onClick={keepBackupUnavailable}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Mantener y continuar
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={backupInstallOpen}
        onClose={() => { if (!backupBusy) cancelBackupInstall(); }}
        title="Extensiones disponibles para instalar"
        description="Estas extensiones están en el repositorio de Cytlex. Los mangas de otras fuentes se conservarán sin extensión instalada."
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="space-y-2 text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          {backupMissingSources.filter((source) => source.manifest).map((source) => (
            <div key={source.id} className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center" style={{ gap: px(8, scale, 6) }}>
                <span
                  className="relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-secondary-foreground font-semibold"
                  style={{ width: px(28, scale, 24), height: px(28, scale, 24), fontSize: fontPx(11, scale, 9) }}
                >
                  {(source.manifest?.name || source.name || source.id || '?')[0].toUpperCase()}
                  {source.manifest?.icon && (
                    <img src={source.manifest.icon} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(event) => event.currentTarget.remove()} />
                  )}
                </span>
                <span className="truncate text-foreground" title={source.manifest?.name || source.name || source.id}>
                  {source.manifest?.name || source.name || source.id}
                </span>
              </div>
              <span className="shrink-0">{source.count} mangas</span>
            </div>
          ))}
          {!backupInstallManifests.length && (
            <p>No se encontraron extensiones instalables en el repositorio configurado.</p>
          )}
        </div>
        <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={cancelBackupInstall}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={finishBackupImport}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Restaurar sin instalar
          </Button>
          <Button
            onClick={installBackupExtensions}
            disabled={backupBusy || !backupInstallManifests.length}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {backupBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />Cargando</> : 'Instalar y restaurar'}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!mihonCandidate && !mihonBusy && !mihonReviewOpen && !mihonInstallOpen}
        onClose={() => { if (!mihonBusy) setMihonCandidate(null); }}
        title="Importar respaldo de Mihon"
        description={`Se fusionará ${mihonCandidate?.fileName || 'este respaldo'} con Cytlex.`}
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          <div>{mihonCandidate?.mangaCount || 0} mangas · {mihonCandidate?.categoryNames?.length || 0} categorías</div>
          {mihonCandidate?.unmatchedCount > 0 && (
            <div style={{ marginTop: px(6, scale, 4) }}>
              {mihonCandidate.unmatchedCount} sin una fuente instalada.
            </div>
          )}
        </div>
        <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={() => setMihonCandidate(null)}
            disabled={mihonBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmMihonImport}
            disabled={mihonBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {mihonBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />Cargando</> : 'Fusionar'}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={mihonReviewOpen && !mihonBusy}
        onClose={() => {
          setMihonReviewOpen(false);
        }}
        title="¿Conservar los mangas sin extensión disponible?"
        description={`${mihonUnknownEntries.length} ${mihonUnknownEntries.length === 1 ? 'manga del respaldo usa una extensión que Cytlex no ofrece' : 'mangas del respaldo usan extensiones que Cytlex no ofrece'}. Si los conservas, podrás migrarlos a otra extensión al abrirlos desde la Biblioteca.`}
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="flex flex-wrap justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={() => setMihonReviewOpen(false)}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={() => continueMihonImport(false)}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Omitir estos mangas
          </Button>
          <Button
            onClick={() => continueMihonImport(true)}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Conservar mangas
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={mihonInstallOpen && !mihonBusy}
        onClose={() => setMihonInstallOpen(false)}
        title="Instalar extensiones faltantes"
        description={`Puedes instalar ${mihonInstallManifests.length} extensiones para abrir mangas del respaldo. Si continúas sin instalarlas, los mangas se conservarán en tu Biblioteca.`}
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="dd-scroll max-h-[40vh] space-y-2 overflow-y-auto text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          {mihonInstallManifests.map((manifest) => (
            <div key={manifest.id} className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center" style={{ gap: px(8, scale, 6) }}>
                <span
                  className="relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-secondary-foreground font-semibold"
                  style={{ width: px(28, scale, 24), height: px(28, scale, 24), fontSize: fontPx(11, scale, 9) }}
                >
                  {(manifest.name || manifest.id || '?')[0].toUpperCase()}
                  {manifest.icon && (
                    <img
                      src={manifest.icon}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      onError={(event) => event.currentTarget.remove()}
                    />
                  )}
                </span>
                <span className="truncate text-foreground" title={manifest.name || manifest.id}>{manifest.name || manifest.id}</span>
              </div>
              <span className="shrink-0">v{manifest.version || '—'}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={skipMihonMissingSources}
            disabled={mihonBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {mihonBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />Cargando</> : 'Continuar sin instalar'}
          </Button>
          <Button
            onClick={installMihonSources}
            disabled={mihonBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {mihonBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />Cargando</> : 'Instalar y continuar'}
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
          <Button variant="outline" onClick={() => setConfirmAdultExtensions(false)} style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              set({ showAdultExtensions: true });
              setConfirmAdultExtensions(false);
              setAdultRatingsDraft([...settings.get().adultContentRatings]);
              setAdultRatingsDialog(true);
            }}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Tengo 18 años o más
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={adultRatingsDialog}
        onClose={() => setAdultRatingsDialog(false)}
        title="Calificaciones de contenido"
        description="Elige qué categorías de extensiones y mangas quieres mostrar."
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="space-y-2">
          {CONTENT_WARNING_RATINGS.map((rating) => (
            <label key={rating} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-foreground">
              <input
                type="checkbox"
                className="accent-primary"
                checked={adultRatingsDraft.includes(rating)}
                onChange={(event) => setAdultRatingsDraft((current) => event.target.checked
                  ? [...current, rating]
                  : current.filter((value) => value !== rating))}
              />
              <span className="font-medium" style={{ fontSize: fontPx(14, scale, 12) }}>
                {rating}{' '}
                <span className="font-normal text-muted-foreground">
                  ({rating === 'SAFE'
                    ? 'sin contenido para adultos'
                    : rating === 'MIXED'
                      ? 'puede incluir contenido para adultos'
                      : 'contenido sexual explícito para adultos'})
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button
            variant="outline"
            onClick={() => setAdultRatingsDialog(false)}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => {
              set({ adultContentRatings: adultRatingsDraft });
              setAdultRatingsDialog(false);
            }}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            Guardar
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
          <Button variant="outline" onClick={() => setPendingCat(null)} style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirmRemoveCat} style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}>
            Eliminar
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
