import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { Plus, Palette, Library as LibraryIcon, BookOpen, Puzzle, Tags, Trash2, Link2, RefreshCw, LogOut, Loader2, Database, Download, Upload, CircleHelp, Info, Settings as SettingsIcon, Monitor, Sun, Moon, Cloud } from 'lucide-react';
import { CONTENT_WARNING_RATINGS, resolveMode, settings } from '../lib/settings.js';
import { isMangaCover, isUnresolvedMihonSource, lib } from '../lib/library.js';
import { api } from '../lib/api.js';
import { anilist } from '../lib/anilist.js';
import { consumeBrowserAuthError, consumeBrowserSettingsSection, session } from '../lib/session.js';
import { tracking } from '../lib/tracking.js';
import { progress } from '../lib/progress.js';
import { MODES, THEMES } from '../lib/themes.js';
import { useI18n } from '../lib/i18n.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { chapterOrder } from '../lib/searchState.js';
import { compressBackup, createBackup, parseBackup, readBackupFile, restoreBackup } from '../lib/backup.js';
import { importMihonBackup, previewMihonBackup } from '../lib/mihonBackup.js';
import { extensions, isExtensionAllowed, isSourceConfigured } from '../lib/extensions.js';
import { Button } from '../components/ui/button.jsx';
import LanguageToggle from '../components/LanguageToggle.jsx';
import { LanguageLayoutMotionProvider, useLanguageLayoutMotion } from '../lib/languageLayoutMotion.js';
import { Dropdown } from '../components/ui/dropdown.jsx';
import { Dialog } from '../components/ui/dialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { Input } from '../components/ui/input.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px, fontPx } from '../lib/useScale.js';
import { clearPersistentLibraryCoverCache, invalidateLibraryCovers, persistAvailableLibraryCover, preloadLibraryCoversBatch, protectLibraryCovers } from '../lib/covers.js';
import { browserImageUrl, setHttpGetBatchWindow, setKomiwaImportHints } from '../lib/browserHttp.js';
import { clearSourceCache } from '../lib/sourceCache.js';
import { clearRecentChapters } from '../lib/recentChapters.js';
import SubrouteTabLabel from '../components/SubrouteTabLabel.jsx';
import { attachHorizontalScrollFade } from '../lib/horizontalScrollFade.js';
import CloudSyncPanel from '../components/CloudSyncPanel.jsx';
import { cloudSync } from '../lib/cloudSync.js';

function clearLibraryUnreadCache() {
  localStorage.removeItem('cytlex:libraryUnread:v1');
  localStorage.removeItem('cytlex:libraryUnread:v2');
  window.dispatchEvent(new Event('cytlex:library-unread-reset'));
}

function needsPersistentImportedCover(cover) {
  return typeof cover === 'string'
    && /^https?:\/\//i.test(cover)
    && (Boolean(window.cytlex?.fetchImage) || browserImageUrl(cover) !== cover);
}

function mihonWorkKey(manga) {
  const normalize = (value) => String(value || '').normalize('NFKC').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const title = normalize(manga?.title);
  const author = normalize(manga?.author || manga?.artist);
  return title && author ? `${title}|${author}` : '';
}

async function preloadImportedCovers(mangas, onProgress, { refresh = false } = {}) {
  const rows = (mangas || []).filter((manga) => needsPersistentImportedCover(manga?.cover));
  const allCoverUrls = [...new Set(rows.map((manga) => manga.cover))];
  const localCovers = new Map();
  const localCoverUrls = new Set();
  let localCompleted = 0;
  if (!refresh) rows.forEach((manga) => {
    const available = manga?.coverLocal || manga?.coverCached;
    if (/^(?:blob:|data:)/i.test(available || '') && !localCovers.has(manga.cover)) localCovers.set(manga.cover, available);
  });
  await Promise.all([...localCovers].map(async ([url, available]) => {
    try {
      if (await persistAvailableLibraryCover(url, available)) localCoverUrls.add(url);
    } catch {} finally {
      localCompleted += 1;
      onProgress?.({ label: 'Preparando las portadas', current: localCompleted, total: allCoverUrls.length });
    }
  }));
  const covers = [...new Set(rows.map((manga) => manga?.cover)
    .filter((cover) => needsPersistentImportedCover(cover) && !localCoverUrls.has(cover)))];
  if (refresh && covers.length) await invalidateLibraryCovers(covers);
  const results = await preloadLibraryCoversBatch(covers, {
    web: true,
    persist: true,
    onProgress: ({ current }) => onProgress?.({ label: 'Preparando las portadas', current: localCompleted + current, total: allCoverUrls.length })
  });
  const persistedUrls = new Set(localCoverUrls);
  results.forEach((cover, index) => { if (cover) persistedUrls.add(covers[index]); });
  const failedUrls = new Set(covers.filter((cover) => !persistedUrls.has(cover)));
  return {
    failed: failedUrls.size,
    failedUrls,
    persistedUrls
  };
}

function allowedImportedMangas(mangas) {
  const showAdultExtensions = settings.get().showAdultExtensions;
  return (mangas || []).filter((manga) => {
    const resolvedId = importedSourceId(manga);
    return isExtensionAllowed(extensions.manifest(resolvedId), showAdultExtensions);
  });
}

function importedSourceId(manga) {
  const sourceId = manga?.sourceId || 'leercapitulo';
  const savedSourceName = String(manga?.sourceName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (savedSourceName.startsWith('mangadex') && /(?:english|ingles|mangadexen)/.test(savedSourceName)) return 'mangadex-en';
  return extensions.resolveInstalledSource(sourceId, manga?.sourceName, manga?.url) || sourceId;
}

async function prepareImportedDetails(mangas) {
  const rows = await Promise.all(mangas.map(async (manga) => {
    const sourceId = importedSourceId(manga);
    try {
      return { manga, sourceId, cached: await api.restoreDetail(manga.url, sourceId, manga.sourceId || 'leercapitulo') };
    } catch (error) {
      return { manga, sourceId, error };
    }
  }));
  const sources = new Set(rows.filter(({ cached, error }) => !error && !cached?.chapters?.length).map(({ sourceId }) => sourceId));
  await Promise.race([
    Promise.allSettled([...sources].map((sourceId) => extensions.source(sourceId))),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);
  return rows;
}

async function cacheImportedLibraryDetails(mangas, onProgress, persistedCoverUrls = new Set()) {
  let failed = 0;
  const mangadexCoversToPersist = new Map();
  const allowedMangas = allowedImportedMangas(mangas).filter((manga) => {
    const sourceId = importedSourceId(manga);
    const manifest = extensions.manifest(sourceId);
    return extensions.isInstalled(sourceId) && isSourceConfigured(manifest);
  });
  let next = 0;
  let current = 0;
  const restoreBatchWindow = setHttpGetBatchWindow(allowedMangas.length > 1 ? 500 : 0);
  const restoreKomiwaHints = setKomiwaImportHints(allowedMangas);
  try {
    const prepared = await prepareImportedDetails(allowedMangas);
    await Promise.all(Array.from({ length: Math.min(50, prepared.length) }, async () => {
      while (next < prepared.length) {
        const { manga, sourceId: resolvedId, cached, error } = prepared[next++];
        const savedSourceId = manga?.sourceId || 'leercapitulo';
        try {
          if (error) throw error;
          let detailUrl = manga?.url;
          let detail = cached?.chapters?.length ? cached : null;
          if (!detail) {
            try {
              detail = await api.detail(detailUrl, resolvedId, {
                cacheResult: false,
                persistResult: false,
                allowDisabled: true,
                timeoutMs: 120_000
              });
            } catch (error) {
              const message = String(error?.message || error);
              const staleSourceEntry = /\bHTTP 404\b/.test(message)
                || (resolvedId === 'komiwa' && /No se encontraron los datos del manga en Komiwa/i.test(message));
              if (!staleSourceEntry) throw error;
              const recovered = await api.findManga({
                url: detailUrl,
                title: manga?.title,
                author: manga?.author || manga?.artist || ''
              }, resolvedId);
              if (!recovered?.detail?.chapters?.length) throw error;
              detailUrl = recovered.url;
              detail = recovered.detail;
            }
          }
          if (detailUrl !== manga?.url) {
            lib.updateFav(manga.url, {
              url: detailUrl,
              title: detail.title || manga.title,
              cover: detail.cover || manga.cover,
              description: detail.sinopsis || manga.description,
              author: detail.facts?.autor || detail.author || manga.author,
              type: detail.facts?.tipo || manga.type,
              genres: detail.genres?.length ? detail.genres : manga.genres,
              chapterTotal: detail.chapters.length
            }, savedSourceId);
            tracking.move(manga.url, detailUrl, savedSourceId);
            chapterOrder.move(manga.url, detailUrl);
            chapterIndex.drop(manga.url, savedSourceId);
            chapterIndex.set(detailUrl, resolvedId, detail.chapters.map((chapter) => chapter.url).filter(Boolean));
          }
          if (['mangadex', 'mangadex-en'].includes(resolvedId)
            && !isMangaCover(manga?.cover, manga?.url)
            && isMangaCover(detail?.cover, detailUrl)) {
            lib.updateFav(detailUrl, { cover: detail.cover }, savedSourceId);
          }
          if (['mangadex', 'mangadex-en'].includes(resolvedId)
            && isMangaCover(detail?.cover, detailUrl)
            && needsPersistentImportedCover(detail.cover)
            && !persistedCoverUrls.has(detail.cover)) {
            mangadexCoversToPersist.set(detailUrl, { ...manga, url: detailUrl, cover: detail.cover, coverLocal: '', coverCached: '' });
          }
          if (!detail?.chapters?.length || !(await api.persistLibraryDetail(detailUrl, resolvedId, detail, savedSourceId))) failed += 1;
        } catch { failed += 1; }
        current += 1;
        onProgress?.({ label: 'Recuperando detalles de las fuentes', current, total: allowedMangas.length, currentLabel: manga?.title || 'Manga' });
      }
    }));
    let coverFailedUrls = new Set();
    if (mangadexCoversToPersist.size) {
      const covers = await preloadImportedCovers([...mangadexCoversToPersist.values()], onProgress);
      coverFailedUrls = covers.failedUrls;
    }
    return { failed, coverFailedUrls };
  } finally {
    restoreKomiwaHints();
    restoreBatchWindow();
  }
}

async function refreshImportedMihonDetails(mangas, onProgress) {
  const rows = allowedImportedMangas(mangas).filter((manga) => {
    const sourceId = importedSourceId(manga);
    const manifest = extensions.manifest(sourceId);
    return extensions.isInstalled(sourceId) && isSourceConfigured(manifest);
  });
  const results = [];
  const attempted = [];
  let next = 0;
  let current = 0;
  const restoreBatchWindow = setHttpGetBatchWindow(rows.length > 1 ? 500 : 0);
  const restoreKomiwaHints = setKomiwaImportHints(rows);
  try {
    const prepared = await prepareImportedDetails(rows);
    await Promise.all(Array.from({ length: Math.min(50, prepared.length) }, async () => {
      while (next < prepared.length) {
        const { manga, sourceId, cached, error } = prepared[next++];
        attempted.push(manga);
        try {
          if (error) throw error;
          let detail = cached;
          let detailUrl = manga.url;
          if (!detail?.chapters?.length || !detail.cover || !isMangaCover(detail.cover, manga.url)) {
            try {
              detail = await api.detail(manga.url, sourceId, {
                cacheResult: false,
                persistResult: false,
                allowDisabled: true,
                timeoutMs: 120_000
              });
            } catch (error) {
              if (sourceId !== 'olympusscanlation' || !/\bHTTP 404\b/.test(String(error?.message || error))) throw error;
              const recovered = await api.findManga({ url: manga.url, title: manga.title, author: manga.author || manga.artist || '' }, sourceId);
              if (!recovered?.detail?.chapters?.length) throw error;
              detailUrl = recovered.url;
              detail = recovered.detail;
            }
          }
          if (detail) results.push({ manga, sourceId, detail, detailUrl });
        } catch {}
        current += 1;
        onProgress?.({
          label: 'Recuperando detalles de las fuentes',
          current,
          total: rows.length,
          currentLabel: manga.title || 'Manga'
        });
      }
    }));
  } finally {
    restoreKomiwaHints();
    restoreBatchWindow();
  }
  return { results, attempted };
}

export function BackupProgress({ progress, scale }) {
  const { t } = useI18n();
  if (!progress) return null;
  const determinate = progress.total > 0;
  const value = determinate ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div className="space-y-2 rounded-lg border bg-secondary/40" style={{ padding: px(12, scale, 10), marginBottom: px(16, scale, 12) }} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground" style={{ fontSize: fontPx(13, scale, 11) }}>{t(progress.label)}</span>
        {determinate && <span className="shrink-0 text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }}>{progress.current} {t('de')} {progress.total}</span>}
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t(progress.label)}
        aria-valuemin={0}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? value : undefined}
      >
        <div
          className={`h-full rounded-full bg-primary transition-[width] duration-200 ${determinate ? '' : 'w-2/5 animate-pulse'}`}
          style={determinate ? { width: `${value}%` } : undefined}
        />
      </div>
      {progress.currentLabel && <p className="truncate text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }} title={progress.currentLabel}>{progress.currentLabel}</p>}
    </div>
  );
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Importación cancelada.');
  error.name = 'AbortError';
  throw error;
}

function Switch({ on, onChange, label, disabled = false, scale = 1 }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={t(label)}
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
  const { t, isLanguagePreview } = useI18n();
  const reduceMotion = useReducedMotion();
  const languageLayoutMotion = useLanguageLayoutMotion();
  const animateLanguageLayout = isLanguagePreview || languageLayoutMotion;
  const layoutTransition = animateLanguageLayout && !reduceMotion
    ? { layout: { duration: 0.24, ease: [0.23, 1, 0.32, 1] } }
    : undefined;
  return (
    <motion.div
      layout={animateLanguageLayout && !reduceMotion ? 'size' : false}
      transition={layoutTransition}
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
          {typeof title === 'string' ? t(title) : title}
        </div>
        {desc && (
          <div
            className="text-muted-foreground leading-snug"
            style={{ fontSize: fontPx(12, scale, 10), marginTop: px(4, scale, 3) }}
          >
            {typeof desc === 'string' ? t(desc) : desc}
          </div>
        )}
      </div>
      {right && (
        <motion.div
          layout={animateLanguageLayout && !reduceMotion ? 'size' : false}
          transition={layoutTransition}
          className={cn('shrink-0 flex items-center', stackOnMobile && 'max-md:ml-auto max-md:justify-end')}
        >
          {right}
        </motion.div>
      )}
    </motion.div>
  );
}

function ConnectHint({ open, hintRef, scale, reduceMotion, className, message = '¡Conecta tu cuenta primero!' }) {
  const { t } = useI18n();
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
          {t(message)}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Segmented({ value, options, onChange, scale = 1, stableLayout = false }) {
  const { t } = useI18n();
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
          {t(label)}
        </Button>
      ))}
    </div>
  );
}

function ModeToggle({ value, options, onChange }) {
  const { t } = useI18n();
  const ModeIcon = value === 'light' ? Sun : value === 'dark' ? Moon : Monitor;

  return (
    <div
      role="group"
      aria-label={t('Modo')}
      className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1 text-card-foreground shadow-sm"
    >
      <ModeIcon aria-hidden="true" className="ml-1 h-4 w-4 text-muted-foreground" />
      <div className="relative grid grid-cols-3 rounded-lg p-0.5">
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0.5 left-0.5 w-16 rounded-md bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none',
            value === 'light' && 'translate-x-full',
            value === 'dark' && 'translate-x-[200%]'
          )}
        />
        {options.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
            className={cn(
              'relative z-10 w-16 rounded-lg px-1 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
              value === mode ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: 'apariencia', label: 'Apariencia', icon: Palette },
  { id: 'biblioteca', label: 'Biblioteca', icon: LibraryIcon },
  { id: 'lector', label: 'Lector', icon: BookOpen },
  { id: 'categorias', label: 'Categorías', icon: Tags },
  { id: 'extensiones', label: 'Extensiones', icon: Puzzle },
  { id: 'seguimiento', label: 'Seguimiento', icon: Link2 },
  { id: 'cuenta', label: 'Cuenta', icon: Cloud },
  { id: 'respaldo', label: 'Respaldo', icon: Database }
];
const VISIBLE_SECTIONS = cloudSync.getState().configured
  ? SECTIONS
  : SECTIONS.filter(({ id }) => id !== 'cuenta');

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
const sortByName = (items, getName = (item) => item?.name || '') => [...items].sort((a, b) =>
  String(getName(a)).localeCompare(String(getName(b)), 'es', { sensitivity: 'base' })
);

let sessionSeccion = '';

export default function Settings({ tutorialPreview = false, tutorialImportControls = null, onTutorialImportBusyChange = null, onTutorialImportProgressChange = null }) {
  const { language, t } = useI18n();
  const location = useLocation();
  const [s, setS] = useState(settings.get());
  const [languageLayoutMotion, setLanguageLayoutMotion] = useState(false);
  const languageLayoutTimerRef = useRef(null);
  const languageLayoutFrameRef = useRef(null);
  const [section, setSection] = useState(() => {
    const restoredSection = tutorialImportControls ? 'respaldo' : consumeBrowserSettingsSection() || sessionSeccion;
    return VISIBLE_SECTIONS.some(({ id }) => id === restoredSection) ? restoredSection : 'apariencia';
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
  const [confirmAdultExtensions, setConfirmAdultExtensions] = useState(false);
  const [adultRatingsDialog, setAdultRatingsDialog] = useState(false);
  const [adultRatingsDraft, setAdultRatingsDraft] = useState(() => [...settings.get().adultContentRatings]);
  const adultImportTargetRef = useRef(null);
  const [confirmRemoveRepo, setConfirmRemoveRepo] = useState(false);
  const [backupCandidate, setBackupCandidate] = useState(null);
  const [backupInstallOpen, setBackupInstallOpen] = useState(false);
  const [backupReviewOpen, setBackupReviewOpen] = useState(false);
  const [backupMissingSources, setBackupMissingSources] = useState([]);
  const [backupUnavailableSources, setBackupUnavailableSources] = useState([]);
  const [backupInstallManifests, setBackupInstallManifests] = useState([]);
  const [backupProgress, setBackupProgress] = useState(null);
  const [tutorialImportApplying, setTutorialImportApplying] = useState(false);
  const [mihonCandidate, setMihonCandidate] = useState(null);
  const [mihonInstallManifests, setMihonInstallManifests] = useState([]);
  const [mihonInstallCounts, setMihonInstallCounts] = useState(new Map());
  const [mihonBlockedEntries, setMihonBlockedEntries] = useState([]);
  const [mihonUnavailableSources, setMihonUnavailableSources] = useState([]);
  const [mihonReviewOpen, setMihonReviewOpen] = useState(false);
  const [mihonInstallOpen, setMihonInstallOpen] = useState(false);
  const [mihonBusy, setMihonBusy] = useState(false);
  const [mihonProgress, setMihonProgress] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [confirmWebDataReset, setConfirmWebDataReset] = useState(false);
  const [webDataResetBusy, setWebDataResetBusy] = useState(false);
  const backupFileInputRef = useRef(null);
  const activeImportRef = useRef(false);
  const backupExportToastRef = useRef(null);
  const mihonFileInputRef = useRef(null);
  const mihonImportControllerRef = useRef(null);
  const removeRepoRef = useRef(null);
  const sectionNavRef = useRef(null);
  const sectionScrollTimerRef = useRef(null);
  const scale = useScale();
  const reduceMotion = useReducedMotion();
  const isBrowserApp = typeof window !== 'undefined' && !window.cytlex;
  const tutorialImportRunning = Boolean(tutorialImportControls && (backupBusy || mihonBusy));

  useLayoutEffect(() => {
    onTutorialImportBusyChange?.(tutorialImportRunning);
    onTutorialImportProgressChange?.(tutorialImportControls && tutorialImportApplying
      ? backupProgress || mihonProgress
      : null);
  }, [backupProgress, mihonProgress, onTutorialImportBusyChange, onTutorialImportProgressChange, tutorialImportApplying, tutorialImportControls, tutorialImportRunning]);
  useEffect(() => () => {
    onTutorialImportBusyChange?.(false);
    onTutorialImportProgressChange?.(null);
  }, [onTutorialImportBusyChange, onTutorialImportProgressChange]);

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

  const revealSectionTab = (activeTab) => {
    const nav = sectionNavRef.current;
    if (!nav || !activeTab) return;

    const navBounds = nav.getBoundingClientRect();
    const tabBounds = activeTab.getBoundingClientRect();
    const safeInset = Number.parseFloat(px(16, scale, 12));
    const leftEdge = navBounds.left + safeInset;
    const rightEdge = navBounds.right - safeInset;
    const scrollOptions = { behavior: reduceMotion ? 'auto' : 'smooth' };

    if (tabBounds.left < leftEdge) {
      nav.scrollBy({ ...scrollOptions, left: tabBounds.left - leftEdge });
    } else if (tabBounds.right > rightEdge) {
      nav.scrollBy({ ...scrollOptions, left: tabBounds.right - rightEdge });
    }
  };

  useEffect(() => {
    revealSectionTab(sectionNavRef.current?.querySelector('[aria-current="page"]'));
  }, [section, reduceMotion, scale]);

  useEffect(() => attachHorizontalScrollFade(sectionNavRef.current), []);

  const resetWebData = async () => {
    setWebDataResetBusy(true);
    try {
      await Promise.all([clearPersistentLibraryCoverCache(), clearSourceCache(), clearRecentChapters()]);
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

  useEffect(() => settings.subscribe(setS), []);
  useEffect(() => () => {
    cancelAnimationFrame(languageLayoutFrameRef.current);
    clearTimeout(languageLayoutTimerRef.current);
  }, []);
  useEffect(() => () => {
    if (tutorialPreview) sessionSeccion = '';
  }, [tutorialPreview]);
  useEffect(() => {
    if (tutorialImportControls) return;
    const params = new URLSearchParams(location.search);
    const nextSection = params.get('tutorial') === '1' ? params.get('section') : null;
    if (!VISIBLE_SECTIONS.some(({ id }) => id === nextSection)) return;
    setSection(nextSection);
    sessionSeccion = nextSection;
  }, [location.search, tutorialImportControls]);
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
  const changeLanguage = (nextLanguage) => {
    clearTimeout(languageLayoutTimerRef.current);
    cancelAnimationFrame(languageLayoutFrameRef.current);
    if (nextLanguage === language) {
      set({ language: nextLanguage });
      return;
    }
    flushSync(() => setLanguageLayoutMotion(true));
    languageLayoutFrameRef.current = requestAnimationFrame(() => {
      set({ language: nextLanguage });
      languageLayoutTimerRef.current = setTimeout(() => setLanguageLayoutMotion(false), 320);
    });
  };
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
      title: t('Categoría "{name}" eliminada', { name: pendingCat.name }),
      description: t(pendingCat.inside.length === 1
        ? '{count} manga eliminado de la biblioteca'
        : '{count} mangas eliminados de la biblioteca', { count: pendingCat.inside.length }),
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
      setBackupProgress(null);
    }
  };

  const finishBackupImport = async (blockedSources = backupUnavailableSources, requiredManifests = backupInstallManifests) => {
    if (!backupCandidate) return;
    if (blockedSources.some((source) => source.blockedByAge)) return;
    if (activeImportRef.current) return;
    const uninstalled = requiredManifests.filter((manifest) => !extensions.isInstalled(manifest.id));
    if (uninstalled.length) {
      throw new Error(`Instala estas extensiones antes de restaurar: ${uninstalled.map(({ name, id }) => name || id).join(', ')}.`);
    }
    activeImportRef.current = true;
    setTutorialImportApplying(true);
    setBackupBusy(true);
    let releaseCoverProtection = () => {};
    try {
      setBackupProgress({ label: 'Preparando la restauración' });
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      let data = backupCandidate.data;
      let favorites = [];
      try {
        const value = JSON.parse(data['cytlex:favs'] || '[]');
        if (Array.isArray(value)) favorites = value;
      } catch {}
      const coversToPersist = new Set(favorites.map((manga) => manga?.cover).filter(needsPersistentImportedCover));
      releaseCoverProtection = protectLibraryCovers([...coversToPersist]);
      if (coversToPersist.size) {
        setBackupProgress({ label: 'Preparando las portadas', current: 0, total: coversToPersist.size });
      }
      const { failedUrls: initiallyFailedCoverUrls, persistedUrls: proxiedCovers } = await preloadImportedCovers(favorites, setBackupProgress);
      if (proxiedCovers.size) {
        data = {
          ...data,
          'cytlex:favs': JSON.stringify(favorites.map((manga) => proxiedCovers.has(manga?.cover)
            ? { ...manga, coverLocal: '', coverCached: '' }
            : manga))
        };
      }
      setBackupProgress({ label: 'Guardando tu biblioteca' });
      try {
        const importedSettings = JSON.parse(data['cytlex:settings:v1'] || '{}');
        const currentSettings = settings.get();
        data = {
          ...data,
          'cytlex:settings:v1': JSON.stringify({
            ...importedSettings,
            showAdultExtensions: currentSettings.showAdultExtensions,
            adultContentRatings: currentSettings.adultContentRatings
          })
        };
      } catch {}
      restoreBackup(data);
      settings.reload();
      progress.reload();
      chapterIndex.reload();
      tracking.reload();
      clearLibraryUnreadCache();
      setBackupProgress({ label: 'Recuperando detalles de las fuentes', current: 0, total: favorites.length });
      const detailResults = favorites.length
        ? await cacheImportedLibraryDetails(favorites, setBackupProgress, proxiedCovers)
        : { failed: 0, coverFailedUrls: new Set() };
      const currentFavoriteCovers = new Set(lib.favs().map((manga) => manga?.cover).filter(Boolean));
      const coverFailedUrls = new Set([...initiallyFailedCoverUrls].filter((url) => currentFavoriteCovers.has(url)));
      detailResults.coverFailedUrls.forEach((url) => coverFailedUrls.add(url));
      const coverFailures = coverFailedUrls.size;
      setBackupCandidate(null);
      setBackupInstallOpen(false);
      setBackupReviewOpen(false);
      setBackupMissingSources([]);
      setBackupUnavailableSources([]);
      setBackupInstallManifests([]);
      setBackupProgress(null);
      setCats(lib.cats());
      window.dispatchEvent(new Event('cytlex:library-updated'));
      toast({
        title: 'Respaldo restaurado',
        description: `${t('Los datos se aplicaron correctamente')}${coverFailures ? `; ${t('{count} portadas no pudieron guardarse', { count: coverFailures })}` : ''}${detailResults.failed ? `; ${t('No se pudo guardar la información de {count} mangas', { count: detailResults.failed })}` : ''}.`,
        variant: 'success'
      });
    } catch (error) {
      toast({ title: 'No se pudo restaurar el respaldo', description: error.message, variant: 'error' });
    } finally {
      releaseCoverProtection();
      activeImportRef.current = false;
      setTutorialImportApplying(false);
      setBackupBusy(false);
      setBackupProgress(null);
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
        await finishBackupImport([], []);
        return;
      }

      const indexUrl = settings.get().extIndexUrl?.trim() || DEFAULT_EXTENSION_REPOSITORY;
      let repository = [];
      if ([...sources.values()].some((source) => !extensions.isInstalled(source.resolvedId))) {
        try { repository = await extensions.repoIndex(indexUrl); } catch {}
      }
      const manifests = new Map();
      const showAdultExtensions = settings.get().showAdultExtensions;
      const missing = [...sources.values()].filter((source) => !extensions.isInstalled(source.resolvedId)).map((source) => {
        const manifest = extensionForSource(repository, source.id) || extensionForSource(repository, source.resolvedId);
        const fallback = manifest || extensions.manifest(source.resolvedId) || extensions.manifest(source.id);
        const installable = canInstallExtension(fallback) && isExtensionAllowed(fallback, showAdultExtensions);
        if (installable) manifests.set(fallback.id, fallback);
        return { ...source, manifest: installable ? fallback : null, cytlexManifest: fallback?.id ? fallback : null };
      });
      setBackupMissingSources(missing);
      const unavailableSources = [...sources.values()].map((source) => {
        const repositoryManifest = extensionForSource(repository, source.id)
          || extensionForSource(repository, source.resolvedId);
        const installedManifest = extensions.isInstalled(source.resolvedId)
          ? extensions.manifest(source.resolvedId)
          : null;
        const cytlexManifest = repositoryManifest || installedManifest || null;
        return {
          ...source,
          cytlexManifest,
          blockedByAge: !!cytlexManifest && !isExtensionAllowed(cytlexManifest, showAdultExtensions)
        };
      });
      const reviewSources = unavailableSources.filter((source) =>
        source.blockedByAge || !source.cytlexManifest || !canInstallExtension(source.cytlexManifest)
      );
      setBackupUnavailableSources(reviewSources);
      setBackupInstallManifests([...manifests.values()]);
      if (reviewSources.length) setBackupReviewOpen(true);
      else if (manifests.size) setBackupInstallOpen(true);
      else await finishBackupImport(reviewSources, [...manifests.values()]);
    } catch (error) {
      toast({ title: 'No se pudieron comprobar las extensiones', description: error.message, variant: 'error' });
    } finally {
      setBackupBusy(false);
      setBackupProgress(null);
    }
  };

  const cancelBackupInstall = () => {
    if (adultImportTargetRef.current === 'backup') adultImportTargetRef.current = null;
    setBackupInstallOpen(false);
    setBackupReviewOpen(false);
    setBackupCandidate(null);
    setBackupProgress(null);
    setBackupMissingSources([]);
    setBackupUnavailableSources([]);
    setBackupInstallManifests([]);
  };

  const cancelMihonImportReview = () => {
    if (adultImportTargetRef.current === 'mihon') adultImportTargetRef.current = null;
    setMihonReviewOpen(false);
    setMihonCandidate(null);
    setMihonBlockedEntries([]);
    setMihonUnavailableSources([]);
  };

  const enableAdultExtensionsForImport = () => {
    const target = adultImportTargetRef.current;
    if (!target) {
      set({ showAdultExtensions: true });
      setConfirmAdultExtensions(false);
      setAdultRatingsDraft([...settings.get().adultContentRatings]);
      setAdultRatingsDialog(true);
      return;
    }

    const sources = target === 'backup' ? backupUnavailableSources : mihonUnavailableSources;
    const ratings = sources
      .filter((source) => source.blockedByAge)
      .map((source) => String(source.cytlexManifest?.contentWarning || '').toUpperCase())
      .filter(Boolean);
    set({
      showAdultExtensions: true,
      adultContentRatings: [...new Set([...settings.get().adultContentRatings, ...ratings])]
    });
    adultImportTargetRef.current = null;
    if (target === 'backup') setBackupReviewOpen(false);
    else setMihonReviewOpen(false);
    setConfirmAdultExtensions(false);
    if (target === 'backup') void confirmBackupImport();
    else void confirmMihonImport();
  };

  const cancelAdultExtensionConfirmation = () => {
    adultImportTargetRef.current = null;
    setConfirmAdultExtensions(false);
  };

  const continueBackupImport = async () => {
    setBackupReviewOpen(false);
    setBackupInstallOpen(true);
  };

  const continueBackupWithoutUnavailableSources = () => {
    if (backupCandidate) {
      const sourceIds = new Set(backupUnavailableSources
        .filter((source) => !source.blockedByAge)
        .flatMap((source) => [source.id, source.resolvedId])
        .filter(Boolean));
      let favorites = [];
      try {
        const value = JSON.parse(backupCandidate.data['cytlex:favs'] || '[]');
        if (Array.isArray(value)) favorites = value;
      } catch {}
      setBackupCandidate({
        ...backupCandidate,
        data: {
          ...backupCandidate.data,
          'cytlex:favs': JSON.stringify(favorites.filter((manga) => !sourceIds.has(manga?.sourceId || 'leercapitulo')))
        }
      });
    }
    setBackupReviewOpen(false);
    setBackupInstallOpen(true);
  };

  const installBackupExtensions = async () => {
    if (!backupCandidate) return;
    const allowedManifests = backupInstallManifests.filter((manifest) =>
      isExtensionAllowed(manifest, settings.get().showAdultExtensions)
    );
    setBackupBusy(true);
    setBackupProgress({ label: 'Preparando las fuentes', current: 0, total: allowedManifests.length });
    try {
      const indexUrl = settings.get().extIndexUrl?.trim() || DEFAULT_EXTENSION_REPOSITORY;
      let current = 0;
      const results = await Promise.allSettled(allowedManifests.map(async (manifest) => {
        try {
          if (!extensions.isInstalled(manifest.id)) await extensions.install(manifest, indexUrl, { backfillLibrary: false });
        } finally {
          current += 1;
          setBackupProgress({ label: 'Preparando las fuentes', current, total: allowedManifests.length, currentLabel: manifest.name || manifest.id });
        }
      }));
      const failed = results.flatMap((result, index) => result.status === 'rejected'
        ? [allowedManifests[index].name || allowedManifests[index].id]
        : []);
      if (failed.length) throw new Error(`No se pudieron instalar: ${failed.join(', ')}.`);
      await finishBackupImport();
    } catch (error) {
      toast({ title: 'No se pudieron instalar las extensiones', description: `${error.message} No se restauró el respaldo.`, variant: 'error' });
    } finally {
      setBackupBusy(false);
      setBackupProgress(null);
    }
  };

  const loadMihonBackup = async (bytes, fileName) => {
    try {
      const installedSources = extensions.sources();
      let repository = [];
      let candidate = await previewMihonBackup(bytes, installedSources);
      const indexUrl = settings.get().extIndexUrl?.trim() || DEFAULT_EXTENSION_REPOSITORY;
      if (candidate.unmatchedCount) {
        try {
          repository = (await extensions.repoIndex(indexUrl)).filter(canInstallExtension);
          candidate = await previewMihonBackup(bytes, installedSources, repository);
        } catch {
          toast({
            title: 'No se pudieron comprobar las extensiones',
            description: 'Vuelve a intentar la importación cuando el repositorio esté disponible.',
            variant: 'error'
          });
          return;
        }
      }
      const uninstalledExtensionIds = new Set(candidate.entries
        .filter(({ manga }) => !extensions.isInstalled(manga.sourceId))
        .map(({ manga, legacySourceId }) => manga.sourceId?.startsWith('mihon-') ? legacySourceId || manga.sourceId : manga.sourceId));
      setMihonCandidate({ ...candidate, fileName, repository, indexUrl, uninstalledExtensionCount: uninstalledExtensionIds.size });
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

  const finishMihonImport = async (failedInstalls = [], blockedEntries = mihonBlockedEntries, sourceCandidate = mihonCandidate) => {
    if (!sourceCandidate) return;
    if (blockedEntries.length) return;
    if (activeImportRef.current) return;
    activeImportRef.current = true;
    setTutorialImportApplying(true);
    setMihonBusy(true);
    let releaseCoverProtection = () => {};
    let releaseFinalCoverProtection = () => {};
    try {
      const failedSourceIds = new Set(failedInstalls.map(({ id }) => id));
      const omitted = new Set([
        ...sourceCandidate.entries.filter(({ manga, legacySourceId }) =>
          failedSourceIds.has(manga.sourceId) || failedSourceIds.has(legacySourceId)
        )
      ]);
      const candidate = {
        ...sourceCandidate,
        entries: sourceCandidate.entries.filter((entry) => !omitted.has(entry))
          .map((entry) => ({ ...entry, manga: { ...entry.manga } }))
      };
      const mangas = candidate.entries.map(({ manga }) => manga);
      const incomingWorkKeys = new Set(mangas.map(mihonWorkKey).filter(Boolean));
      const existingMangas = lib.favs().filter((manga) => {
        const key = mihonWorkKey(manga);
        return key && incomingWorkKeys.has(key);
      });
      const coversToRefresh = [...mangas, ...existingMangas];
      releaseCoverProtection = protectLibraryCovers(coversToRefresh.map((manga) => manga?.cover));
      setMihonProgress({ label: 'Aplicando los mangas, categorías y progreso' });
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const result = importMihonBackup(candidate);
      clearLibraryUnreadCache();
      const importedFavorites = result.importedFavorites;
      const backupCovers = new Map(importedFavorites.map((manga) => {
        const favorite = lib.fav(manga.url, manga.sourceId || 'leercapitulo');
        return [`${manga.sourceId || 'leercapitulo'}|${manga.url}`, favorite?.cover || ''];
      }));
      setMihonProgress({ label: 'Recuperando detalles de las fuentes', current: 0, total: importedFavorites.length });
      const { results: refreshedDetails, attempted } = await refreshImportedMihonDetails(importedFavorites, setMihonProgress);
      const detailFailures = attempted.length - refreshedDetails.filter(({ detail }) => detail?.chapters?.length).length;
      const refreshedFavoriteKeys = new Set();
      for (const { manga, sourceId, detail, detailUrl } of refreshedDetails) {
        const savedSourceId = manga.sourceId || sourceId;
        const favorite = lib.fav(manga.url, savedSourceId);
        if (!favorite) continue;
        if (detailUrl !== favorite.url) {
          lib.updateFav(favorite.url, { url: detailUrl }, savedSourceId);
          tracking.move(favorite.url, detailUrl, savedSourceId);
          chapterOrder.move(favorite.url, detailUrl);
          chapterIndex.drop(favorite.url, savedSourceId);
          manga.url = detailUrl;
          favorite.url = detailUrl;
        }
        const detailCoverValid = /^https?:\/\//i.test(detail.cover || '') && isMangaCover(detail.cover, favorite.url);
        lib.updateFav(favorite.url, {
          coverRefreshPending: false,
          ...(detailCoverValid && detail.cover !== favorite.cover ? { cover: detail.cover } : {})
        }, savedSourceId);
        refreshedFavoriteKeys.add(`${savedSourceId}|${favorite.url}`);
        if (detail.chapters?.length) {
          await api.persistLibraryDetail(favorite.url, sourceId, detail, savedSourceId);
        }
      }
      for (const manga of attempted) {
        const savedSourceId = manga.sourceId || 'leercapitulo';
        const favorite = lib.fav(manga.url, savedSourceId);
        const key = `${savedSourceId}|${favorite?.url || manga.url}`;
        if (favorite && !refreshedFavoriteKeys.has(key)) {
          lib.updateFav(favorite.url, { coverRefreshPending: false }, savedSourceId);
        }
      }
      const finalFavorites = importedFavorites.map((manga) => lib.fav(manga.url, manga.sourceId || 'leercapitulo')).filter(Boolean);
      const finalCoverUrls = finalFavorites.map((manga) => manga?.cover);
      releaseFinalCoverProtection = protectLibraryCovers(finalCoverUrls);
      const coverFavorites = finalFavorites.filter((manga) => {
        const manifest = extensions.manifest(importedSourceId(manga));
        return (isUnresolvedMihonSource(manga.sourceId) && !manifest?.contentWarning)
          || isExtensionAllowed(manifest, settings.get().showAdultExtensions);
      });
      const totalCovers = new Set(coverFavorites.map((manga) => manga.cover).filter(needsPersistentImportedCover)).size;
      setMihonProgress({ label: 'Guardando las portadas', current: 0, total: totalCovers });
      const { failedUrls: initialCoverFailures, persistedUrls: initiallyPersistedUrls } = await preloadImportedCovers(coverFavorites, setMihonProgress);
      const fallbackFavorites = [];
      for (const manga of coverFavorites) {
        if (!initialCoverFailures.has(manga.cover)) continue;
        const backupCover = backupCovers.get(`${manga.sourceId || 'leercapitulo'}|${manga.url}`);
        if (!backupCover || backupCover === manga.cover || !isMangaCover(backupCover, manga.url)) continue;
        lib.updateFav(manga.url, { cover: backupCover }, manga.sourceId || 'leercapitulo');
        fallbackFavorites.push(lib.fav(manga.url, manga.sourceId || 'leercapitulo'));
      }
      const fallbackResult = fallbackFavorites.length
        ? await preloadImportedCovers(fallbackFavorites, setMihonProgress)
        : { failedUrls: new Set(), persistedUrls: new Set() };
      const persistedUrls = new Set([...initiallyPersistedUrls, ...fallbackResult.persistedUrls]);
      const finalCoverUrlSet = new Set(coverFavorites.map((manga) => lib.fav(manga.url, manga.sourceId || 'leercapitulo')?.cover).filter(needsPersistentImportedCover));
      const coverFailures = [...finalCoverUrlSet].filter((cover) => !persistedUrls.has(cover)).length;
      for (const manga of finalFavorites) {
        if (persistedUrls.has(manga.cover) && (manga.coverLocal || manga.coverCached)) {
          lib.updateFav(manga.url, { coverLocal: '', coverCached: '' }, manga.sourceId || 'leercapitulo');
        }
      }
      window.dispatchEvent(new Event('cytlex:library-updated'));
      setMihonCandidate(null);
      setMihonInstallManifests([]);
      setMihonInstallCounts(new Map());
      setMihonBlockedEntries([]);
      setMihonUnavailableSources([]);
      setMihonReviewOpen(false);
      setMihonInstallOpen(false);
      setCats(lib.cats());
      toast({
        title: 'Respaldo de Mihon importado',
        description: `${t('{count} mangas importados', { count: result.added + result.updated })}${omitted.size ? `, ${t('{count} omitidos', { count: omitted.size })}` : ''}.${detailFailures ? ` ${t('No se pudo guardar la información de {count} mangas', { count: detailFailures })}.` : ''}${coverFailures ? ` ${t('{count} portadas no pudieron guardarse', { count: coverFailures })}.` : ''}${failedInstalls.length ? ` ${t('No se pudieron instalar: {names}', { names: failedInstalls.map(({ name }) => name).join(', ') })}.` : ''}`,
        variant: 'success'
      });
    } catch (error) {
      toast({ title: 'No se pudo importar el respaldo de Mihon', description: error.message, variant: 'error' });
    } finally {
      releaseCoverProtection();
      releaseFinalCoverProtection();
      activeImportRef.current = false;
      setTutorialImportApplying(false);
      setMihonProgress(null);
      setMihonBusy(false);
    }
  };

  const confirmMihonImport = async () => {
    if (!mihonCandidate) return;
    setMihonBusy(true);
    try {
      const showAdultExtensions = !!settings.get().showAdultExtensions;
      const manifests = new Map();
      const installCounts = new Map();
      const blockedEntries = [];
      const unknownEntries = [];
      const unavailableSources = new Map();
      for (const entry of mihonCandidate.entries) {
        const sourceId = entry.manga.sourceId;
        const installed = extensions.isInstalled(sourceId);
        const manifest = installed
          ? extensions.manifest(sourceId)
          : extensionForSource(mihonCandidate.repository, sourceId);
        const blockedByAge = !!manifest && !isExtensionAllowed(manifest, showAdultExtensions);
        const unavailable = !manifest || !canInstallExtension(manifest) && !installed;
        if (blockedByAge) blockedEntries.push(entry);
        else if (unavailable) unknownEntries.push(entry);
        else if (!installed) {
          manifests.set(manifest.id, manifest);
          installCounts.set(manifest.id, (installCounts.get(manifest.id) || 0) + 1);
        }

        if (blockedByAge || unavailable) {
          const groupKey = `${sourceId}|${blockedByAge ? 'blocked' : 'unavailable'}`;
          const source = unavailableSources.get(groupKey) || {
            id: groupKey,
            sourceId,
            name: manifest?.name || entry.manga.sourceName || sourceId,
            count: 0,
            blockedByAge,
            cytlexManifest: blockedByAge ? manifest : null
          };
          source.count += 1;
          unavailableSources.set(groupKey, source);
        }
      }
      setMihonInstallManifests([...manifests.values()]);
      setMihonInstallCounts(installCounts);
      setMihonBlockedEntries(blockedEntries);
      setMihonUnavailableSources([...unavailableSources.values()]);
      if (blockedEntries.length || unknownEntries.length) {
        setMihonReviewOpen(true);
      } else if (manifests.size) {
        setMihonInstallOpen(true);
      } else {
        await finishMihonImport([], blockedEntries);
      }
    } catch (error) {
      toast({ title: 'No se pudieron comprobar las extensiones', description: error.message, variant: 'error' });
    } finally {
      setMihonBusy(false);
    }
  };

  const continueMihonImport = (omitUnavailableSources = false) => {
    const sourceIds = new Set(mihonUnavailableSources
      .filter((source) => !source.blockedByAge)
      .map((source) => source.sourceId)
      .filter(Boolean));
    const candidate = omitUnavailableSources && mihonCandidate
      ? { ...mihonCandidate, entries: mihonCandidate.entries.filter(({ manga }) => !sourceIds.has(manga.sourceId)) }
      : mihonCandidate;
    if (omitUnavailableSources && candidate) setMihonCandidate(candidate);
    setMihonReviewOpen(false);
    if (mihonInstallManifests.length) {
      setMihonInstallOpen(true);
      return;
    }
    void finishMihonImport([], mihonBlockedEntries, candidate);
  };

  const cancelMihonInstallation = () => {
    const controller = mihonImportControllerRef.current;
    if (!controller) return;
    controller.abort();
    setMihonProgress((progress) => ({ ...progress, label: 'Cancelando instalación' }));
  };

  const installMihonSources = async () => {
    if (!mihonInstallManifests.length) return;
    const controller = new AbortController();
    mihonImportControllerRef.current = controller;
    setMihonProgress({ label: 'Instalando extensiones', current: 0, total: mihonInstallManifests.length });
    setMihonBusy(true);
    try {
      const indexUrl = mihonCandidate.indexUrl;
      let current = 0;
      const results = await Promise.all(mihonInstallManifests.map(async (manifest) => {
        try {
          if (controller.signal.aborted || extensions.isInstalled(manifest.id)) return { id: manifest.id, installed: false };
          await extensions.install(manifest, indexUrl, { backfillLibrary: false });
          return { id: manifest.id, name: manifest.name || manifest.id, installed: true };
        } catch {
          return { id: manifest.id, name: manifest.name || manifest.id, error: true };
        } finally {
          current += 1;
          setMihonProgress({
            label: controller.signal.aborted ? 'Cancelando instalación' : 'Instalando extensiones',
            current,
            total: mihonInstallManifests.length,
            currentLabel: manifest.name || manifest.id
          });
        }
      }));
      const installedIds = results.filter(({ installed }) => installed).map(({ id }) => id);
      if (controller.signal.aborted) {
        await Promise.all(installedIds.map((id) => extensions.uninstall(id)));
      }
      throwIfAborted(controller.signal);
      const failedInstalls = results.filter(({ error }) => error).map(({ id, name }) => ({ id, name }));
      mihonInstallManifests.filter(({ id }) => !extensions.isInstalled(id)).forEach((manifest) => {
        if (!failedInstalls.some(({ id }) => id === manifest.id)) {
          failedInstalls.push({ id: manifest.id, name: manifest.name || manifest.id });
        }
      });
      setMihonInstallOpen(false);
      await finishMihonImport(failedInstalls);
    } catch (error) {
      if (!controller.signal.aborted && error?.name !== 'AbortError') {
        toast({ title: 'No se pudieron instalar las extensiones', description: `${error.message} No se importaron los mangas.`, variant: 'error' });
      }
    } finally {
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
          title={t('Idioma')}
          desc={t('Selecciona el idioma de la interfaz de Cytlex.')}
          right={
            <LanguageToggle value={language} onChange={changeLanguage} />
          }
        />
        <Row
          scale={scale}
          title={t('Modo')}
          desc={language === 'en' ? 'Choose the app color scheme.' : 'Cambia los colores que se ven en la aplicación'}
          right={
            <ModeToggle
              value={s.mode}
              onChange={(m) => set({ mode: m })}
              options={MODES.map(({ id, name }) => [id, t(name)])}
            />
          }
        />
        <Row
          scale={scale}
          title={t('Tamaño de portadas')}
          desc={t('Muestra las portadas en Biblioteca, Explorar, Fuentes y fichas de manga')}
          right={
            <div className="flex items-center" style={{ gap: px(6, scale, 4) }}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('Reducir tamaño de portadas')}
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
                aria-label={t('Aumentar tamaño de portadas')}
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
            {t('Tema')}
          </h3>
          <div className="grid grid-cols-2 min-[440px]:grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {THEMES.map((theme) => {
              const on = s.theme === theme.id;
              const sw = theme.swatch[resolveMode(s.mode)] || theme.swatch.dark;
              return (
                <motion.button
                  key={theme.id}
                  type="button"
                  aria-pressed={on}
                  layout={languageLayoutMotion && !reduceMotion ? 'size' : false}
                  transition={{ layout: { duration: reduceMotion ? 0 : 0.24, ease: [0.23, 1, 0.32, 1] } }}
                  onClick={() => setAppearance({ theme: theme.id })}
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
                    {t(theme.name)}
                  </div>
                  <div className="text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }}>
                    {t(theme.desc)}
                  </div>
                </motion.button>
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
              {t('Capítulos por fila')}{' '}
              <button
                ref={chaptersPerRowTipRef}
                type="button"
                className="group relative inline-flex align-middle rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('Información sobre capítulos por fila')}
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
                  {t('Pro Tip: En celulares se fuerza a un solo capítulo por fila para evitar el desbordamiento de la información.')}
                </span>
              </button>
            </>
          }
          desc={t('Cantidad de capítulos por fila en la ficha de un manga')}
          right={
            <>
              <span className="rounded-lg border border-border bg-muted px-3 py-2 text-sm md:hidden">{t('1 por fila')}</span>
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
              {t('Mostrar capítulos sin leer')}{' '}
              <button
                ref={libraryUnreadTipRef}
                type="button"
                className="group relative inline-flex align-middle rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('Información sobre capítulos sin leer')}
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
                  {t('Pro Tip: Desactivar esta opción podría mejorar el rendimiento en dispositivos de gama baja-media. Desactivala si ves que el desplazamiento en la biblioteca es muy lento.')}
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
      <div className="w-full">
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
                  aria-label={t(`Nombre de la categoría ${c.name}`)}
                  style={{
                    height: px(36, scale, 30),
                    fontSize: fontPx(14, scale, 12),
                    paddingLeft: px(10, scale, 7),
                    paddingRight: px(10, scale, 7)
                  }}
                />
                <span
                  className="category-count shrink-0 bg-muted text-center tabular-nums text-muted-foreground"
                  style={{
                    minWidth: px(30, scale, 24),
                    padding: `${px(4, scale, 3)} ${px(7, scale, 5)}`,
                    fontSize: fontPx(12, scale, 10)
                  }}
                  title={t(`${counts.get(c.id) || 0} mangas en esta categoría`)}
                >
                  {counts.get(c.id) || 0}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  title={t(`Eliminar categoría ${c.name}`)}
                  aria-label={t(`Eliminar categoría ${c.name}`)}
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
            {t('No hay categorías. Crea la primera para organizar tu biblioteca.')}
          </p>
        )}

        <div
          className="flex items-center"
          style={{ gap: px(8, scale, 6), marginTop: px(12, scale, 10) }}
        >
          <Input
            placeholder={t('Nueva categoría…')}
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCat()}
            className="rounded-none"
            aria-label={t('Nueva categoría')}
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
            {t('Añadir')}
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
                  title={t('Configurar calificaciones de contenido')}
                  aria-label={t('Configurar calificaciones de contenido')}
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
            {t('Repositorio de extensiones')}
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
            aria-label={t('Repositorio de extensiones')}
            style={{
              height: px(34, scale, 28),
              fontSize: fontPx(13, scale, 11),
              paddingLeft: px(12, scale, 9),
              paddingRight: px(12, scale, 9)
            }}
          />
          <Button
            size="icon"
            title={t('Añadir repositorio')}
            aria-label={t('Añadir repositorio')}
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
                title={t('Quitar repositorio')}
                aria-label={t('Quitar repositorio')}
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
                      {t('Quitar')}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
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
                {t('Desconectar')}
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
                {t('Conectar')}
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
                  {t('Refrescar caché')}
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
                  {t('Ver mi lista')}
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
  } else if (section === 'cuenta') {
    content = <CloudSyncPanel />;
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
            setBackupBusy(true);
            try {
              loadBackupContent(await readBackupFile(file), file.name);
            } catch (error) {
              toast({ title: 'No se pudo leer el respaldo', description: error.message, variant: 'error' });
            } finally {
              setBackupBusy(false);
              setBackupProgress(null);
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
        {backupBusy && !backupCandidate && backupProgress && <BackupProgress progress={backupProgress} scale={scale} />}
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
              {t('Exportar')}
            </Button>
          }
        />
        <Row
          scale={scale}
          title="Importar respaldo"
          desc="Restaura tus datos desde un respaldo creado en Cytlex"
          right={
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void importBackup()}
                disabled={backupBusy}
                style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
              >
                <Upload className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                {t('Importar')}
              </Button>
            </div>
          }
        />
        <Row
          scale={scale}
          last={!isBrowserApp}
          title="Importar desde Mihon"
          desc="Fusiona mangas, categorías y progreso de lectura sin reemplazar tus datos de Cytlex"
          right={
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void importMihon()}
                disabled={backupBusy || mihonBusy}
                style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(12, scale, 9), paddingRight: px(12, scale, 9) }}
              >
                <Upload className="mr-2" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />
                {t('Importar Mihon')}
              </Button>
            </div>
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
                {t('Restablecer')}
              </Button>
            }
          />
        )}
      </div>
    );
  }

  const backupInstallRowsById = new Map();
  const backupHasBlockedSources = backupUnavailableSources.some((source) => source.blockedByAge);
  const mihonHasBlockedSources = mihonUnavailableSources.some((source) => source.blockedByAge);
  backupMissingSources.filter((source) => source.manifest).forEach((source) => {
    const installedId = extensions.resolveInstalledSource(source.resolvedId || source.id, source.name)
      || source.resolvedId || source.id;
    const current = backupInstallRowsById.get(installedId);
    if (current) {
      current.count += source.count;
      return;
    }
    const installed = extensions.isInstalled(installedId);
    const profile = source.manifest.config?.sources?.find((item) => item.id === installedId || item.id === source.id);
    const displayManifest = profile
      ? {
        ...source.manifest,
        ...profile,
        name: source.manifest.id === 'mangadex'
          ? profile.id === 'mangadex-en' ? 'MangaDex · Inglés' : 'MangaDex · Español'
          : profile.name,
        icon: profile.icon || source.manifest.icon
      }
      : installed ? extensions.manifest(installedId) : source.manifest;
    backupInstallRowsById.set(installedId, {
      ...source,
      displayManifest,
      installed
    });
  });
  let backupMangas = [];
  try {
    const value = JSON.parse(backupCandidate?.data?.['cytlex:favs'] || '[]');
    if (Array.isArray(value)) backupMangas = value;
  } catch {}
  let backupCategoryCount = 0;
  try {
    const value = JSON.parse(backupCandidate?.data?.['cytlex:cats:v1'] || '[]');
    if (Array.isArray(value)) backupCategoryCount = value.length;
  } catch {}
  const installedBackupSources = new Map();
  const uninstalledBackupExtensionIds = new Set();
  backupMangas.forEach((manga) => {
    const sourceId = manga?.sourceId || 'leercapitulo';
    const installedId = extensions.resolveInstalledSource(sourceId, manga?.sourceName, manga?.url);
    if (!installedId) {
      uninstalledBackupExtensionIds.add(sourceId);
      return;
    }
    const manifest = extensions.manifest(installedId);
    const current = installedBackupSources.get(installedId) || {
      id: installedId,
      resolvedId: installedId,
      name: manifest?.name || manga?.sourceName || installedId,
      count: 0,
      displayManifest: manifest,
      installed: true
    };
    current.count += 1;
    installedBackupSources.set(installedId, current);
  });
  installedBackupSources.forEach((source, id) => backupInstallRowsById.set(id, source));
  const backupInstallRows = sortByName(backupInstallRowsById.values(), (source) => source.displayManifest?.name || source.name);

  if (tutorialImportControls) tutorialImportControls.current = { importBackup, importMihon };

  return (
    <LanguageLayoutMotionProvider value={languageLayoutMotion}>
      <LayoutGroup id="settings-language-layout">
        <div
          className="flex h-full min-h-0 flex-col"
        >
      <div
        className={cn(
          'relative w-full min-w-0 shrink-0 bg-sidebar',
          tutorialImportControls && 'hidden',
          !isBrowserApp && '-mt-2 max-md:-mt-3'
        )}
        style={{ marginBottom: isBrowserApp ? 0 : px(12, scale, 8) }}
      >
        <nav
          ref={sectionNavRef}
          className="flex w-full min-w-0 items-center overflow-x-auto overscroll-x-contain whitespace-nowrap no-scrollbar"
          aria-label="Secciones de ajustes"
          style={{
            gap: px(24, scale, 16),
            minHeight: px(38, scale, 34),
            paddingLeft: px(16, scale, 12),
            paddingRight: px(16, scale, 12)
          }}
        >
        {VISIBLE_SECTIONS.map((sec) => {
          const on = sec.id === section;
          return (
            <motion.button
              key={sec.id}
              type="button"
              layout={languageLayoutMotion && !reduceMotion ? 'size' : false}
              transition={{ layout: { duration: reduceMotion ? 0 : 0.24, ease: [0.23, 1, 0.32, 1] } }}
              aria-current={on ? 'page' : undefined}
              onClick={(event) => {
                if (on) {
                  const content = document.querySelector('.settings-section-scroll');
                  if (content?.scrollTop > 1) {
                    content.scrollTo({ top: 0, behavior: 'smooth' });
                    return;
                  }
                  revealSectionTab(event.currentTarget);
                  return;
                }
                setSection(sec.id);
                sessionSeccion = sec.id;
              }}
              className="group relative shrink-0 p-0 transition-colors"
              style={{ fontSize: fontPx(14, scale), scrollMarginInline: px(16, scale, 12) }}
            >
              <SubrouteTabLabel active={on}>{t(sec.label)}</SubrouteTabLabel>
            </motion.button>
          );
        })}
        </nav>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-border/70" />
      </div>
      <div
        key={section}
        className={cn('settings-section-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain', tutorialImportControls && 'hidden')}
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
            {t('Cancelar')}
          </Button>
          <Button
            variant="destructive"
            onClick={resetWebData}
            disabled={webDataResetBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {webDataResetBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />{t('Restableciendo')}</> : t('Borrar datos')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!backupCandidate && !backupInstallOpen && !backupReviewOpen
          && !(confirmAdultExtensions && adultImportTargetRef.current === 'backup')
          && !tutorialImportRunning}
        onClose={() => { if (!backupBusy) setBackupCandidate(null); }}
        title="Importar respaldo de Cytlex"
        description={t('Se restaurará {fileName} en Cytlex y reemplazará tus datos actuales. Las extensiones instaladas se mantendrán.', { fileName: backupCandidate?.fileName || 'el respaldo' })}
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <BackupProgress progress={backupProgress} scale={scale} />
        <div className="text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          <div>{backupMangas.length} {t('manga')} · {backupCategoryCount} {t('categorías')}</div>
          <div style={{ marginTop: px(6, scale, 4) }}>
            {t('{count} extensiones sin instalar.', { count: uninstalledBackupExtensionIds.size })}
          </div>
        </div>
        <div className="flex flex-col-reverse items-stretch justify-end sm:flex-row sm:items-center" style={{ gap: px(8, scale, 6) }}>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            onClick={() => setBackupCandidate(null)}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {t('Cancelar')}
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={confirmBackupImport}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {backupBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />{t('Restaurando')}</> : t('Restaurar')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={(backupReviewOpen || (confirmAdultExtensions && adultImportTargetRef.current === 'backup'))
          && !tutorialImportRunning}
        onClose={() => { if (!backupBusy) cancelBackupInstall(); }}
        title={backupHasBlockedSources ? 'No se puede importar este respaldo' : 'Fuentes sin extensión instalable'}
        description={backupHasBlockedSources
          ? 'El respaldo incluye mangas de extensiones bloqueadas por tu configuración de edad. Confirma tu mayoría de edad para seguir adelante.'
          : 'Cytlex no ofrece extensiones instalables para estas fuentes. Decide si quieres conservar esos mangas en la biblioteca.'}
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        {backupBusy && <BackupProgress progress={backupProgress} scale={scale} />}
        <div className="space-y-4 text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          {[
            backupHasBlockedSources
              ? { title: 'Extensiones bloqueadas en Cytlex', sources: sortByName(backupUnavailableSources.filter((source) => source.blockedByAge)) }
              : { title: 'Fuentes sin extensión instalable', sources: sortByName(backupUnavailableSources.filter((source) => !source.cytlexManifest || !canInstallExtension(source.cytlexManifest))) }
          ].filter((group) => group.sources.length > 0).map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 font-semibold text-foreground">{group.title}</h3>
              <div className="space-y-2">
                {group.sources.map((source) => (
                  <div key={source.id} className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-foreground" title={source.name}>{source.name}</span>
                      {['MIXED', 'NSFW'].includes(String(source.cytlexManifest?.contentWarning || '').toUpperCase()) && (
                        <span className="shrink-0 text-muted-foreground">
                          +18 {String(source.cytlexManifest.contentWarning).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0">{source.count} {t('manga')}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="flex flex-col-reverse items-stretch justify-end sm:flex-row sm:items-center" style={{ gap: px(8, scale, 6) }}>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            onClick={cancelBackupInstall}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {t('Cancelar')}
          </Button>
          {backupHasBlockedSources ? (
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                adultImportTargetRef.current = 'backup';
                setConfirmAdultExtensions(true);
              }}
              disabled={backupBusy}
              style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
            >
              {t('Habilitar +18 y continuar')}
            </Button>
          ) : (
            <>
              <Button
                className="w-full sm:w-auto"
                variant="outline"
                onClick={continueBackupWithoutUnavailableSources}
                disabled={backupBusy}
                style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
              >
                {t('Omitir mangas')}
              </Button>
              <Button
                className="w-full sm:w-auto"
                onClick={continueBackupImport}
                disabled={backupBusy}
                style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
              >
                {t('Conservar mangas')}
              </Button>
            </>
          )}
        </div>
      </Dialog>
      <Dialog
        open={backupInstallOpen && !tutorialImportRunning}
        onClose={() => { if (!backupBusy) cancelBackupInstall(); }}
        title="Mangas con extensiones disponibles"
        description="Para importar los mangas de estas fuentes, Cytlex instalará las extensiones listadas."
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        {backupBusy && <BackupProgress progress={backupProgress} scale={scale} />}
        <div className="space-y-2 text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          {backupInstallRows.map((source) => (
            <div key={source.id} className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center" style={{ gap: px(8, scale, 6) }}>
                <span
                  className="relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-secondary-foreground font-semibold"
                  style={{ width: px(28, scale, 24), height: px(28, scale, 24), fontSize: fontPx(11, scale, 9) }}
                >
                  {(source.displayManifest?.name || source.name || source.id || '?')[0].toUpperCase()}
                  {source.displayManifest?.icon && (
                    <img src={source.displayManifest.icon} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(event) => event.currentTarget.remove()} />
                  )}
                </span>
                <span className="truncate text-foreground" title={source.displayManifest?.name || source.name || source.id}>
                  {source.displayManifest?.name || source.name || source.id}
                </span>
                {source.installed && (
                    <span className="shrink-0 text-muted-foreground">· {t('INSTALADA')}</span>
                )}
              </div>
              <span className="shrink-0">{source.count} {t('manga')}</span>
            </div>
          ))}
          {!backupInstallRows.length && (
            <p>{t('No se encontraron extensiones instalables en el repositorio configurado.')}</p>
          )}
        </div>
        <div className="flex flex-col-reverse items-stretch justify-end sm:flex-row sm:items-center" style={{ gap: px(8, scale, 6) }}>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            onClick={cancelBackupInstall}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {t('Cancelar')}
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={installBackupExtensions}
            disabled={backupBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {backupBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />{t('Preparando')}</> : backupInstallManifests.length ? t('Instalar y restaurar') : t('Restaurar')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!mihonCandidate && !mihonReviewOpen && !mihonInstallOpen
          && !(confirmAdultExtensions && adultImportTargetRef.current === 'mihon')
          && !tutorialImportRunning}
        onClose={() => { if (!mihonBusy) setMihonCandidate(null); }}
        title="Importar respaldo de Mihon"
        description={t('Se fusionará {fileName} con Cytlex.', { fileName: mihonCandidate?.fileName || 'este respaldo' })}
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        {mihonBusy && mihonProgress && <BackupProgress progress={mihonProgress} scale={scale} />}
        <div className="text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          <div>{mihonCandidate?.mangaCount || 0} {t('manga')} · {mihonCandidate?.categoryNames?.length || 0} {t('categorías')}</div>
          <div style={{ marginTop: px(6, scale, 4) }}>
            {t('{count} extensiones sin instalar.', { count: mihonCandidate?.uninstalledExtensionCount || 0 })}
          </div>
        </div>
        <div className="flex flex-col-reverse items-stretch justify-end sm:flex-row sm:items-center" style={{ gap: px(8, scale, 6) }}>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            onClick={() => setMihonCandidate(null)}
            disabled={mihonBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {t('Cancelar')}
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={confirmMihonImport}
            disabled={mihonBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {mihonBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />{t('Cargando')}</> : t('Fusionar')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={(mihonReviewOpen || (confirmAdultExtensions && adultImportTargetRef.current === 'mihon'))
          && !tutorialImportRunning}
        onClose={cancelMihonImportReview}
        title={mihonHasBlockedSources ? 'No se puede importar este respaldo' : 'Fuentes sin extensión instalable'}
        description={mihonHasBlockedSources
          ? 'El respaldo incluye mangas de extensiones bloqueadas por tu configuración de edad. Confirma tu mayoría de edad para seguir adelante.'
          : 'Cytlex no ofrece extensiones instalables para estas fuentes. Decide si quieres conservar esos mangas en la biblioteca.'}
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="space-y-4 text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          {[
            mihonHasBlockedSources
              ? { title: 'Extensiones bloqueadas en Cytlex', sources: sortByName(mihonUnavailableSources.filter((source) => source.blockedByAge)) }
              : { title: 'Fuentes sin extensión instalable', sources: sortByName(mihonUnavailableSources.filter((source) => !source.cytlexManifest)) }
          ].filter((group) => group.sources.length > 0).map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 font-semibold text-foreground">{group.title}</h3>
              <div className="space-y-2">
                {group.sources.map((source) => (
                  <div key={source.id} className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-foreground" title={source.name}>{source.name}</span>
                      {['MIXED', 'NSFW'].includes(String(source.cytlexManifest?.contentWarning || '').toUpperCase()) && (
                        <span className="shrink-0 text-muted-foreground">
                          +18 {String(source.cytlexManifest.contentWarning).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0">{source.count} {t('manga')}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="flex flex-col-reverse items-stretch justify-end sm:flex-row sm:items-center" style={{ gap: px(8, scale, 6) }}>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            onClick={() => {
              setMihonReviewOpen(false);
              setMihonCandidate(null);
              setMihonBlockedEntries([]);
              setMihonUnavailableSources([]);
            }}
            disabled={mihonBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {t('Cancelar')}
          </Button>
          {mihonHasBlockedSources ? (
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                adultImportTargetRef.current = 'mihon';
                setConfirmAdultExtensions(true);
              }}
              disabled={mihonBusy}
              style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
            >
              {t('Habilitar +18 y continuar')}
            </Button>
          ) : (
            <>
              <Button
                className="w-full sm:w-auto"
                variant="outline"
                onClick={() => continueMihonImport(true)}
                disabled={mihonBusy}
                style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
              >
                {t('Omitir mangas')}
              </Button>
              <Button
                className="w-full sm:w-auto"
                onClick={() => continueMihonImport()}
                disabled={mihonBusy}
                style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
              >
                {t('Conservar mangas')}
              </Button>
            </>
          )}
        </div>
      </Dialog>
      <Dialog
        open={mihonInstallOpen && !tutorialImportRunning}
        onClose={() => {
          if (mihonBusy) cancelMihonInstallation();
          else {
            setMihonInstallOpen(false);
            setMihonCandidate(null);
          }
        }}
        title="Mangas con extensiones disponibles"
        description="Para importar los mangas de estas fuentes, Cytlex instalará las extensiones listadas."
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        {mihonBusy && mihonProgress && <BackupProgress progress={mihonProgress} scale={scale} />}
        <div className="dd-scroll max-h-[40vh] space-y-2 overflow-y-auto text-muted-foreground" style={{ fontSize: fontPx(13, scale, 11), marginBottom: px(18, scale, 14) }}>
          {sortByName(mihonInstallManifests).map((manifest) => (
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
              <span className="shrink-0">{mihonInstallCounts.get(manifest.id) || 0} {t('manga')}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col-reverse items-stretch justify-end sm:flex-row sm:items-center" style={{ gap: px(8, scale, 6) }}>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            onClick={mihonBusy ? cancelMihonInstallation : () => {
              setMihonInstallOpen(false);
              setMihonCandidate(null);
            }}
            disabled={mihonBusy && mihonProgress?.label === 'Cancelando instalación'}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {t(mihonBusy ? 'Cancelar instalación' : 'Cancelar')}
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={installMihonSources}
            disabled={mihonBusy}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {mihonBusy ? <><Loader2 className="mr-2 animate-spin" style={{ width: px(16, scale, 13), height: px(16, scale, 13) }} />{t('Instalando')}</> : t('Instalar y continuar')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmAdultExtensions}
        onClose={cancelAdultExtensionConfirmation}
        title="Confirmación de edad"
        description="¿Confirmas que tienes 18 años o más para mostrar extensiones con contenido para adultos?"
        hideDivider
        bodyClassName="pb-6"
        scrollableBody={false}
        scale={scale}
      >
        <div className="flex justify-end" style={{ gap: px(8, scale, 6) }}>
          <Button variant="outline" onClick={cancelAdultExtensionConfirmation} style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}>
            {t('Cancelar')}
          </Button>
          <Button
            onClick={enableAdultExtensionsForImport}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {t('Tengo 18 años o más')}
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
                  ({t(rating === 'SAFE'
                    ? 'sin contenido para adultos'
                    : rating === 'MIXED'
                      ? 'puede incluir contenido para adultos'
                      : 'contenido sexual explícito para adultos')})
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
            {t('Cancelar')}
          </Button>
          <Button
            onClick={() => {
              set({ adultContentRatings: adultRatingsDraft });
              setAdultRatingsDialog(false);
            }}
            style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}
          >
            {t('Guardar')}
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
            {t('Cancelar')}
          </Button>
          <Button variant="destructive" onClick={confirmRemoveCat} style={{ height: px(36, scale, 30), fontSize: fontPx(14, scale, 12), paddingLeft: px(14, scale, 11), paddingRight: px(14, scale, 11) }}>
            Eliminar
          </Button>
        </div>
      </Dialog>
        </div>
      </LayoutGroup>
    </LanguageLayoutMotionProvider>
  );
}
