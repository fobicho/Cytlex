import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Download, RefreshCw, AlertTriangle, Loader2, ArrowUpCircle, ArrowUpDown, Settings as SettingsIcon, X, Check, CheckSquare } from 'lucide-react';
import { extensions, isExtensionAllowed, isExtensionInstallable, isNewer, EXTENSION_INSTALLED_EVENT, SOURCE_CONFIG_CHANGE_EVENT } from '../lib/extensions.js';
import { notifyCloudSyncLocalChange } from '../lib/cloudSyncEvents.js';
import { extUpdates } from '../lib/extUpdates.js';
import { settings } from '../lib/settings.js';
import { Card } from './ui/card.jsx';
import { Button } from './ui/button.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { Dialog } from './ui/dialog.jsx';
import { useToast } from './Toast.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils.js';
import { useScale, px, fontPx, toolbarButtonStyle } from '../lib/useScale.js';
import { useI18n } from '../lib/i18n.js';

function ExtensionCard({ m, action, updatable = false, disabled = false, scale = 1, selected = false, confirmationOpen = false, onSelectionChange, selectionLabel, selectionDisabled = false }) {
  const { t } = useI18n();
  const [imgOk, setImgOk] = useState(true);
  const showImg = m.icon && imgOk;
  const declaredRating = String(m.contentWarning || '').trim().toUpperCase();
  const hasAdultContent = ['MIXED', 'NSFW'].includes(declaredRating);
  const contentRating = hasAdultContent ? declaredRating : 'SAFE';
  const contentRatingLabel = contentRating === 'NSFW' ? '+18 NSFW' : contentRating;
  const iconSize = Number(px(40, scale, 32).replace('px', ''));
  const identity = (
    <>
      <div
        className="extension-logo-tile bg-secondary text-secondary-foreground grid place-items-center font-bold shrink-0 overflow-hidden"
        style={{
          width: `${iconSize}px`,
          height: `${iconSize}px`,
          fontSize: fontPx(16, scale, 13),
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
            style={{ fontSize: fontPx(15, scale, 13) }}
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
              style={{ fontSize: fontPx(11, scale, 9) }}
            >
              v{m.version}
            </span>
          )}
          <span
            className={cn(
              'shrink-0 font-semibold',
              hasAdultContent ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
            )}
            title={`${t('Clasificación de contenido')}: ${contentRating}`}
            aria-label={contentRatingLabel}
            style={{ fontSize: fontPx(11, scale, 9) }}
          >
            {contentRatingLabel}
          </span>
        </div>
      </div>
    </>
  );
  return (
    <Card
      className={cn(
        'relative rounded-lg border-border/50 shadow-none hover:shadow-none',
        confirmationOpen && 'relative z-30',
        selected && 'border-primary bg-primary/5',
        updatable && 'cx-update-pulse',
        disabled && 'opacity-50',
        !isExtensionInstallable(m) && 'opacity-80'
      )}
    >
      {onSelectionChange && (
        <button
          type="button"
          onClick={() => onSelectionChange(!selected)}
        aria-label={t(selectionLabel)}
          aria-pressed={selected}
          disabled={selectionDisabled}
          className="absolute inset-0 z-0 cursor-pointer rounded-lg bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default"
        />
      )}
      <div
        className="pointer-events-none relative z-[1] flex items-center"
        style={{ padding: px(14, scale, 11), gap: px(12, scale, 9) }}
      >
        <div className="flex flex-1 min-w-0 items-center" style={{ gap: px(12, scale, 9) }}>
          {identity}
        </div>
        <div className="pointer-events-auto relative z-[1] shrink-0">{action}</div>
      </div>
    </Card>
  );
}

let repoCache = { url: '', available: null, updates: null };
const EXT_CONFIG_KEY = 'cytlex:ext-config:v1';
const DEFAULT_EXTENSION_REPOSITORY = 'https://fobicho.github.io/Cytlex/index.json';
const confirmationPosition = (button, panelHeight = 112) => {
  const rect = button.getBoundingClientRect();
  const panelWidth = Math.min(288, window.innerWidth - 24);
  const center = rect.left + rect.width / 2;
  const minCenter = panelWidth / 2 + 12;
  const maxCenter = window.innerWidth - panelWidth / 2 - 12;
  const centerX = Math.max(minCenter, Math.min(maxCenter, center));
  const bottomNav = document.querySelector('.browser-mobile-nav');
  const bottomLimit = bottomNav && getComputedStyle(bottomNav).display !== 'none'
    ? Math.min(window.innerHeight - 12, bottomNav.getBoundingClientRect().top - 8)
    : window.innerHeight - 12;
  const below = rect.bottom + 8;
  const top = below + panelHeight <= bottomLimit
    ? below
    : Math.max(12, rect.top - panelHeight - 8);
  return {
    top,
    left: centerX
  };
};

const readExtConfig = () => {
  try { return JSON.parse(localStorage.getItem(EXT_CONFIG_KEY)) || {}; } catch { return {}; }
};

const writeExtConfig = (cfg) => {
  try { localStorage.setItem(EXT_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
  notifyCloudSyncLocalChange();
};
const extensionSortModes = ['title-asc', 'title-desc', 'added'];
let manualExtensionCheckInFlight = false;
let manualExtensionCheckCooldownUntil = 0;

const remainingExtensionCheckCooldown = () => Math.max(0, Math.ceil((manualExtensionCheckCooldownUntil - Date.now()) / 1000));

function sortLabel(sortBy) {
  return sortBy === 'title-desc' ? 'Z-A' : sortBy === 'added' ? 'Adición' : 'A-Z';
}

export default function ExtensionsPanel({ tutorialPreview = false, active = true }) {
  const { language, t } = useI18n();
  const { toast } = useToast();
  const scale = useScale();
  const configuredRepo = (settings.get().extIndexUrl || '').trim();
  const initialRepo = configuredRepo || (tutorialPreview ? DEFAULT_EXTENSION_REPOSITORY : '');
  const cacheHit = !!initialRepo && initialRepo === repoCache.url && repoCache.available !== null;
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const [installed, setInstalled] = useState(() => extensions.installed());
  const [available, setAvailable] = useState(() => (cacheHit ? repoCache.available : null));
  const [loading, setLoading] = useState(false);
  const [hasCheckedRepository, setHasCheckedRepository] = useState(cacheHit);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(manualExtensionCheckInFlight);
  const [checkCooldown, setCheckCooldown] = useState(remainingExtensionCheckCooldown);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmInstall, setConfirmInstall] = useState(null);
  const [confirmUpdate, setConfirmUpdate] = useState(null);
  const [updates, setUpdates] = useState(() => (cacheHit ? repoCache.updates || [] : []));
  const [updating, setUpdating] = useState('');
  const [confirmAll, setConfirmAll] = useState(null);
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
    const cur = Array.isArray(cfg[subId]?.languages) ? cfg[subId].languages : defaults;
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    cfg[subId] = { ...(cfg[subId] || {}), languages: next };
    writeExtConfig(cfg);
    setLangConfig({ ...cfg });
    extensions.invalidate(subId);
    window.dispatchEvent(new Event(SOURCE_CONFIG_CHANGE_EVENT));
  };
  const visibleAvailable = available?.filter((manifest) => !isExtensionInstallable(manifest)
    || isExtensionAllowed(manifest, showAdultExtensions));
  const installedById = new Map(installed.map((record) => [record.manifest.id, record.manifest]));
  const visibleUpdates = updates.filter((update) => {
    const manifest = installedById.get(update.id);
    return manifest && isExtensionAllowed(manifest, showAdultExtensions) && isNewer(update.to, manifest.version);
  });
  const sortedInstalled = [...installed].sort((a, b) => {
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
  const allInstalledSelected = sortedInstalled.length > 0
    && sortedInstalled.every(({ manifest }) => selectedInstalledIds.has(manifest.id));
  const selectableAvailable = sortedAvailable.filter(isExtensionInstallable);
  const allAvailableSelected = selectableAvailable.length > 0
    && selectableAvailable.every((manifest) => selectedAvailableIds.has(manifest.id));
  const confirmRef = useRef(null);
  const removeRef = useRef(null);
  const confirmPopoverRef = useRef(null);
  const removePopoverRef = useRef(null);
  const updateRef = useRef(null);
  const updatePopoverRef = useRef(null);
  const [compactRefreshButton, setCompactRefreshButton] = useState(false);
  const allRef = useRef(null);
  const allPopoverRef = useRef(null);
  const bulkInstallRef = useRef(null);
  const bulkUninstallRef = useRef(null);
  const bulkConfirmPopoverRef = useRef(null);
  const installedActionsHeaderRef = useRef(null);
  const installedActionsRef = useRef(null);
  const availableActionsHeaderRef = useRef(null);
  const availableActionsRef = useRef(null);
  const [compactBulkActions, setCompactBulkActions] = useState(false);

  useLayoutEffect(() => {
    const measure = (headerRef, actionsRef) => {
      const header = headerRef.current;
      const actions = actionsRef.current;
      if (!header || !actions) return null;
      actions.classList.add('extensions-measure-full');
      const requiredWidth = actions.getBoundingClientRect().width;
      actions.classList.remove('extensions-measure-full');
      const titleWidth = header.querySelector('h3')?.getBoundingClientRect().width || 0;
      const gap = Number.parseFloat(getComputedStyle(header).columnGap) || 0;
      const safetySpace = 16;
      return { requiredWidth, availableWidth: header.clientWidth - titleWidth - gap - safetySpace };
    };
    const update = () => {
      const measurements = [
        measure(installedActionsHeaderRef, installedActionsRef),
        measure(availableActionsHeaderRef, availableActionsRef)
      ].filter(Boolean);
      if (!measurements.length) return;
      const hysteresis = 32;
      setCompactBulkActions((isCompact) => measurements.some(({ requiredWidth, availableWidth }) => (
        isCompact ? requiredWidth + hysteresis > availableWidth : requiredWidth > availableWidth
      )));
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    [installedActionsHeaderRef, availableActionsHeaderRef].forEach(({ current }) => {
      if (current) observer?.observe(current);
    });
    window.addEventListener('resize', update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [selectedInstalledIds.size, selectedAvailableIds.size, visibleUpdates.length, scale]);

  useLayoutEffect(() => {
    if (!active) return undefined;
    const toolbar = toolbarTarget?.closest('.catalog-toolbar');
    const subroutes = toolbar?.querySelector('[data-catalog-subroutes]');
    if (!toolbar || !subroutes || !toolbarTarget) return undefined;
    const update = () => {
      const actions = toolbarTarget;
      actions.classList.add('extensions-toolbar-measure-full');
      const requiredWidth = actions.getBoundingClientRect().width;
      actions.classList.remove('extensions-toolbar-measure-full');
      const toolbarStyle = getComputedStyle(toolbar);
      const gap = Number.parseFloat(toolbarStyle.columnGap) || 0;
      const padding = (Number.parseFloat(toolbarStyle.paddingLeft) || 0) + (Number.parseFloat(toolbarStyle.paddingRight) || 0);
      const availableWidth = toolbar.clientWidth - padding - subroutes.scrollWidth - gap;
      setCompactRefreshButton((compact) => compact
        ? requiredWidth > availableWidth - 8
        : requiredWidth > availableWidth);
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    [toolbar, subroutes, toolbarTarget].forEach((element) => observer?.observe(element));
    window.addEventListener('resize', update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [toolbarTarget, scale, active]);

  useLayoutEffect(() => {
    const openConfirmations = [
      [confirmRemove, setConfirmRemove, removeRef, removePopoverRef],
      [confirmInstall, setConfirmInstall, confirmRef, confirmPopoverRef],
      [confirmUpdate === 'all' ? null : confirmUpdate, setConfirmUpdate, updateRef, updatePopoverRef]
    ];

    for (const [confirmation, setConfirmation, triggerRef, popoverRef] of openConfirmations) {
      if (!confirmation?.popoverPosition) continue;
      const trigger = triggerRef.current?.querySelector('button');
      const popover = popoverRef.current;
      if (!trigger || !popover) continue;

      const position = confirmationPosition(trigger, popover.offsetHeight);
      setConfirmation((current) => {
        if (!current || current.id !== confirmation.id) return current;
        const previous = current.popoverPosition;
        if (previous?.top === position.top && previous?.left === position.left) return current;
        return { ...current, popoverPosition: position };
      });
    }
  }, [confirmRemove, confirmInstall, confirmUpdate]);

  useLayoutEffect(() => {
    if (!confirmBulk?.popoverPosition) return;
    const triggerRef = confirmBulk.action === 'install' ? bulkInstallRef : bulkUninstallRef;
    const trigger = triggerRef.current?.querySelector('button');
    const popover = bulkConfirmPopoverRef.current;
    if (!trigger || !popover) return;

    const position = confirmationPosition(trigger, popover.offsetHeight);
    setConfirmBulk((current) => {
      if (current?.action !== confirmBulk.action) return current;
      const previous = current.popoverPosition;
      if (previous?.top === position.top && previous?.left === position.left) return current;
      return { ...current, popoverPosition: position };
    });
  }, [confirmBulk]);

  useLayoutEffect(() => {
    if (!confirmAll?.popoverPosition) return;
    const trigger = allRef.current;
    const popover = allPopoverRef.current;
    if (!trigger || !popover) return;

    const position = confirmationPosition(trigger, popover.offsetHeight);
    setConfirmAll((current) => {
      if (!current) return current;
      const previous = current.popoverPosition;
      if (previous?.top === position.top && previous?.left === position.left) return current;
      return { ...current, popoverPosition: position };
    });
  }, [confirmAll]);

  useEffect(() => {
    if (!confirmInstall) return;
    const onDown = (e) => {
      if (confirmRef.current?.contains(e.target) || confirmPopoverRef.current?.contains(e.target)) return;
      setConfirmInstall(null);
    };
    const closeOnLayoutChange = () => setConfirmInstall(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('scroll', closeOnLayoutChange, true);
    window.addEventListener('resize', closeOnLayoutChange);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('scroll', closeOnLayoutChange, true);
      window.removeEventListener('resize', closeOnLayoutChange);
    };
  }, [confirmInstall]);

  useEffect(() => {
    if (!confirmRemove) return;
    const onDown = (e) => {
      if (removeRef.current?.contains(e.target) || removePopoverRef.current?.contains(e.target)) return;
      setConfirmRemove(null);
    };
    const closeOnLayoutChange = () => setConfirmRemove(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('scroll', closeOnLayoutChange, true);
    window.addEventListener('resize', closeOnLayoutChange);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('scroll', closeOnLayoutChange, true);
      window.removeEventListener('resize', closeOnLayoutChange);
    };
  }, [confirmRemove]);

  useEffect(() => {
    if (!confirmUpdate || confirmUpdate === 'all') return;
    const onDown = (e) => {
      if (updateRef.current?.contains(e.target) || updatePopoverRef.current?.contains(e.target)) return;
      setConfirmUpdate(null);
    };
    const closeOnLayoutChange = () => setConfirmUpdate(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('scroll', closeOnLayoutChange, true);
    window.addEventListener('resize', closeOnLayoutChange);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('scroll', closeOnLayoutChange, true);
      window.removeEventListener('resize', closeOnLayoutChange);
    };
  }, [confirmUpdate]);

  useEffect(() => {
    if (!confirmAll) return;
    const onDown = (e) => {
      if (allRef.current?.contains(e.target) || allPopoverRef.current?.contains(e.target)) return;
      setConfirmAll(null);
    };
    const closeOnLayoutChange = () => setConfirmAll(null);
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setConfirmAll(null);
      allRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('scroll', closeOnLayoutChange, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', closeOnLayoutChange);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('scroll', closeOnLayoutChange, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', closeOnLayoutChange);
    };
  }, [confirmAll]);

  useEffect(() => {
    if (!confirmBulk) return;
    const ref = confirmBulk.action === 'install' ? bulkInstallRef : bulkUninstallRef;
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || bulkConfirmPopoverRef.current?.contains(e.target)) return;
      setConfirmBulk(null);
    };
    const closeOnLayoutChange = () => setConfirmBulk(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('scroll', closeOnLayoutChange, true);
    window.addEventListener('resize', closeOnLayoutChange);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('scroll', closeOnLayoutChange, true);
      window.removeEventListener('resize', closeOnLayoutChange);
    };
  }, [confirmBulk]);

  const refresh = () => setInstalled(extensions.installed());

  const searchUpdates = async () => {
    if (manualExtensionCheckInFlight || remainingExtensionCheckCooldown() > 0) return;
    if (!repoUrl) {
      toast({ title: 'No hay un repositorio configurado', description: 'Configura un repositorio para buscar actualizaciones.', variant: 'error' });
      return;
    }
    manualExtensionCheckInFlight = true;
    setCheckingUpdates(true);
    setErr('');
    setLoading(true);
    try {
      await extensions.repoIndex(repoUrl, { refresh: true });
      await extensions.sync(repoUrl);
      refresh();
      const [found] = await Promise.all([
        extensions.checkUpdates(repoUrl),
        loadAvailable(repoUrl)
      ]);
      setUpdates(found);
      setHasCheckedRepository(true);
      if (!found.length) {
        toast({ title: 'No hay actualizaciones pendientes', description: 'Tus extensiones están al día.', variant: 'info' });
      } else {
        toast({
          title: found.length === 1
            ? t('{name} tiene una actualización', { name: found[0].name })
            : t('{count} extensiones tienen actualizaciones', { count: found.length }),
          description: found.length === 1
            ? t('Ya puedes instalar la versión {version}.', { version: found[0].to })
            : t('Ya puedes instalarlas desde Extensiones.'),
          variant: 'info'
        });
      }
    } catch (error) {
      toast({ title: 'No se pudieron buscar actualizaciones', description: String(error?.message || error), variant: 'error' });
    } finally {
      setLoading(false);
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
      setUpdates([]);
      setHasCheckedRepository(false);
      setLoading(false);
      return;
    }
    const cached = repoCache.url === repoUrl && repoCache.available !== null;
    setAvailable(cached ? repoCache.available : null);
    setUpdates(cached ? repoCache.updates || [] : []);
    setHasCheckedRepository(cached);
    setLoading(false);
  }, [repoUrl, tutorialPreview]);

  useEffect(() => {
    if (!active || !repoUrl || tutorialPreview) return undefined;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await extensions.repoIndex(repoUrl, repoUrl === DEFAULT_EXTENSION_REPOSITORY
          ? { refresh: true }
          : { maxAgeMs: 24 * 60 * 60 * 1000 });
        await extensions.sync(repoUrl);
        const [items, found] = await Promise.all([
          extensions.available(repoUrl),
          extensions.checkUpdates(repoUrl)
        ]);
        if (cancelled) return;
        refresh();
        setAvailable(items);
        setUpdates(found);
        setHasCheckedRepository(true);
        setErr('');
      } catch (error) {
        if (!cancelled) {
          setErr(String(error?.message || error));
          setHasCheckedRepository(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active, repoUrl, tutorialPreview]);

  useEffect(() => {
    if (repoUrl && available !== null) {
      repoCache = { url: repoUrl, available, updates };
    }
  }, [repoUrl, available, updates]);

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
    const availableIds = new Set((visibleAvailable || []).filter(isExtensionInstallable).map((manifest) => manifest.id));
    setSelectedAvailableIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [available, showAdultExtensions]);

  const doUpdateOne = async (id) => {
    setUpdating(id);
    setErr('');
    try {
      const r = await extensions.updateAll(repoUrl, [id]);
      refresh();
      setUpdates((current) => current.filter((update) => update.id !== id));
      if (r.ok) {
        extUpdates.clear();
        const updated = r.actualizadas[0];
        toast({
          title: 'Extensión actualizada',
            description: updated ? t('{name} quedó en la versión {version}.', { name: updated.name, version: updated.version }) : undefined,
          variant: 'success'
        });
      } else if (!r.fallos.length) {
        const current = extensions.installed().find(({ manifest }) => manifest.id === id);
        const version = current?.installedVersion || current?.manifest.version;
        toast({
          title: 'La extensión ya está actualizada',
            description: version ? t('Está en la versión {version}.', { version }) : undefined,
          variant: 'info'
        });
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
      const updatedIds = new Set(visibleUpdates.map((update) => update.id));
      setUpdates((current) => current.filter((update) => !updatedIds.has(update.id)));
      if (r.fallos.length) {
        toast({
          title: 'Actualización parcial',
          description: [
            t('{updated} actualizadas, {failed} fallaron.', { updated: r.ok, failed: r.fallos.length }),
            r.actualizadas.map(({ name, version }) => `${name} ${version}`).join(' · ')
          ].filter(Boolean).join(' '),
          variant: 'error'
        });
      } else if (r.ok === 0) {
        const versions = extensions.installed()
          .filter(({ manifest }) => updatedIds.has(manifest.id))
          .map(({ manifest, installedVersion }) => `${manifest.name} ${installedVersion || manifest.version}`)
          .join(' · ');
        toast({
          title: 'Las extensiones ya están actualizadas',
          description: versions || undefined,
          variant: 'info'
        });
      } else {
        extUpdates.clear();
        toast({
          title: t(r.ok === 1 ? '1 extensión actualizada' : '{count} extensiones actualizadas', { count: r.ok }),
          description: r.actualizadas.map(({ name, version }) => `${name} ${version}`).join(' · '),
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
      if (hasCheckedRepository) await loadAvailable();
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
      ? sortedAvailable.filter((manifest) => isExtensionInstallable(manifest) && selectedAvailableIds.has(manifest.id))
      : sortedInstalled.filter(({ manifest }) => selectedInstalledIds.has(manifest.id)).map(({ manifest }) => manifest);
    if (!selectedItems.length) {
      setConfirmBulk(null);
      return;
    }

    setBusy(isInstall ? 'bulk-install' : 'bulk-uninstall');
    setErr('');
    const succeeded = [];
    const failed = [];
    if (isInstall) {
      const results = await Promise.all(selectedItems.map(async (item) => {
        try {
          await extensions.install(item, repoUrl, { backfillLibrary: false });
          return { id: item.id, ok: true };
        } catch {
          return { id: item.id, ok: false };
        }
      }));
      succeeded.push(...results.filter((result) => result.ok).map(({ id }) => id));
      failed.push(...results.filter((result) => !result.ok).map(({ id }) => id));
    } else {
      for (const item of selectedItems) {
        try {
          await extensions.uninstall(item.id);
          succeeded.push(item.id);
        } catch {
          failed.push(item.id);
        }
      }
    }

    const succeededIds = new Set(succeeded);
    if (isInstall) {
      const sourceIds = selectedItems
        .filter((manifest) => succeededIds.has(manifest.id))
        .flatMap((manifest) => [manifest.id, ...(Array.isArray(manifest.config?.sources) ? manifest.config.sources.map((source) => source.id) : [])]);
      if (sourceIds.length) {
        window.dispatchEvent(new CustomEvent(EXTENSION_INSTALLED_EVENT, { detail: { sourceIds } }));
      }
      refresh();
      setAvailable((current) => current?.filter((manifest) => !succeededIds.has(manifest.id)) ?? current);
      setUpdates((current) => current.filter((update) => !succeededIds.has(update.id)));
      setSelectedAvailableIds(new Set(failed));
    } else {
      refresh();
      if (hasCheckedRepository) await loadAvailable();
      setSelectedInstalledIds(new Set(failed));
    }

    setBusy('');
    setConfirmBulk(null);
    if (failed.length) {
      setErr(`No se pudieron ${isInstall ? 'instalar' : 'desinstalar'} ${failed.length} ${failed.length === 1 ? 'extensión' : 'extensiones'}.`);
    } else if (succeeded.length) {
      toast({
        title: isInstall
          ? t(succeeded.length === 1 ? '1 extensión instalada' : '{count} extensiones instaladas', { count: succeeded.length })
          : t(succeeded.length === 1 ? '1 extensión desinstalada' : '{count} extensiones desinstaladas', { count: succeeded.length }),
        variant: 'success'
      });
    }
  };

  const handleBulkAction = (action) => {
    const selectedItems = action === 'install'
      ? sortedAvailable.filter((manifest) => isExtensionInstallable(manifest) && selectedAvailableIds.has(manifest.id))
      : sortedInstalled.filter(({ manifest }) => selectedInstalledIds.has(manifest.id));
    const triggerRef = action === 'install' ? bulkInstallRef : bulkUninstallRef;
    const trigger = triggerRef.current?.querySelector('button');
    if (!selectedItems.length || !trigger) {
      setConfirmBulk(null);
      return;
    }
    if (confirmBulk?.action === action) {
      setConfirmBulk(null);
      return;
    }
    setConfirmBulk({
      action,
      count: selectedItems.length,
      popoverPosition: confirmationPosition(trigger)
    });
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
            className="extensions-square-button extensions-sort-button"
            title={t('Ordenar extensiones')}
            aria-label={`${t('Ordenar extensiones')}: ${t(sortLabel(sortBy))}`}
            onClick={() => {
              const next = extensionSortModes[(extensionSortModes.indexOf(sortBy) + 1) % extensionSortModes.length];
              setSortBy(next);
              try { localStorage.setItem('cytlex:extensionsSort', next); } catch {}
            }}
            style={toolbarButtonStyle(scale)}
          >
            <ArrowUpDown className="extensions-button-icon mr-2" style={{ width: px(14, scale, 11), height: px(14, scale, 11) }} />
            <span className="extensions-button-label">{t(sortLabel(sortBy))}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={cn('extensions-square-button extensions-refresh-button', compactRefreshButton && 'is-compact')}
            onClick={searchUpdates}
            title={checkCooldown ? t('Puedes volver a buscar en {seconds} s', { seconds: checkCooldown }) : t('Buscar actualizaciones')}
            aria-label={t('Buscar actualizaciones')}
            style={{ ...toolbarButtonStyle(scale), opacity: 1 }}
          >
            <RefreshCw
              className={cn('extensions-button-icon mr-2', checkingUpdates && 'animate-spin')}
              style={{ width: px(14, scale, 11), height: px(14, scale, 11) }}
            />
            <span className="extensions-button-label">{t('Buscar actualizaciones')}</span>
          </Button>
        </>,
        toolbarTarget
      )}
      <div className="flex min-w-0 flex-col" style={{ gap: px(32, scale, 22) }}>
      {err && (
        <Card className="border-destructive/40 hover:shadow-sm">
          <div
            className="flex items-center"
            style={{ padding: px(16, scale, 11), gap: px(8, scale, 6), fontSize: fontPx(14, scale, 12) }}
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
          ref={installedActionsHeaderRef}
          className="relative flex items-center justify-between"
          style={{ gap: px(8, scale, 6), marginBottom: px(12, scale, 9) }}
        >
          <div className="flex items-center" style={{ gap: px(12, scale, 8) }}>
            <h3 className="font-medium" style={{ fontSize: fontPx(14, scale, 12) }}>
              {t('Instaladas')}
            </h3>
          </div>
          <div ref={installedActionsRef} className={cn('extensions-bulk-actions absolute right-0 top-1/2 flex min-w-0 max-w-full -translate-y-1/2 items-center justify-end', compactBulkActions && 'is-compact')} style={{ gap: px(8, scale, 6) }}>
            <AnimatePresence initial={false}>
              {!tutorialPreview && selectedInstalledIds.size > 0 && (
                <motion.div
                  key="bulk-uninstall-clear-button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="extensions-square-button"
                    aria-label={t('Limpiar selecciones')}
                    title={t('Limpiar selecciones')}
                    onClick={() => { setSelectedInstalledIds(new Set()); setConfirmBulk(null); }}
                    disabled={busy !== '' || updating !== ''}
                    style={{ height: px(28, scale, 26), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    <X className="extensions-button-icon mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    <span className="extensions-button-label extensions-bulk-label">{t('Limpiar selecciones')}</span>
                  </Button>
                </motion.div>
              )}
              {!tutorialPreview && selectedInstalledIds.size > 0 && (
                <motion.div
                  key="bulk-uninstall-select-all-button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="extensions-square-button"
                    aria-label={t('Seleccionar todo')}
                    title={t('Seleccionar todo')}
                    onClick={() => {
                      setSelectedInstalledIds((current) => allInstalledSelected
                        ? current
                        : new Set(sortedInstalled.map(({ manifest }) => manifest.id)));
                      setConfirmBulk(null);
                    }}
                    disabled={busy !== '' || updating !== '' || allInstalledSelected}
                    style={{ height: px(28, scale, 26), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    <CheckSquare className="extensions-button-icon mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    <span className="extensions-button-label extensions-bulk-label">{t('Seleccionar todo')}</span>
                  </Button>
                </motion.div>
              )}
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
                    className="extensions-square-button bg-red-600 text-white hover:bg-red-700"
                    aria-label={t('Desinstalar seleccionadas')}
                    title={t('Desinstalar seleccionadas')}
                    onClick={() => handleBulkAction('uninstall')}
                    disabled={busy !== '' || updating !== ''}
                    style={{
                      height: px(28, scale, 26),
                      fontSize: fontPx(13, scale, 11),
                      paddingLeft: px(10, scale, 8),
                      paddingRight: px(10, scale, 8)
                    }}
                  >
                    <Trash2 className="extensions-button-icon mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    <span className="extensions-button-label extensions-bulk-label">{t('Desinstalar seleccionadas')}</span>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            {visibleUpdates.length > 0 && (
              <Button
                ref={allRef}
                variant="secondary"
                size="sm"
                aria-haspopup="dialog"
                aria-expanded={!!confirmAll}
                aria-controls={confirmAll ? 'confirm-update-all' : undefined}
                aria-label={t(updating === 'all' ? 'Actualizando extensiones' : 'Actualizar todo')}
                className="extensions-square-button whitespace-nowrap"
                onClick={(event) => {
                  const popoverPosition = confirmationPosition(event.currentTarget);
                  setConfirmAll((current) => current
                    ? null
                    : { popoverPosition });
                }}
                disabled={updating !== ''}
                style={{
                  height: px(32, scale, 28),
                  minWidth: px(176, scale, 140),
                  fontSize: fontPx(14, scale, 12),
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
                        className="extensions-button-icon mr-2 animate-spin"
                        style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
                      />
                      <span className="extensions-button-label">{t('Actualizando...')}</span>
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
                        className="extensions-button-icon mr-2"
                        style={{ width: px(16, scale, 13), height: px(16, scale, 13) }}
                      />
                      <span className="extensions-button-label">{t('Actualizar todo')}</span>
                      <span className="extensions-update-count opacity-70 ml-2">{visibleUpdates.length}</span>
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
            title={t('No hay extensiones instaladas')}
          />
        ) : installed.length > 0 ? (
          <div className="grid min-w-0" style={{ ...grid, alignContent: 'start' }}>
            {sortedInstalled.map(({ manifest: m }) => {
              const upd = visibleUpdates.find((u) => u.id === m.id);
              const blocked = !isExtensionAllowed(m, showAdultExtensions);
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
                    selectionLabel={language === 'en' ? `Select ${m.name} to uninstall` : `Seleccionar ${m.name} para desinstalar`}
                    selectionDisabled={busy !== ''}
                    action={
                    <div className="flex items-center" style={{ gap: px(4, scale, 3) }}>
                      {!blocked && Array.isArray(m.config?.sources) && m.config.sources.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="active:scale-100 hover:bg-transparent hover:text-foreground"
                          title={language === 'en' ? `${m.name} settings` : `Configuración de ${m.name}`}
                          aria-label={language === 'en' ? `${m.name} settings` : `Configuración de ${m.name}`}
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
                            className="active:scale-100 hover:bg-transparent hover:text-foreground"
                            title={language === 'en' ? `Update to v${upd.to}` : `Actualizar a la v${upd.to}`}
                            aria-label={language === 'en' ? `Update ${m.name}` : `Actualizar ${m.name}`}
                            disabled={updating !== ''}
                            onClick={(event) => {
                              const popoverPosition = confirmationPosition(event.currentTarget);
                              setConfirmUpdate((current) => current?.id === upd.id
                                ? null
                                : { ...upd, popoverPosition });
                            }}
                            style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                          >
                            {updating === m.id ? (
                              <Loader2 className="animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                            ) : (
                              <Download style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                            )}
                          </Button>
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
                          className="active:scale-100 text-destructive hover:bg-transparent hover:text-destructive"
                          title={t('Desinstalar')}
                          aria-label={t('Desinstalar')}
                          disabled={busy !== ''}
                          onClick={(event) => {
                            const popoverPosition = confirmationPosition(event.currentTarget);
                            setConfirmRemove((current) => current?.id === m.id
                              ? null
                              : { ...m, popoverPosition });
                          }}
                          style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                        >
                          <Trash2 style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                        </Button>
                      </div>
                    </div>
                    }
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section>
        <div
          ref={availableActionsHeaderRef}
          className="relative flex items-center justify-between"
          style={{ gap: px(8, scale, 6), marginBottom: px(12, scale, 9) }}
        >
          <h3 className="font-medium" style={{ fontSize: fontPx(14, scale, 12) }}>
            {t('Disponibles')}
          </h3>
          <div ref={availableActionsRef} className={cn('extensions-bulk-actions absolute right-0 top-1/2 flex min-w-0 max-w-full -translate-y-1/2 items-center justify-end', compactBulkActions && 'is-compact')} style={{ gap: px(8, scale, 6) }}>
            <AnimatePresence initial={false}>
              {!tutorialPreview && selectedAvailableIds.size > 0 && (
                <motion.div
                  key="bulk-install-clear-button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="extensions-square-button"
                    aria-label={t('Limpiar selecciones')}
                    title={t('Limpiar selecciones')}
                    onClick={() => { setSelectedAvailableIds(new Set()); setConfirmBulk(null); }}
                    disabled={busy !== '' || loading || updating !== ''}
                    style={{ height: px(28, scale, 26), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    <X className="extensions-button-icon mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    <span className="extensions-button-label extensions-bulk-label">{t('Limpiar selecciones')}</span>
                  </Button>
                </motion.div>
              )}
              {!tutorialPreview && selectedAvailableIds.size > 0 && (
                <motion.div
                  key="bulk-install-select-all-button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="extensions-square-button"
                    aria-label={t('Seleccionar todo')}
                    title={t('Seleccionar todo')}
                    onClick={() => {
                      setSelectedAvailableIds((current) => allAvailableSelected
                        ? current
                        : new Set(selectableAvailable.map((manifest) => manifest.id)));
                      setConfirmBulk(null);
                    }}
                    disabled={busy !== '' || loading || updating !== '' || allAvailableSelected}
                    style={{ height: px(28, scale, 26), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    <CheckSquare className="extensions-button-icon mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    <span className="extensions-button-label extensions-bulk-label">{t('Seleccionar todo')}</span>
                  </Button>
                </motion.div>
              )}
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
                    className="extensions-square-button"
                    aria-label={t('Instalar seleccionadas')}
                    title={t('Instalar seleccionadas')}
                    onClick={() => handleBulkAction('install')}
                    disabled={busy !== '' || loading || updating !== ''}
                    style={{
                      height: px(28, scale, 26),
                      fontSize: fontPx(13, scale, 11),
                      paddingLeft: px(10, scale, 8),
                      paddingRight: px(10, scale, 8)
                    }}
                  >
                    <Download className="extensions-button-icon mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    <span className="extensions-button-label extensions-bulk-label">{t('Instalar seleccionadas')}</span>
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
            title={t('Sin repositorio configurado')}
          />
        ) : available === null ? (
          loading ? (
            <div
              className="flex flex-col items-center text-muted-foreground"
              style={{ gap: px(12, scale, 9), padding: `${px(24, scale, 18)}px 0` }}
            >
              <Loader2 className="animate-spin" style={{ width: px(24, scale, 19), height: px(24, scale, 19) }} />
              <p style={{ fontSize: fontPx(14, scale, 12) }}>{t('Cargando extensiones...')}</p>
            </div>
          ) : !hasCheckedRepository ? (
            <EmptyState
              compact
              face="（・_・）"
              tone="prompt"
              title={t('Pulsa «Buscar actualizaciones» para cargar el catálogo')}
            />
          ) : (
            <EmptyState
              compact
              face="（・_・;）"
              tone="error"
              title={t('No se pudieron cargar las extensiones')}
            />
          )
        ) : sortedAvailable.length === 0 ? (
          <EmptyState
            compact
            face="ヽ(・∀・)ﾉ"
            title={t('No quedan extensiones por instalar')}
          />
        ) : (
          <div className="grid min-w-0" style={{ ...grid, alignContent: 'start' }}>
            {sortedAvailable.map((m) => (
              <div key={m.id}>
                <ExtensionCard
                  scale={scale}
                  m={m}
                  confirmationOpen={confirmInstall?.id === m.id}
                  selected={selectedAvailableIds.has(m.id)}
                  onSelectionChange={tutorialPreview || !isExtensionInstallable(m) ? undefined : (selected) => toggleSelection(setSelectedAvailableIds, m.id, selected)}
                  selectionLabel={`Seleccionar ${m.name} para instalar`}
                  selectionDisabled={busy !== '' || loading || !isExtensionInstallable(m)}
                  action={
                  <div
                    ref={confirmInstall?.id === m.id ? confirmRef : null}
                    className="relative flex items-center justify-center"
                    style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="active:scale-100 hover:bg-transparent hover:text-foreground"
                      title={t(isExtensionInstallable(m) ? 'Instalar' : 'Instalación no disponible temporalmente')}
                      aria-label={t(isExtensionInstallable(m) ? 'Instalar' : 'Instalación no disponible temporalmente')}
                      disabled={busy !== '' || !isExtensionInstallable(m)}
                      onClick={(event) => {
                        const popoverPosition = confirmationPosition(event.currentTarget);
                        setConfirmInstall((current) => current?.id === m.id
                          ? null
                          : { ...m, popoverPosition });
                      }}
                      style={{ width: px(32, scale, 27), height: px(32, scale, 27) }}
                    >
                      <Download style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                    </Button>
                  </div>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {createPortal(
        <>
          <AnimatePresence>
            {confirmAll?.popoverPosition && (
              <motion.div
                ref={allPopoverRef}
                id="confirm-update-all"
                key="confirm-update-all"
                initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                role="dialog"
                aria-label={t('Confirmar actualización de todas las extensiones')}
                aria-describedby="confirm-update-all-description"
                className="fixed z-[70] flex flex-col border border-border bg-card shadow-xl"
                style={{ ...confirmAll.popoverPosition, width: Math.min(288, window.innerWidth - 24), padding: px(12, scale, 10), gap: px(10, scale, 8) }}
              >
                <div className="min-w-0">
                  <p className="font-semibold" style={{ fontSize: fontPx(14, scale, 12) }}>
                    ¿Actualizar todas las extensiones?
                  </p>
                  <p id="confirm-update-all-description" className="mt-1 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10), lineHeight: 1.4 }}>
                    {visibleUpdates.length} {visibleUpdates.length === 1 ? 'actualización disponible' : 'actualizaciones disponibles'}.
                  </p>
                </div>
                <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="confirmation-cancel-button"
                    onClick={() => {
                      setConfirmAll(null);
                      allRef.current?.focus();
                    }}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    {t('Cancelar')}
                  </Button>
                  <Button
                    size="sm"
                    className="confirmation-action-button"
                    aria-label={t('Confirmar actualización de todas las extensiones')}
                    onClick={async () => {
                      setConfirmAll(null);
                      await doUpdateAll();
                    }}
                    disabled={updating !== ''}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    Actualizar
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {confirmUpdate?.popoverPosition && confirmUpdate !== 'all' && (
              <motion.div
                ref={updatePopoverRef}
                key="confirm-update"
                initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                role="dialog"
                aria-label={`Confirmar actualización de ${confirmUpdate.name}`}
                className="fixed z-[70] flex flex-col border border-border bg-card shadow-xl"
                style={{ ...confirmUpdate.popoverPosition, width: Math.min(288, window.innerWidth - 24), padding: px(12, scale, 10), gap: px(10, scale, 8) }}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold" style={{ fontSize: fontPx(14, scale, 12) }}>{t('¿Actualizar {name}?', { name: confirmUpdate.name })}</p>
                  <p className="mt-1 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10), lineHeight: 1.4 }}>
                    Se instalará la versión v{confirmUpdate.to} (actualmente v{confirmUpdate.from}).
                  </p>
                </div>
                <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="confirmation-cancel-button"
                    onClick={() => setConfirmUpdate(null)}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    {t('Cancelar')}
                  </Button>
                  <Button
                    size="sm"
                    className="confirmation-action-button"
                    aria-label={t('Confirmar actualización')}
                    onClick={async () => {
                      const id = confirmUpdate.id;
                      setConfirmUpdate(null);
                      await doUpdateOne(id);
                    }}
                    disabled={updating !== ''}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    Actualizar
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {confirmRemove?.popoverPosition && (
              <motion.div
                ref={removePopoverRef}
                key="confirm-remove"
                initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                role="dialog"
                aria-label={`Confirmar desinstalación de ${confirmRemove.name}`}
                className="fixed z-[70] flex flex-col border border-border bg-card shadow-xl"
                style={{ ...confirmRemove.popoverPosition, width: Math.min(288, window.innerWidth - 24), padding: px(12, scale, 10), gap: px(10, scale, 8) }}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold" style={{ fontSize: fontPx(14, scale, 12) }}>{t('¿Desinstalar {name}?', { name: confirmRemove.name })}</p>
                  <p className="mt-1 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10), lineHeight: 1.4 }}>
                    No podrás usar sus fuentes hasta volver a instalarla.
                  </p>
                </div>
                <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="confirmation-cancel-button"
                    onClick={() => setConfirmRemove(null)}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    {t('Cancelar')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="confirmation-action-button"
                    aria-label={t('Confirmar desinstalación')}
                    onClick={async () => {
                      const id = confirmRemove.id;
                      setConfirmRemove(null);
                      await doUninstall(id);
                    }}
                    disabled={busy !== ''}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    Desinstalar
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {confirmInstall?.popoverPosition && (
              <motion.div
                ref={confirmPopoverRef}
                key="confirm-install"
                initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                role="dialog"
                aria-label={`Confirmar instalación de ${confirmInstall.name}`}
                className="fixed z-[70] flex flex-col border border-border bg-card shadow-xl"
                style={{ ...confirmInstall.popoverPosition, width: Math.min(288, window.innerWidth - 24), padding: px(12, scale, 10), gap: px(10, scale, 8) }}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold" style={{ fontSize: fontPx(14, scale, 12) }}>{t('¿Instalar {name}?', { name: confirmInstall.name })}</p>
                  <p className="mt-1 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10), lineHeight: 1.4 }}>
                    Quedará disponible para buscar mangas en Explorar.
                  </p>
                </div>
                <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="confirmation-cancel-button"
                    onClick={() => setConfirmInstall(null)}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    {t('Cancelar')}
                  </Button>
                  <Button
                    size="sm"
                    className="confirmation-action-button"
                    aria-label={t('Confirmar instalación')}
                    onClick={async () => {
                      const { popoverPosition, ...manifest } = confirmInstall;
                      setConfirmInstall(null);
                      await doInstall(manifest);
                    }}
                    disabled={busy !== ''}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    Instalar
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {confirmBulk?.popoverPosition && (
              <motion.div
                ref={bulkConfirmPopoverRef}
                key="confirm-bulk-action"
                initial={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
                exit={{ opacity: 0, y: -6, x: '-50%', scale: 0.96 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                role="dialog"
                aria-label={`Confirmar ${confirmBulk.action === 'install' ? 'instalación' : 'desinstalación'} de ${confirmBulk.count} ${confirmBulk.count === 1 ? 'extensión' : 'extensiones'}`}
                className="fixed z-[70] flex flex-col border border-border bg-card shadow-xl"
                style={{ ...confirmBulk.popoverPosition, width: Math.min(288, window.innerWidth - 24), padding: px(12, scale, 10), gap: px(10, scale, 8) }}
              >
                <div className="min-w-0">
                  <p className="font-semibold" style={{ fontSize: fontPx(14, scale, 12) }}>
                    ¿{confirmBulk.action === 'install' ? 'Instalar' : 'Desinstalar'} {confirmBulk.count} {confirmBulk.count === 1 ? 'extensión' : 'extensiones'}?
                  </p>
                  <p className="mt-1 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10), lineHeight: 1.4 }}>
                    {confirmBulk.action === 'install'
                      ? 'Quedarán disponibles para buscar mangas en Explorar.'
                      : 'No podrás usar sus fuentes hasta volver a instalarlas.'}
                  </p>
                </div>
                <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="confirmation-cancel-button"
                    onClick={() => setConfirmBulk(null)}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
              {t('Cancelar')}
                  </Button>
                  <Button
                    variant={confirmBulk.action === 'install' ? 'default' : 'destructive'}
                    size="sm"
                    className="confirmation-action-button"
                    aria-label={`Confirmar ${confirmBulk.action === 'install' ? 'instalación' : 'desinstalación'} de ${confirmBulk.count} ${confirmBulk.count === 1 ? 'extensión' : 'extensiones'}`}
                    onClick={() => {
                      const action = confirmBulk.action;
                      setConfirmBulk(null);
                      runBulkAction(action);
                    }}
                    disabled={busy !== '' || updating !== ''}
                    style={{ height: px(32, scale, 28), fontSize: fontPx(13, scale, 11), paddingLeft: px(10, scale, 8), paddingRight: px(10, scale, 8) }}
                  >
                    {confirmBulk.action === 'install' ? 'Instalar' : 'Desinstalar'}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body
      )}

      <Dialog
        open={!!configExt}
        onClose={() => setConfigExt(null)}
        title={language === 'en' ? `${configExt?.name || ''} settings` : `Configuración de ${configExt?.name || ''}`}
        description={t('Selecciona qué idiomas incluir en cada fuente.')}
        hideDivider
        scale={scale}
      >
        <div className="space-y-3">
          {(configExt?.config?.sources || []).map((sub) => {
            const defaults = Array.isArray(sub.default) && sub.default.length
              ? sub.default
              : (sub.languages || []).map((x) => x.code);
            const cur = langConfig[sub.id]?.languages;
            const active = Array.isArray(cur) ? cur : defaults;
            return (
              <div
                key={sub.id}
                role="group"
                aria-labelledby={`extension-language-group-${sub.id}`}
                className="rounded-xl border border-border bg-background/40 p-4"
              >
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 id={`extension-language-group-${sub.id}`} className="font-medium" style={{ fontSize: fontPx(14, scale, 12) }}>
                    {sub.name}
                  </h3>
                  <span className="shrink-0 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }}>
                    {active.length === 0 ? 'Desactivada' : `${active.length} seleccionado${active.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="flex flex-wrap" style={{ gap: px(8, scale, 6) }}>
                  {(sub.languages || []).map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      aria-pressed={active.includes(l.code)}
                      onClick={() => toggleLang(sub.id, l.code, sub.languages)}
                      className={cn(
                        'inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-lg border px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed',
                        active.includes(l.code)
                          ? 'border-primary/70 bg-primary/10 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                      style={{ fontSize: fontPx(12, scale, 10) }}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                          active.includes(l.code) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'
                        )}
                      >
                        {active.includes(l.code) && <Check className="h-3 w-3" />}
                      </span>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Dialog>
      </div>
    </>
  );
}
