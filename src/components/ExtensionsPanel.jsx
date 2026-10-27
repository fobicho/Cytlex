import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Download, RefreshCw, AlertTriangle, Loader2, ArrowUpCircle, ArrowUpDown, Settings as SettingsIcon } from 'lucide-react';
import { extensions, isAdultExtension, isNewer } from '../lib/extensions.js';
import { extUpdates } from '../lib/extUpdates.js';
import { settings } from '../lib/settings.js';
import { Card } from './ui/card.jsx';
import { Button } from './ui/button.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { Dialog } from './ui/dialog.jsx';
import { useToast } from './Toast.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils.js';
import { useScale, px } from '../lib/useScale.js';

function ExtensionCard({ m, action, updatable = false, disabled = false, scale = 1, selected = false, confirmationOpen = false, onSelectionChange, selectionLabel, selectionDisabled = false }) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = m.icon && imgOk;
  const hasAdultContent = isAdultExtension(m);
  const iconSize = Number(px(40, scale, 32).replace('px', ''));
  const identity = (
    <>
      <div
        className="rounded-xl bg-secondary text-secondary-foreground grid place-items-center font-bold shrink-0 overflow-hidden"
        style={{
          width: `${iconSize}px`,
          height: `${iconSize}px`,
          fontSize: px(16, scale, 13),
          borderRadius: px(12, scale, 9)
        }}
      >
        {showImg ? (
          <img
            src={m.icon}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          (m.name?.[0] || '?').toUpperCase()
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center min-w-0" style={{ gap: px(6, scale, 4) }}>
          <div
            className="font-semibold truncate min-w-0"
            title={m.name}
            style={{ fontSize: px(15, scale, 13) }}
          >
            {m.name}
          </div>
        </div>
        <div
          className="flex items-center min-w-0 overflow-hidden"
          style={{
            marginTop: px(2, scale, 1.5),
            gap: px(6, scale, 4),
            height: px(20, scale, 16)
          }}
        >
          {m.version && (
            <span
              className="text-muted-foreground leading-none truncate min-w-0"
              style={{ fontSize: px(11, scale, 9) }}
            >
              v{m.version}
            </span>
          )}
          {hasAdultContent && (
            <span
              className="shrink-0 font-semibold text-red-600 dark:text-red-400"
              title="La extensión declara contenido MIXED o NSFW"
              aria-label="Extensión con contenido para adultos, +18"
              style={{ fontSize: px(11, scale, 9) }}
            >
              +18
            </span>
          )}
        </div>
      </div>
    </>
  );
  return (
    <Card
      className={cn(
        'hover:shadow-sm',
        confirmationOpen && 'relative z-30',
        selected && 'border-primary ring-2 ring-primary/30 shadow-md shadow-primary/10',
        updatable && 'cx-update-pulse',
        disabled && 'opacity-50'
      )}
    >
      <div
        className="flex items-center"
        style={{ padding: px(14, scale, 11), gap: px(12, scale, 9) }}
      >
        {onSelectionChange ? (
          <button
            type="button"
            onClick={() => onSelectionChange(!selected)}
            aria-label={selectionLabel}
            aria-pressed={selected}
            disabled={selectionDisabled}
            className="flex flex-1 min-w-0 items-center text-left disabled:cursor-default"
            style={{ gap: px(12, scale, 9) }}
          >
            {identity}
          </button>
        ) : (
          <div className="flex flex-1 min-w-0 items-center" style={{ gap: px(12, scale, 9) }}>
            {identity}
          </div>
        )}
        <div className="shrink-0">{action}</div>
      </div>
    </Card>
  );
}

let repoCache = { url: '', available: null, updates: null };
const EXT_CONFIG_KEY = 'cytlex:ext-config:v1';
const DEFAULT_EXTENSION_REPOSITORY = 'https://fobicho.github.io/Cytlex/index.json';

const readExtConfig = () => {
  try { return JSON.parse(localStorage.getItem(EXT_CONFIG_KEY)) || {}; } catch { return {}; }
};

const writeExtConfig = (cfg) => {
  try { localStorage.setItem(EXT_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
};
const extensionSortModes = ['title-asc', 'title-desc', 'added'];
let manualExtensionCheckInFlight = false;
let manualExtensionCheckCooldownUntil = 0;

const remainingExtensionCheckCooldown = () => Math.max(0, Math.ceil((manualExtensionCheckCooldownUntil - Date.now()) / 1000));

function sortLabel(sortBy) {
  return sortBy === 'title-desc' ? 'Z-A' : sortBy === 'added' ? 'Adición' : 'A-Z';
}

export default function ExtensionsPanel({ tutorialPreview = false }) {
  const { toast } = useToast();
  const scale = useScale();
  const configuredRepo = (settings.get().extIndexUrl || '').trim();
  const initialRepo = configuredRepo || (tutorialPreview ? DEFAULT_EXTENSION_REPOSITORY : '');
  const cacheHit = !!initialRepo && initialRepo === repoCache.url && repoCache.available !== null;
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const [installed, setInstalled] = useState(() => extensions.installed());
  const [available, setAvailable] = useState(() => (cacheHit ? repoCache.available : null));
  const [loading, setLoading] = useState(() => !cacheHit);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(manualExtensionCheckInFlight);
  const [checkCooldown, setCheckCooldown] = useState(remainingExtensionCheckCooldown);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmInstall, setConfirmInstall] = useState(null);
  const [confirmUpdate, setConfirmUpdate] = useState(null);
  const [updates, setUpdates] = useState(() => (cacheHit ? repoCache.updates || [] : []));
  const [updating, setUpdating] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [selectedInstalledIds, setSelectedInstalledIds] = useState(() => new Set());
  const [selectedAvailableIds, setSelectedAvailableIds] = useState(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(null);
  const [repoUrl, setRepoUrl] = useState(initialRepo);
  const [sortBy, setSortBy] = useState(() => {
    const stored = localStorage.getItem('cytlex:extensionsSort');
    return extensionSortModes.includes(stored) ? stored : 'title-asc';
  });
  const [langConfig, setLangConfig] = useState(() => readExtConfig());
  const [configExt, setConfigExt] = useState(null);
  const [toolbarTarget, setToolbarTarget] = useState(null);

  useLayoutEffect(() => {
    setToolbarTarget(document.getElementById('extensions-toolbar'));
  }, []);

  const toggleLang = (subId, code, options) => {
    const cfg = readExtConfig();
    const defaults = options.map((l) => l.code);
    const cur = Array.isArray(cfg[subId]?.languages) && cfg[subId].languages.length ? cfg[subId].languages : defaults;
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    if (!next.length) return;
    cfg[subId] = { ...(cfg[subId] || {}), languages: next };
    writeExtConfig(cfg);
    setLangConfig({ ...cfg });
    extensions.invalidate(subId);
  };
  const visibleInstalled = installed;
  const visibleAvailable = tutorialPreview || showAdultExtensions
    ? available
    : available?.filter((manifest) => !isAdultExtension(manifest));
  const installedById = new Map(installed.map((record) => [record.manifest.id, record.manifest]));
  const visibleUpdates = updates.filter((update) => {
    const manifest = installedById.get(update.id);
    return manifest && isNewer(update.to, manifest.version);
  });
  const sortedInstalled = [...visibleInstalled].sort((a, b) => {
    if (sortBy === 'added') return (a.installedAt || 0) - (b.installedAt || 0);
    const order = String(a.manifest.name || '').localeCompare(String(b.manifest.name || ''), 'es', { sensitivity: 'base', numeric: true });
    return sortBy === 'title-desc' ? -order : order;
  });
  const sortedAvailable = [...(visibleAvailable || [])];
  if (sortBy !== 'added') {
    sortedAvailable.sort((a, b) => {
      const order = String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base', numeric: true });
      return sortBy === 'title-desc' ? -order : order;
    });
  }
  const confirmRef = useRef(null);
  const removeRef = useRef(null);
  const updateRef = useRef(null);
  const allRef = useRef(null);
  const bulkInstallRef = useRef(null);
  const bulkUninstallRef = useRef(null);

  useEffect(() => {
    if (!confirmInstall) return;
    const onDown = (e) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target)) {
        setConfirmInstall(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmInstall]);

  useEffect(() => {
    if (!confirmRemove) return;
    const onDown = (e) => {
      if (removeRef.current && !removeRef.current.contains(e.target)) {
        setConfirmRemove(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmRemove]);

  useEffect(() => {
    if (!confirmUpdate || confirmUpdate === 'all') return;
    const onDown = (e) => {
      if (updateRef.current && !updateRef.current.contains(e.target)) {
        setConfirmUpdate(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmUpdate]);

  useEffect(() => {
    if (!confirmAll) return;
    const onDown = (e) => {
      if (allRef.current && !allRef.current.contains(e.target)) {
        setConfirmAll(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmAll]);

  useEffect(() => {
    if (!confirmBulk) return;
    const ref = confirmBulk === 'install' ? bulkInstallRef : bulkUninstallRef;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setConfirmBulk(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [confirmBulk]);

  const refresh = () => setInstalled(extensions.installed());

  const checkUpdates = async (url = repoUrl) => {
    if (!url) {
      setUpdates([]);
      return;
    }
    try {
      setUpdates(await extensions.checkUpdates(url));
    } catch {
      setUpdates([]);
    }
  };

  const searchUpdates = async () => {
    if (manualExtensionCheckInFlight || remainingExtensionCheckCooldown() > 0) return;
    if (!repoUrl) {
      toast({ title: 'No hay un repositorio configurado', description: 'Configura un repositorio para buscar actualizaciones.', variant: 'error' });
      return;
    }
    manualExtensionCheckInFlight = true;
    setCheckingUpdates(true);
    setErr('');
    try {
      const [found] = await Promise.all([
        extensions.checkUpdates(repoUrl),
        loadAvailable(repoUrl)
      ]);
      setUpdates(found);
      if (!found.length) {
        toast({ title: 'No hay actualizaciones pendientes', description: 'Tus extensiones están al día.', variant: 'info' });
      } else {
        toast({
          title: found.length === 1 ? `${found[0].name} tiene una actualización` : `${found.length} extensiones tienen actualizaciones`,
          description: found.length === 1
            ? `Ya puedes instalar la versión ${found[0].to}.`
            : 'Ya puedes instalarlas desde Extensiones.',
          variant: 'info'
        });
      }
    } catch (error) {
      toast({ title: 'No se pudieron buscar actualizaciones', description: String(error?.message || error), variant: 'error' });
    } finally {
      manualExtensionCheckInFlight = false;
      manualExtensionCheckCooldownUntil = Date.now() + 3_000;
      setCheckingUpdates(false);
      setCheckCooldown(3);
    }
  };

  useEffect(() => {
    if (!checkingUpdates && !checkCooldown) return undefined;
    const timer = window.setInterval(() => {
      setCheckingUpdates(manualExtensionCheckInFlight);
      setCheckCooldown(remainingExtensionCheckCooldown());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [checkingUpdates, checkCooldown]);

  const loadAvailable = async (url = repoUrl) => {
    if (!url) {
      setAvailable([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      setAvailable(await extensions.available(url));
    } catch (e) {
      setErr(String(e?.message || e));
      setAvailable(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    if (!repoUrl) {
      setAvailable([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      if (!tutorialPreview) {
        try { await extensions.sync(repoUrl); } catch {}
        refresh();
        await checkUpdates();
      }
      await loadAvailable();
    })();
  }, [repoUrl, tutorialPreview]);

  useEffect(() => {
    if (repoUrl && available !== null) {
      repoCache = { url: repoUrl, available, updates };
    }
  }, [repoUrl, available, updates]);

  useEffect(() => {
    const onGo = () => {
      if (!repoUrl) return;
      checkUpdates();
      loadAvailable();
    };
    window.addEventListener('cytlex:go-extensions', onGo);
    return () => window.removeEventListener('cytlex:go-extensions', onGo);
  }, [repoUrl]);

  useEffect(() => settings.subscribe((s) => {
    const nextRepo = (s.extIndexUrl || '').trim();
    setRepoUrl(nextRepo || (tutorialPreview ? DEFAULT_EXTENSION_REPOSITORY : ''));
    setShowAdultExtensions(!!s.showAdultExtensions);
  }), [tutorialPreview]);
  useEffect(() => {
    const installedIds = new Set(installed.map(({ manifest }) => manifest.id));
    setSelectedInstalledIds((current) => new Set([...current].filter((id) => installedIds.has(id))));
  }, [installed]);
  useEffect(() => {
    const availableIds = new Set((visibleAvailable || []).map((manifest) => manifest.id));
    setSelectedAvailableIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [available, showAdultExtensions]);

  const doUpdateOne = async (id) => {
    setUpdating(id);
    setErr('');
    try {
      const r = await extensions.updateAll(repoUrl, [id]);
      refresh();
      await checkUpdates();
      if (r.ok) {
        extUpdates.clear();
        toast({ title: 'Extensión actualizada', variant: 'success' });
      } else {
        setErr('No se pudo actualizar la extensión');
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setUpdating('');
  };

  const doUpdateAll = async () => {
    setUpdating('all');
    setErr('');
    try {
      const r = await extensions.updateAll(repoUrl, visibleUpdates.map((update) => update.id));
      refresh();
      await checkUpdates();
      if (r.fallos.length) {
        toast({
          title: 'Actualización parcial',
          description: `${r.ok} actualizadas, ${r.fallos.length} fallaron.`,
          variant: 'error'
        });
      } else if (r.ok === 0) {
        toast({ title: 'No hay actualizaciones pendientes', variant: 'info' });
      } else {
        extUpdates.clear();
        toast({
          title: r.ok === 1 ? '1 extensión actualizada' : `${r.ok} extensiones actualizadas`,
          variant: 'success'
        });
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setUpdating('');
  };

  const doInstall = async (m) => {
    setBusy(m.id);
    setErr('');
    try {
      await extensions.install(m, repoUrl);
      refresh();
      setAvailable((a) => (a ? a.filter((x) => x.id !== m.id) : a));
      setUpdates((current) => current.filter((update) => update.id !== m.id));
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setBusy('');
  };

  const doUninstall = async (id) => {
    setBusy(id);
    setErr('');
    try {
      await extensions.uninstall(id);
      refresh();
      await loadAvailable();
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setBusy('');
  };

  const toggleSelection = (setter, id, selected) => {
    setter((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runBulkAction = async (action) => {
    const isInstall = action === 'install';
    const selectedItems = isInstall
      ? sortedAvailable.filter((manifest) => selectedAvailableIds.has(manifest.id))
      : sortedInstalled.filter(({ manifest }) => selectedInstalledIds.has(manifest.id)).map(({ manifest }) => manifest);
    if (!selectedItems.length) {
      setConfirmBulk(null);
      return;
    }

    setBusy(isInstall ? 'bulk-install' : 'bulk-uninstall');
    setErr('');
    const succeeded = [];
    const failed = [];
    for (const item of selectedItems) {
      const id = item.id;
      try {
        if (isInstall) await extensions.install(item, repoUrl);
        else await extensions.uninstall(id);
        succeeded.push(id);
      } catch {
        failed.push(id);
      }
    }

    const succeededIds = new Set(succeeded);
    if (isInstall) {
      refresh();
      setAvailable((current) => current?.filter((manifest) => !succeededIds.has(manifest.id)) ?? current);
      setUpdates((current) => current.filter((update) => !succeededIds.has(update.id)));
      setSelectedAvailableIds(new Set(failed));
    } else {
      refresh();
      await loadAvailable();
      setSelectedInstalledIds(new Set(failed));
    }

    setBusy('');
    setConfirmBulk(null);
    if (failed.length) {
      setErr(`No se pudieron ${isInstall ? 'instalar' : 'desinstalar'} ${failed.length} ${failed.length === 1 ? 'extensión' : 'extensiones'}.`);
    } else if (succeeded.length) {
      toast({
        title: isInstall
          ? `${succeeded.length} ${succeeded.length === 1 ? 'extensión instalada' : 'extensiones instaladas'}`
          : `${succeeded.length} ${succeeded.length === 1 ? 'extensión desinstalada' : 'extensiones desinstaladas'}`,
        variant: 'success'
      });
    }
  };

  const handleBulkAction = (action) => {
    if (confirmBulk !== action) {
      setConfirmBulk(action);
      return;
    }
    setConfirmBulk(null);
    runBulkAction(action);
  };

  const grid = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${px(240, scale, 200).replace('px', '')}px, 1fr))`,
    gap: px(12, scale, 9)
  };

  return (
    <>
      {toolbarTarget && createPortal(
        <>
          <Button
            variant="secondary"
            size="sm"
            title="Ordenar extensiones"
            aria-label={`Ordenar extensiones: ${sortLabel(sortBy)}`}
            onClick={() => {
              const next = extensionSortModes[(extensionSortModes.indexOf(sortBy) + 1) % extensionSortModes.length];
              setSortBy(next);
              try { localStorage.setItem('cytlex:extensionsSort', next); } catch {}
            }}
            style={{
              height: px(36, scale, 30),
              fontSize: px(14, scale, 12),
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          >
            <ArrowUpDown className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
            {sortLabel(sortBy)}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={searchUpdates}
            title={checkCooldown ? `Puedes volver a buscar en ${checkCooldown} s` : 'Buscar actualizaciones'}
            aria-label="Buscar actualizaciones"
            style={{
              opacity: 1,
              height: px(36, scale, 30),
              fontSize: px(14, scale, 12),
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          >
            <RefreshCw
              className={cn('mr-2', checkingUpdates && 'animate-spin')}
              style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
            />
            Buscar actualizaciones
          </Button>
        </>,
        toolbarTarget
      )}
      <div className="flex flex-col" style={{ gap: px(32, scale, 22) }}>
      {err && (
        <Card className="border-destructive/40 hover:shadow-sm">
          <div
            className="flex items-center"
            style={{ padding: px(16, scale, 11), gap: px(8, scale, 6), fontSize: px(14, scale, 12) }}
          >
            <AlertTriangle
              className="text-destructive shrink-0"
              style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
            />
            <span className="text-muted-foreground">{err}</span>
          </div>
        </Card>
      )}

      <section>
        <div
          className="flex items-center justify-between"
          style={{ gap: px(16, scale, 11), marginBottom: px(12, scale, 9), height: px(36, scale, 30) }}
        >
          <div className="flex items-center" style={{ gap: px(12, scale, 8) }}>
            <h3 className="font-medium" style={{ fontSize: px(14, scale, 12) }}>
              Instaladas
            </h3>
          </div>
          <div className="flex items-center" style={{ gap: px(8, scale, 6) }}>
            <AnimatePresence initial={false}>
              {!tutorialPreview && selectedInstalledIds.size > 0 && (
                <motion.div
                  key="bulk-uninstall-button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex"
                  ref={bulkUninstallRef}
                >
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBulkAction('uninstall')}
                    disabled={busy !== '' || updating !== ''}
                    style={{
                      height: px(36, scale, 30),
                      fontSize: px(14, scale, 12),
                      paddingLeft: px(12, scale, 9),
                      paddingRight: px(12, scale, 9)
                    }}
                  >
                    <span className="grid">
                      <span className="invisible col-start-1 row-start-1 flex items-center" aria-hidden="true">
                        <Trash2 className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                        Desinstalar seleccionadas
                      </span>
                      <AnimatePresence mode="wait" initial={false}>
                        {confirmBulk === 'uninstall' ? (
                          <motion.span
                            key="confirm"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            className="col-start-1 row-start-1 justify-self-center"
                          >
                            ¿Seguro?
                          </motion.span>
                        ) : (
                          <motion.span
                            key="idle"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            className="col-start-1 row-start-1 flex items-center justify-self-center"
                          >
                            <Trash2 className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                            Desinstalar seleccionadas
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            {visibleUpdates.length > 0 && (
              <Button
                ref={allRef}
                variant="secondary"
                size="sm"
                onClick={async () => {
                  if (!confirmAll) {
                    setConfirmAll(true);
                    return;
                  }
                  setConfirmAll(false);
                  await doUpdateAll();
                }}
                disabled={updating !== ''}
                className="whitespace-nowrap"
                style={{
                  height: px(36, scale, 30),
                  minWidth: px(176, scale, 140),
                  fontSize: px(14, scale, 12),
                  paddingLeft: px(12, scale, 9),
                  paddingRight: px(12, scale, 9)
                }}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {updating === 'all' ? (
                    <motion.span
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex items-center"
                    >
                      <Loader2
                        className="mr-2 animate-spin"
                        style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
                      />
                      Actualizando...
                    </motion.span>
                  ) : confirmAll ? (
                    <motion.span
                      key="confirm"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                    >
                      ¿Seguro?
                    </motion.span>
                  ) : (
                    <motion.span
                      key="idle"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      className="flex items-center"
                    >
                      <ArrowUpCircle
                        className="mr-2"
                        style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
                      />
                      Actualizar todo
                      <span className="opacity-70 ml-2">{visibleUpdates.length}</span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>
            )}
          </div>
        </div>
        {installed.length === 0 ? (
          <EmptyState
            compact
            face="（・_・）"
            title="No hay extensiones instaladas"
          />
        ) : visibleInstalled.length > 0 ? (
          <div className="grid">
          <div className="invisible col-start-1 row-start-1 pointer-events-none" aria-hidden="true">
            <EmptyState compact face="（・_・）" title="No hay extensiones instaladas" animateFace={false} />
          </div>
          <div className="grid col-start-1 row-start-1" style={{ ...grid, alignContent: 'start' }}>
            {sortedInstalled.map(({ manifest: m }) => {
              const upd = visibleUpdates.find((u) => u.id === m.id);
              const blocked = !showAdultExtensions && isAdultExtension(m);
              return (
                <div key={m.id}>
                  <ExtensionCard
                    scale={scale}
                    m={m}
                    updatable={!!upd}
                    disabled={blocked}
                    confirmationOpen={confirmRemove?.id === m.id || (confirmUpdate && confirmUpdate !== 'all' && confirmUpdate.id === m.id)}
                    selected={selectedInstalledIds.has(m.id)}
                    onSelectionChange={tutorialPreview ? undefined : (selected) => toggleSelection(setSelectedInstalledIds, m.id, selected)}
                    selectionLabel={`Seleccionar ${m.name} para desinstalar`}
                    selectionDisabled={busy !== ''}
                    action={
                    <div className="flex items-center" style={{ gap: px(4, scale, 3) }}>
                      {!blocked && Array.isArray(m.config?.sources) && m.config.sources.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={`Configuración de ${m.name}`}
                          aria-label={`Configuración de ${m.name}`}
                          onClick={() => setConfigExt(m)}
                          style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                        >
                          <SettingsIcon style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                        </Button>
                      )}
                      {upd && !blocked && (
                        <div
                          ref={confirmUpdate?.id === m.id ? updateRef : null}
                          className="relative flex items-center justify-center"
                          style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hover:bg-transparent hover:text-foreground"
                            title={`Actualizar a la v${upd.to}`}
                            aria-label={`Actualizar ${m.name}`}
                            disabled={updating !== ''}
                            onClick={() => setConfirmUpdate(upd)}
                            style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                          >
                            {updating === m.id ? (
                              <Loader2 className="animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                            ) : (
                              <Download style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                            )}
                          </Button>
                          <AnimatePresence>
                            {confirmUpdate && confirmUpdate !== 'all' && confirmUpdate.id === m.id && (
                              <motion.div
                                key="confirm-update"
                                initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                                exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                                transition={{ duration: 0.14, ease: 'easeOut' }}
                                className="absolute z-20 rounded-lg border border-border bg-card shadow-lg"
                                style={{ top: '100%', left: '50%', marginTop: px(6, scale, 4), padding: px(8, scale, 6) }}
                              >
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    const target = confirmUpdate;
                                    setConfirmUpdate(null);
                                    await doUpdateOne(target.id);
                                  }}
                                  disabled={updating !== ''}
                                  style={{ height: px(28, scale, 24), fontSize: px(12, scale, 10), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                                >
                                  Actualizar
                                </Button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                      <div
                        ref={confirmRemove?.id === m.id ? removeRef : null}
                        className="relative flex items-center justify-center"
                        style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-transparent hover:text-destructive"
                          title="Desinstalar"
                          aria-label="Desinstalar"
                          disabled={busy !== ''}
                          onClick={() => setConfirmRemove(m)}
                          style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                        >
                          <Trash2 style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                        </Button>
                        <AnimatePresence>
                          {confirmRemove?.id === m.id && (
                            <motion.div
                              key="confirm-remove"
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
                                onClick={async () => {
                                  const id = confirmRemove.id;
                                  setConfirmRemove(null);
                                  await doUninstall(id);
                                }}
                                disabled={busy !== ''}
                                style={{ height: px(28, scale, 24), fontSize: px(12, scale, 10), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                              >
                                Desinstalar
                              </Button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    }
                  />
                </div>
              );
            })}
          </div>
          </div>
        ) : null}
      </section>

      <section>
        <div
          className="flex items-center justify-between"
          style={{ gap: px(16, scale, 11), marginBottom: px(12, scale, 9), height: px(36, scale, 30) }}
        >
          <h3 className="font-medium" style={{ fontSize: px(14, scale, 12) }}>
            Disponibles
          </h3>
          <div className="flex items-center" style={{ gap: px(8, scale, 6) }}>
            <AnimatePresence initial={false}>
              {!tutorialPreview && selectedAvailableIds.size > 0 && (
                <motion.div
                  key="bulk-install-button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex"
                  ref={bulkInstallRef}
                >
                  <Button
                    size="sm"
                    onClick={() => handleBulkAction('install')}
                    disabled={busy !== '' || loading || updating !== ''}
                    style={{
                      height: px(36, scale, 30),
                      fontSize: px(14, scale, 12),
                      paddingLeft: px(12, scale, 9),
                      paddingRight: px(12, scale, 9)
                    }}
                  >
                    <span className="grid">
                      <span className="invisible col-start-1 row-start-1 flex items-center" aria-hidden="true">
                        <Download className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                        Instalar seleccionadas
                      </span>
                      <AnimatePresence mode="wait" initial={false}>
                        {confirmBulk === 'install' ? (
                          <motion.span
                            key="confirm"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            className="col-start-1 row-start-1 justify-self-center"
                          >
                            ¿Seguro?
                          </motion.span>
                        ) : (
                          <motion.span
                            key="idle"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            className="col-start-1 row-start-1 flex items-center justify-self-center"
                          >
                            <Download className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                            Instalar seleccionadas
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {!repoUrl ? (
          <EmptyState
            compact
            face="（・_・）"
            tone="prompt"
            title="Sin repositorio configurado"
          />
        ) : available === null ? (
          loading ? (
            <div
              className="flex flex-col items-center text-muted-foreground"
              style={{ gap: px(12, scale, 9), padding: `${px(24, scale, 18)}px 0` }}
            >
              <Loader2 className="animate-spin" style={{ width: px(24, scale, 19), height: px(24, scale, 19) }} />
              <p style={{ fontSize: px(14, scale, 12) }}>Cargando extensiones...</p>
            </div>
          ) : (
            <EmptyState
              compact
              face="（・_・;）"
              tone="error"
              title="No se pudieron cargar las extensiones"
              action={<Button size="sm" onClick={loadAvailable}>Reintentar</Button>}
            />
          )
        ) : sortedAvailable.length === 0 ? (
          <EmptyState
            compact
            face="ヽ(・∀・)ﾉ"
            title="No quedan extensiones por instalar"
          />
        ) : (
          <div className="grid">
            <div className="invisible col-start-1 row-start-1 pointer-events-none" aria-hidden="true">
              <EmptyState compact face="ヽ(・∀・)ﾉ" title="No quedan extensiones por instalar" animateFace={false} />
            </div>
            <div className="grid col-start-1 row-start-1" style={{ ...grid, alignContent: 'start' }}>
            {sortedAvailable.map((m) => (
              <div key={m.id}>
                <ExtensionCard
                  scale={scale}
                  m={m}
                  confirmationOpen={confirmInstall?.id === m.id}
                  selected={selectedAvailableIds.has(m.id)}
                  onSelectionChange={tutorialPreview ? undefined : (selected) => toggleSelection(setSelectedAvailableIds, m.id, selected)}
                  selectionLabel={`Seleccionar ${m.name} para instalar`}
                  selectionDisabled={busy !== '' || loading}
                  action={
                  <div
                    ref={confirmInstall?.id === m.id ? confirmRef : null}
                    className="relative flex items-center justify-center"
                    style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-transparent hover:text-foreground"
                      title="Instalar"
                      aria-label="Instalar"
                      disabled={busy !== ''}
                      onClick={() => setConfirmInstall(m)}
                      style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                    >
                      <Download style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    </Button>
                    <AnimatePresence>
                      {confirmInstall?.id === m.id && (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                          exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                          transition={{ duration: 0.14, ease: 'easeOut' }}
                          className="absolute z-20 rounded-lg border border-border bg-card shadow-lg"
                          style={{ top: '100%', left: '50%', marginTop: px(6, scale, 4), padding: px(8, scale, 6) }}
                        >
                          <Button
                            size="sm"
                            onClick={async () => {
                              setConfirmInstall(null);
                              await doInstall(m);
                            }}
                            disabled={busy !== ''}
                            style={{ height: px(28, scale, 24), fontSize: px(12, scale, 10), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                           >
                            Instalar
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  }
                />
              </div>
            ))}
          </div>
          </div>
        )}
      </section>
      <Dialog
        open={!!configExt}
        onClose={() => setConfigExt(null)}
        title={`Configuración de ${configExt?.name || ''}`}
        description="Elige los idiomas que muestra cada fuente."
        scale={scale}
      >
        {(configExt?.config?.sources || []).map((sub) => {
          const defaults = Array.isArray(sub.default) && sub.default.length
            ? sub.default
            : (sub.languages || []).map((x) => x.code);
          const cur = langConfig[sub.id]?.languages;
          const active = Array.isArray(cur) && cur.length ? cur : defaults;
          return (
            <div key={sub.id} style={{ marginBottom: px(16, scale, 12) }}>
              <div className="font-medium" style={{ fontSize: px(14, scale, 12), marginBottom: px(8, scale, 6) }}>
                {sub.name}
              </div>
              <div className="flex flex-wrap" style={{ gap: px(6, scale, 5) }}>
                {(sub.languages || []).map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    title={`Idioma ${l.label}`}
                    aria-pressed={active.includes(l.code)}
                    onClick={() => toggleLang(sub.id, l.code, sub.languages)}
                    className={cn(
                      'rounded-full border transition-colors',
                      active.includes(l.code)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                    style={{
                      fontSize: px(12, scale, 10),
                      lineHeight: 1,
                      padding: `${px(6, scale, 5)}px ${px(11, scale, 9)}px`
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </Dialog>
      </div>
    </>
  );
}
