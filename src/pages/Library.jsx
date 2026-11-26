import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { RefreshCw, ArrowUpDown, Search, X } from 'lucide-react';
import { isMangaCover, isUnresolvedMihonSource, lib, storedCoverThumbnail } from '../lib/library.js';
import { settings } from '../lib/settings.js';
import MangaCard from '../components/MangaCard.jsx';
import VirtualMangaGrid from '../components/VirtualMangaGrid.jsx';
import { SourceBadge } from '../components/SourceBadge.jsx';
import { extensions, isExtensionAllowed, isSourceConfigured, isUnavailableMangaSource, EXTENSION_INSTALLED_EVENT } from '../lib/extensions.js';
import { checkLibrary } from '../lib/notify.js';
import { progress } from '../lib/progress.js';
import { chapterIndex } from '../lib/chapterIndex.js';
import { tracking } from '../lib/tracking.js';
import { api } from '../lib/api.js';
import { cloudSync } from '../lib/cloudSync.js';
import { CLOUD_SYNC_DETAILS_BACKFILL_EVENT, CLOUD_SYNC_DETAILS_BACKFILL_PENDING_KEY } from '../lib/cloudSyncEvents.js';
import { preloadLibraryCoversBatch } from '../lib/covers.js';
import { setHttpGetBatchWindow } from '../lib/browserHttp.js';
import { useToast } from '../components/Toast.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { EmptyState } from '../components/ui/empty-state.jsx';
import { cn } from '../lib/utils.js';
import { useScale, px, fontPx, toolbarButtonStyle } from '../lib/useScale.js';
import SubrouteTabLabel from '../components/SubrouteTabLabel.jsx';
import { useLibraryCover } from '../lib/useLibraryCover.js';
import { useResponsiveCoverSize } from '../lib/useResponsiveCoverSize.js';
import { libraryScroll, recallCover, rememberMangaPreview } from '../lib/searchState.js';
import { attachHorizontalScrollFade } from '../lib/horizontalScrollFade.js';
import { useI18n } from '../lib/i18n.js';

let sessionCategoria = '';
let libraryCheckInFlight = false;
let libraryCheckCooldownUntil = 0;
let libraryCheckProgress = { current: 0, total: 0 };
const libraryCheckProgressListeners = new Set();
let libraryDetailBackfillPromise = null;
const pendingLibraryDetailBackfills = [];
const UNREAD_CACHE_KEY = 'cytlex:libraryUnread:v2';
const LIBRARY_CATEGORY_KEY = 'cytlex:libraryCategory';
const LIBRARY_SEARCH_OPEN_KEY = 'cytlex:librarySearchOpen:v1';
const TUTORIAL_EMPTY_FAVORITES = [];
const TUTORIAL_CATEGORIES = [{ id: 'todos', name: 'Todos' }];
const libraryScroller = () => document.querySelector('.library-page-scroll') || document.querySelector('main');
const libraryTitleCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const initialLibraryCategory = (categories) => {
  try {
    const saved = localStorage.getItem(LIBRARY_CATEGORY_KEY);
    if (saved && categories.some((category) => category.id === saved)) return saved;
  } catch {}
  return sessionCategoria && categories.some((category) => category.id === sessionCategoria)
    ? sessionCategoria
    : categories[0]?.id || '';
};
const unreadCountCache = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(UNREAD_CACHE_KEY) || '{}');
    return new Map(Object.entries(saved).filter(([, count]) => Number.isFinite(count) && count >= 0));
  } catch {
    return new Map();
  }
})();

const persistUnreadCountCache = () => {
  try { localStorage.setItem(UNREAD_CACHE_KEY, JSON.stringify(Object.fromEntries(unreadCountCache))); } catch {}
};
if (typeof window !== 'undefined') {
  window.addEventListener('cytlex:library-unread-reset', () => {
    unreadCountCache.clear();
    persistUnreadCountCache();
  });
}

const remainingLibraryCheckCooldown = () => Math.max(0, Math.ceil((libraryCheckCooldownUntil - Date.now()) / 1000));
const updateLibraryCheckProgress = (progress) => {
  libraryCheckProgress = progress;
  libraryCheckProgressListeners.forEach((listener) => listener(progress));
};
const sourceIdFor = (manga) => {
  const id = manga.sourceId || 'leercapitulo';
  const savedSourceName = String(manga.sourceName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (savedSourceName.startsWith('mangadex') && /(?:english|ingles|mangadexen)/.test(savedSourceName)) return 'mangadex-en';
  return isUnresolvedMihonSource(id)
    ? extensions.resolveInstalledSource(id, manga.sourceName, manga.url) || id
    : id;
};
const isMangaDexManga = (manga) => ['mangadex', 'mangadex-en'].includes(sourceIdFor(manga));
const mangaUrlKey = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return String(url || '').split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase() || '/';
  }
};
const sameMangaUrl = (left, right) => Boolean(left && right) && mangaUrlKey(left) === mangaUrlKey(right);
const unreadKeyFor = (manga, sourceId = sourceIdFor(manga)) => `${sourceId}|${manga.url}`;
const invalidateUnreadCountsForUrl = (mangaUrl) => {
  if (!mangaUrl) return;
  for (const key of unreadCountCache.keys()) {
    const separator = key.indexOf('|');
    if (separator >= 0 && sameMangaUrl(key.slice(separator + 1), mangaUrl)) unreadCountCache.delete(key);
  }
};
const compareLibraryTitles = (a, b) => libraryTitleCollator.compare(String(a.title || ''), String(b.title || ''));
const normalizeLibrarySearch = (value) => String(value || '').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
const truncateCategoryName = (name, limit) => {
  const characters = Array.from(String(name || '').normalize('NFC'));
  return characters.length > limit ? `${characters.slice(0, limit).join('')}..` : String(name || '');
};
const sameLibraryFavorites = (left, right) => left.length === right.length && left.every((manga, index) => {
  const next = right[index];
  if (manga === next) return true;
  return manga.url === next.url
    && manga.sourceId === next.sourceId
    && manga.title === next.title
    && manga.author === next.author
    && manga.cover === next.cover
    && manga.coverRefreshPending === next.coverRefreshPending
    && manga.coverLocal === next.coverLocal
    && manga.coverCached === next.coverCached
    && manga.sourceName === next.sourceName
    && manga.sourceIcon === next.sourceIcon
    && manga.chapterTotal === next.chapterTotal
    && manga.chapterReadCount === next.chapterReadCount
    && manga.addedAt === next.addedAt
    && (manga.cats || []).join('\0') === (next.cats || []).join('\0');
});

async function backfillLibraryDetails(favorites, showAdultExtensions, isActive, installedSourceIds = null, fetchFullDetails = false) {
  const pending = favorites.filter((manga) => {
    const resolvedId = sourceIdFor(manga);
    return extensions.isInstalled(resolvedId)
      && isExtensionAllowed(extensions.manifest(resolvedId), showAdultExtensions)
      && isSourceConfigured(extensions.manifest(resolvedId));
  });
  pending.sort((a, b) => Number(isMangaDexManga(b)) - Number(isMangaDexManga(a)));
  if (fetchFullDetails) cloudSync.setRestoreProgress({ label: 'Recuperando detalles de las fuentes', current: 0, total: pending.length });
  if (!pending.length) {
    if (fetchFullDetails) cloudSync.setRestoreProgress(null);
    return;
  }

  const restoreBatchWindow = setHttpGetBatchWindow(5000);
  let favoritesChanged = false;
  const refreshedCoverUrls = new Set();
  let completed = 0;
  try {
    let next = 0;
    const concurrency = Math.min(50, pending.length);
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (isActive() && next < pending.length) {
        const manga = pending[next++];
        const savedSourceId = manga.sourceId || 'leercapitulo';
        const resolvedId = sourceIdFor(manga);
        try {
          let detail;
          if (manga.coverRefreshPending) {
            detail = await api.restoreDetail(manga.url, resolvedId, savedSourceId);
            const cachedCover = detail?.cover && isMangaCover(detail.cover, manga.url) ? detail.cover : '';
            if (!detail?.chapters?.length || !cachedCover) {
              detail = await api.detail(manga.url, resolvedId, { cacheResult: false, persistResult: false, allowDisabled: true, timeoutMs: 120_000 });
            }
            const cover = detail?.cover && isMangaCover(detail.cover, manga.url) ? detail.cover : '';
            if (cover) refreshedCoverUrls.add(cover);
            const patch = {
              ...(manga.coverRefreshPending ? { coverRefreshPending: false } : {}),
              ...(cover && cover !== manga.cover ? { cover } : {})
            };
            if (Object.keys(patch).length) {
              lib.updateFav(manga.url, patch, savedSourceId);
              favoritesChanged = true;
            }
          } else {
            detail = await api.restoreDetail(manga.url, resolvedId, savedSourceId);
            if (!detail?.chapters?.length) {
              if (!installedSourceIds && Number(manga.chapterTotal) > 0) continue;
              detail = api.peekDetail(manga.url, resolvedId);
              if (!detail?.chapters?.length) {
                const chaptersDetail = fetchFullDetails
                  ? null
                  : await api.detailFromLibraryChapters(manga.url, resolvedId, manga, { timeoutMs: 120_000 });
                detail = chaptersDetail || await api.detail(manga.url, resolvedId, { cacheResult: false, persistResult: false, allowDisabled: true, timeoutMs: 120_000 });
              }
            }
          }
          if (detail?.chapters?.length) await api.persistLibraryDetail(manga.url, resolvedId, detail, savedSourceId);
        } catch {
          // Keep this manga in the library; the missing detail can be retried next time.
        }
        completed += 1;
        if (fetchFullDetails) {
          cloudSync.setRestoreProgress({
            label: 'Recuperando detalles de las fuentes',
            current: completed,
            total: pending.length,
            currentLabel: manga.title || 'Manga'
          });
        }
      }
    }));
    if (refreshedCoverUrls.size) {
      await preloadLibraryCoversBatch([...refreshedCoverUrls], { web: true, persist: true });
    }
  } finally {
    restoreBatchWindow();
    if (favoritesChanged) window.dispatchEvent(new Event('cytlex:library-updated'));
    if (fetchFullDetails) cloudSync.setRestoreProgress(null);
  }
}

function startLibraryDetailBackfill() {
  if (!libraryDetailBackfillPromise) {
    libraryDetailBackfillPromise = (async () => {
      while (pendingLibraryDetailBackfills.length) {
        const nextJob = pendingLibraryDetailBackfills.shift();
        await backfillLibraryDetails(nextJob.favorites, nextJob.showAdultExtensions, nextJob.isActive, nextJob.installedSourceIds, nextJob.fetchFullDetails);
      }
    })().finally(() => {
      libraryDetailBackfillPromise = null;
      if (pendingLibraryDetailBackfills.length) startLibraryDetailBackfill();
    });
  }
}

function queueLibraryDetailBackfill(favorites, showAdultExtensions, isActive, installedSourceIds = null, fetchFullDetails = false) {
  const queuedJob = pendingLibraryDetailBackfills.find((queued) => Boolean(queued.installedSourceIds) === Boolean(installedSourceIds));
  if (queuedJob) {
    const mergedFavorites = new Map(queuedJob.favorites.map((manga) => [`${sourceIdFor(manga)}|${manga.url}`, manga]));
    favorites.forEach((manga) => mergedFavorites.set(`${sourceIdFor(manga)}|${manga.url}`, manga));
    queuedJob.favorites = [...mergedFavorites.values()];
    queuedJob.showAdultExtensions ||= showAdultExtensions;
    queuedJob.fetchFullDetails ||= fetchFullDetails;
    const previousIsActive = queuedJob.isActive;
    queuedJob.isActive = () => previousIsActive() || isActive();
    if (queuedJob.installedSourceIds && installedSourceIds) {
      installedSourceIds.forEach((sourceId) => queuedJob.installedSourceIds.add(sourceId));
    }
  } else {
    pendingLibraryDetailBackfills.push({
      favorites: [...new Map(favorites.map((manga) => [`${sourceIdFor(manga)}|${manga.url}`, manga])).values()],
      showAdultExtensions,
      isActive,
      installedSourceIds: installedSourceIds ? new Set(installedSourceIds) : null,
      fetchFullDetails
    });
  }
  startLibraryDetailBackfill();
}

const sortLibraryManga = (items, sortBy, unread) => items.sort((a, b) => {
  switch (sortBy) {
    case 'title-desc':
      return compareLibraryTitles(b, a);
    case 'unread-desc':
      return (unread[unreadKeyFor(b)] ?? unreadCountCache.get(unreadKeyFor(b)) ?? 0) - (unread[unreadKeyFor(a)] ?? unreadCountCache.get(unreadKeyFor(a)) ?? 0);
    case 'recent':
      return (b.addedAt || 0) - (a.addedAt || 0);
    default:
      return compareLibraryTitles(a, b);
  }
});

const unreadCountFor = (manga, sourceId) => {
  const key = unreadKeyFor(manga, sourceId);
  if (unreadCountCache.has(key)) return unreadCountCache.get(key);
  let urls = chapterIndex.peek(manga.url, sourceId);
  if (!Array.isArray(urls) || urls.length === 0) {
    const detail = api.peekDetail(manga.url, sourceId);
    if (Array.isArray(detail?.chapters) && detail.chapters.length) {
      urls = detail.chapters.map((chapter) => chapter.url).filter(Boolean);
    }
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    const readCount = Number(manga.chapterReadCount) || (manga.mihonProgress || []).filter((chapter) => chapter.read).length;
    const count = Math.max(0, (Number(manga.chapterTotal) || 0) - readCount);
    unreadCountCache.set(key, count);
    return count;
  }
  const count = urls.reduce((total, url) => total + (progress.get(url, sourceId)?.read ? 0 : 1), 0);
  unreadCountCache.set(key, count);
  return count;
};

progress.subscribe((change) => {
  if (change?.type === 'reset') unreadCountCache.clear();
  else if (change?.mangaUrl) invalidateUnreadCountsForUrl(change.mangaUrl);
  persistUnreadCountCache();
});
chapterIndex.subscribe((change) => {
  if (change?.type === 'set' || change?.type === 'drop') {
    invalidateUnreadCountsForUrl(change.mangaUrl);
  } else unreadCountCache.clear();
  persistUnreadCountCache();
});

function CachedLibraryCover({ cover, title, className, cachedOnly = false, cachedCover = '', allowRemoteFallback = false }) {
  const { ref, src, onError, onLoad } = useLibraryCover(cover, {
    cachedOnly,
    allowRemoteFallback,
    cachedCover: /^(data:|blob:)/i.test(cachedCover) ? cachedCover : ''
  });

  return (
    <div ref={ref} className="h-full w-full">
      {src ? (
        <img src={src} alt={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={className} onLoad={onLoad} onError={onError} />
      ) : <div className="h-full w-full bg-muted/40" />}
    </div>
  );
}

const Library = memo(function Library({ active = true, tutorialPreview = false }) {
  const { language, t } = useI18n();
  const activeRef = useRef(active);
  activeRef.current = active;
  const [cats, setCats] = useState(() => lib.cats());
  const [sel, setSel] = useState(() => initialLibraryCategory(lib.cats()));
  const [visitedCategoryIds, setVisitedCategoryIds] = useState(() => [initialLibraryCategory(lib.cats())]);
  const [favs, setFavs] = useState(() => lib.favs());
  const visibleFavs = tutorialPreview ? TUTORIAL_EMPTY_FAVORITES : favs;
  const visibleCats = tutorialPreview ? TUTORIAL_CATEGORIES : cats;
  const visibleSel = tutorialPreview ? 'todos' : sel;
  const [view, setView] = useState(settings.get().libraryView);
  const [checking, setChecking] = useState(libraryCheckInFlight);
  const [checkProgress, setCheckProgress] = useState(libraryCheckProgress);
  const [checkCooldown, setCheckCooldown] = useState(remainingLibraryCheckCooldown);
  const { toast } = useToast();
  const [coverSize, setCoverSize] = useState(() => settings.get().coverSize);
  const [showUnread, setShowUnread] = useState(() => settings.get().libraryShowUnread);
  const [showAdultExtensions, setShowAdultExtensions] = useState(() => !!settings.get().showAdultExtensions);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('cytlex:librarySort') || 'title-asc');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [unread, setUnread] = useState({});
  const unreadVersions = useRef(new Map());
  const categoryTabsRef = useRef(null);
  const librarySearchInputRef = useRef(null);
  const libraryActionsRef = useRef(null);
  const [compactLibraryUpdates, setCompactLibraryUpdates] = useState(false);
  const [compactLibrarySearch, setCompactLibrarySearch] = useState(false);
  const [librarySearchOpen, setLibrarySearchOpen] = useState(() => {
    try { return localStorage.getItem(LIBRARY_SEARCH_OPEN_KEY) === '1'; } catch { return false; }
  });
  const skipInitialLibrarySearchAnimation = useRef(librarySearchOpen);
  const reduceMotion = useReducedMotion();
  const scale = useScale();
  const isBrowserApp = typeof window !== 'undefined' && !window.cytlex;

  useLayoutEffect(() => {
    if (!active) return undefined;
    const actions = libraryActionsRef.current;
    const toolbar = actions?.closest('.library-toolbar');
    const toolbarRow = toolbar?.querySelector('.library-toolbar-row');
    const subroutes = toolbarRow?.querySelector('[data-catalog-subroutes]');
    if (!actions || !toolbar || !toolbarRow || !subroutes) return undefined;
    const update = () => {
      actions.classList.add('extensions-toolbar-measure-full');
      const sortButton = actions.querySelector('[data-library-sort]');
      const updatesButton = actions.querySelector('[data-library-updates]');
      const sortWidth = sortButton?.getBoundingClientRect().width || 0;
      const fullUpdatesWidth = updatesButton?.getBoundingClientRect().width || 0;
      actions.classList.remove('extensions-toolbar-measure-full');
      const style = getComputedStyle(toolbarRow);
      const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const activeCategoryWidth = subroutes.querySelector('[aria-current="page"]')?.getBoundingClientRect().width || 0;
      const activeWidth = activeCategoryWidth || Number.parseFloat(px(96, scale, 76));
      const reservedCategoryWidth = Math.max(activeWidth, subroutes.scrollWidth);
      const categoryNav = categoryTabsRef.current;
      const availableForActions = toolbarRow.clientWidth - padding - reservedCategoryWidth - gap;
      const actionGap = Number.parseFloat(getComputedStyle(actions).columnGap) || 0;
      const preferredSearchWidth = Number.parseFloat(px(280, scale, 240));
      const selectedCategory = visibleCats.find((category) => category.id === visibleSel);
      const name = selectedCategory?.name === 'Todos' && selectedCategory?.id === 'todos' ? t('Todos') : selectedCategory?.name || t('Biblioteca');
      const placeholder = t('Buscar en {category}', { category: truncateCategoryName(name, 10) });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) context.font = getComputedStyle(sortButton).font;
      const minSearchWidth = Math.max(Number.parseFloat(px(140, scale, 120)), Math.ceil(context?.measureText(placeholder).width || 0) + Number.parseFloat(px(12, scale, 9)) + Number.parseFloat(px(40, scale, 34)) + 4);
      const updatesCompactWidth = updatesButton?.getBoundingClientRect().height || 0;
      const searchIconWidth = Number.parseFloat(px(32, scale, 26));
      const categorySpace = toolbarRow.clientWidth - padding - gap - sortWidth - updatesCompactWidth - searchIconWidth - actionGap * 2;
      if (categoryNav) categoryNav.style.minWidth = `${Math.max(0, Math.min(reservedCategoryWidth, categorySpace))}px`;
      const updatesThreshold = preferredSearchWidth + sortWidth + fullUpdatesWidth + (actionGap * 2);
      const nextCompactUpdates = compactLibraryUpdates
        ? availableForActions < updatesThreshold + 8
        : availableForActions < updatesThreshold;
      const updatesWidth = nextCompactUpdates ? updatesCompactWidth : fullUpdatesWidth;
      const availableForSearch = availableForActions - sortWidth - updatesWidth - (actionGap * 2);
      setCompactLibraryUpdates(nextCompactUpdates);
      setCompactLibrarySearch((compact) => compact
        ? availableForSearch < minSearchWidth + 8
        : availableForSearch < minSearchWidth);
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    [toolbar, toolbarRow, subroutes, actions].forEach((element) => observer?.observe(element));
    window.addEventListener('resize', update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [active, visibleCats, visibleSel, scale, checking, checkProgress.current, checkProgress.total, compactLibraryUpdates]);

  const toggleLibrarySearch = () => {
    const nextOpen = !librarySearchOpen;
    setLibrarySearchOpen(nextOpen);
    try {
      if (nextOpen) localStorage.setItem(LIBRARY_SEARCH_OPEN_KEY, '1');
      else localStorage.removeItem(LIBRARY_SEARCH_OPEN_KEY);
    } catch {}
  };

  useLayoutEffect(() => {
    if (compactLibrarySearch && librarySearchOpen) skipInitialLibrarySearchAnimation.current = false;
  }, [compactLibrarySearch, librarySearchOpen]);

  const revealCategoryTab = (tab, behavior = reduceMotion ? 'auto' : 'smooth') => {
    const nav = categoryTabsRef.current;
    if (!nav || !tab) return;

    const navBounds = nav.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    const leftEdge = navBounds.left;
    const rightEdge = navBounds.right;
    const scrollOptions = { behavior };

    if (tabBounds.left < leftEdge) {
      nav.scrollBy({ ...scrollOptions, left: tabBounds.left - leftEdge });
    } else if (tabBounds.right > rightEdge) {
      nav.scrollBy({ ...scrollOptions, left: tabBounds.right - rightEdge });
    }
  };

  useEffect(() => {
    const activeTab = categoryTabsRef.current?.querySelector('[aria-current="page"]');
    revealCategoryTab(activeTab);
  }, [visibleSel, reduceMotion, scale]);

  useLayoutEffect(() => {
    const nav = categoryTabsRef.current;
    if (!active || !nav) return undefined;
    let frame = 0;
    const revealActive = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        revealCategoryTab(nav.querySelector('[aria-current="page"]'), 'auto');
      });
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(revealActive) : null;
    observer?.observe(nav);
    window.addEventListener('resize', revealActive);
    revealActive();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', revealActive);
    };
  }, [active, reduceMotion, scale]);

  useEffect(() => attachHorizontalScrollFade(categoryTabsRef.current), []);

  useEffect(
    () => settings.subscribe((s) => {
      setShowUnread(s.libraryShowUnread);
      setShowAdultExtensions(!!s.showAdultExtensions);
      setCoverSize(s.coverSize);
    }),
    []
  );
  useEffect(() => {
    const backfillInstalledSources = (event) => {
      if (tutorialPreview) return;
      const sourceIds = new Set(event.detail?.sourceIds || []);
      if (!sourceIds.size) return;
      const favorites = lib.favs().filter((manga) => sourceIds.has(sourceIdFor(manga)));
      if (favorites.length) queueLibraryDetailBackfill(favorites, settings.get().showAdultExtensions, () => true, sourceIds);
    };
    const backfillSyncedLibrary = () => {
      if (tutorialPreview || localStorage.getItem(CLOUD_SYNC_DETAILS_BACKFILL_PENDING_KEY) !== '1') return;
      localStorage.removeItem(CLOUD_SYNC_DETAILS_BACKFILL_PENDING_KEY);
      const favorites = lib.favs();
      const sourceIds = new Set(favorites.map(sourceIdFor).filter(Boolean));
      if (favorites.length) queueLibraryDetailBackfill(favorites, settings.get().showAdultExtensions, () => true, sourceIds, true);
    };
    const reloadLibraryOnUpdate = () => {
      const latest = lib.favs();
      setFavs((current) => sameLibraryFavorites(current, latest) ? current : latest);
    };
    window.addEventListener(EXTENSION_INSTALLED_EVENT, backfillInstalledSources);
    window.addEventListener(CLOUD_SYNC_DETAILS_BACKFILL_EVENT, backfillSyncedLibrary);
    window.addEventListener('cytlex:library-updated', reloadLibraryOnUpdate);
    backfillSyncedLibrary();
    return () => {
      window.removeEventListener(EXTENSION_INSTALLED_EVENT, backfillInstalledSources);
      window.removeEventListener(CLOUD_SYNC_DETAILS_BACKFILL_EVENT, backfillSyncedLibrary);
      window.removeEventListener('cytlex:library-updated', reloadLibraryOnUpdate);
    };
  }, [tutorialPreview]);
  useEffect(() => {
    const updates = [];
    const reassigned = new Set();
    favs.forEach((m) => {
      const currentId = m.sourceId || 'leercapitulo';
      const resolvedId = sourceIdFor(m);
      if (resolvedId && resolvedId !== currentId) {
        const key = `${currentId}|${resolvedId}`;
        if (!reassigned.has(key)) {
          progress.reassignSource(currentId, resolvedId);
          tracking.reassignSource(currentId, resolvedId);
          chapterIndex.reassignSource(currentId, resolvedId);
          reassigned.add(key);
        }
        updates.push({ url: m.url, sourceId: currentId, patch: { sourceId: resolvedId } });
      }
      const manifest = extensions.manifest(resolvedId || currentId);
      const patch = {};
      if ((!m.sourceName || (/^(mihon-\d+|Fuente Mihon \d+)$/i.test(String(m.sourceName)) && !/^(mihon-|Fuente Mihon)/i.test(String(manifest.name || '')))) && manifest.name) {
        patch.sourceName = manifest.name;
      }
      if (!m.sourceIcon && manifest.icon) patch.sourceIcon = manifest.icon;
      if (Object.keys(patch).length) updates.push({ url: m.url, sourceId: currentId, patch });
    });
    if (updates.length) setFavs(lib.updateFavs(updates));
  }, []);

  useEffect(() => {
    const reloadLibrary = () => {
      const latest = lib.favs();
      setFavs((current) => sameLibraryFavorites(current, latest) ? current : latest);
      const latestCats = lib.cats();
      setCats((current) => current.length === latestCats.length
        && current.every(({ id, name }, index) => id === latestCats[index].id && name === latestCats[index].name)
        ? current : latestCats);
    };
    if (active) {
      reloadLibrary();
      void api.pruneLibraryDetails(lib.favs());
    }
    const onImport = () => {
      setFavs(lib.favs());
      setCats(lib.cats());
      setUnread({});
    };
    window.addEventListener('cytlex:library-unread-reset', onImport);
    return () => window.removeEventListener('cytlex:library-unread-reset', onImport);
  }, [active]);

  useEffect(() => {
    const syncProgress = (progress) => setCheckProgress(progress);
    libraryCheckProgressListeners.add(syncProgress);
    syncProgress(libraryCheckProgress);
    return () => libraryCheckProgressListeners.delete(syncProgress);
  }, []);

  const displayCoverSize = useResponsiveCoverSize(coverSize);

  const runCheck = async () => {
    if (tutorialPreview) return;
    if (libraryCheckInFlight || remainingLibraryCheckCooldown() > 0) return;
    libraryCheckInFlight = true;
    setChecking(true);
    updateLibraryCheckProgress({ current: 0, total: visibleFavs.length });
    try {
      const found = await checkLibrary({ onProgress: updateLibraryCheckProgress });
      const n = found.length;
      if (n === 0) {
        toast({ title: t('Todo está al día'), description: t('No hay capítulos nuevos en tu biblioteca.'), variant: 'info' });
      } else {
        toast({
          title: language === 'en' ? `${n} ${n === 1 ? 'title' : 'titles'} updated` : n === 1 ? '1 obra actualizada' : `${n} obras actualizadas`,
          description: t('Hay capítulos nuevos disponibles.'),
          variant: 'success'
        });
      }
    } catch {
      toast({ title: t('No se pudo comprobar'), description: t('Revisa tu conexión e inténtalo de nuevo.'), variant: 'error' });
    } finally {
      libraryCheckInFlight = false;
      libraryCheckCooldownUntil = Date.now() + 3_000;
      setChecking(false);
      setCheckCooldown(3);
    }
  };

  useEffect(() => {
    if (!checking && !checkCooldown) return undefined;
    const timer = window.setInterval(() => {
      setChecking(libraryCheckInFlight);
      setCheckCooldown(remainingLibraryCheckCooldown());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [checking, checkCooldown]);

  useEffect(() => settings.subscribe((s) => setView(s.libraryView)), []);
  useEffect(() => {
    if (tutorialPreview) return;
    if (cats.some((c) => c.id === sel)) {
      sessionCategoria = sel;
      try { localStorage.setItem(LIBRARY_CATEGORY_KEY, sel); } catch {}
      return;
    }
    const fallback = cats[0]?.id || '';
    setSel(fallback);
    if (fallback) {
      setVisitedCategoryIds((current) => current.includes(fallback) ? current : [...current, fallback]);
    }
  }, [cats, sel, tutorialPreview]);

  useLayoutEffect(() => {
    if (!active || tutorialPreview) return undefined;
    const main = libraryScroller();
    if (!main) return undefined;
    const restore = () => { main.scrollTop = libraryScroll.get(sel); };
    const save = () => libraryScroll.set(sel, main.scrollTop);
    restore();
    const frame = requestAnimationFrame(restore);
    main.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      cancelAnimationFrame(frame);
      main.removeEventListener('scroll', save);
    };
  }, [sel, active, tutorialPreview]);

  const inCategory = useMemo(() => visibleFavs.filter((f) => (f.cats || []).includes(visibleSel)), [visibleFavs, visibleSel]);

  const unreadSort = sortBy === 'unread-desc' ? unread : null;
  const shown = useMemo(
    () => sortLibraryManga(inCategory.slice(), sortBy, unreadSort || {}),
    [inCategory, sortBy, unreadSort]
  );
  const selectedCategory = visibleCats.find((category) => category.id === visibleSel);
  const categoryName = selectedCategory?.id === 'todos' && selectedCategory?.name === 'Todos' ? t('Todos') : selectedCategory?.name || t('Biblioteca');
  const searched = useMemo(() => {
    const query = normalizeLibrarySearch(libraryQuery);
    return query ? shown.filter((manga) => normalizeLibrarySearch(manga.title).includes(query)) : shown;
  }, [shown, libraryQuery]);
  const visitedCategories = useMemo(() => visibleCats
    .filter((category) => (tutorialPreview ? category.id === 'todos' : visitedCategoryIds.includes(category.id)))
    .map((category) => ({
      ...category,
      items: category.id === visibleSel
        ? searched
        : sortLibraryManga(
            visibleFavs.filter((manga) => (manga.cats || []).includes(category.id)),
            sortBy,
            unreadSort || {}
          )
    })), [visibleCats, visitedCategoryIds, visibleSel, searched, visibleFavs, sortBy, unreadSort, tutorialPreview]);

  const selectCategory = (categoryId) => {
    setSel(categoryId);
    setVisitedCategoryIds((current) => current.includes(categoryId) ? current : [...current, categoryId]);
  };

  useEffect(() => {
    if (!showUnread) return undefined;
    let alive = true;
    (async () => {
      const pending = inCategory.filter((manga) => extensions.isInstalled(sourceIdFor(manga)) && !unreadCountCache.has(unreadKeyFor(manga)));
      const pendingByKey = new Map();
      const startingVersions = new Map();
      pending.forEach((manga) => {
        const key = unreadKeyFor(manga);
        pendingByKey.set(key, manga);
        startingVersions.set(key, unreadVersions.current.get(key) || 0);
      });
      for (let i = 0; i < pending.length; i += 12) {
        let batch = pending.slice(i, i + 12).map((manga) => {
          const sid = sourceIdFor(manga);
          return [unreadKeyFor(manga, sid), unreadCountFor(manga, sid)];
        });
        if (!alive) return;
        batch = batch.map(([key, count]) => {
          if (unreadVersions.current.get(key) === startingVersions.get(key)) return [key, count];
          const manga = pendingByKey.get(key);
          return [key, manga ? unreadCountFor(manga, sourceIdFor(manga)) : count];
        });
        persistUnreadCountCache();
        setUnread((prev) => {
          let next = prev;
          for (const [key, count] of batch) {
            if (prev[key] === count) continue;
            if (next === prev) next = { ...prev };
            next[key] = count;
          }
          return next;
        });
        if (i + 12 < pending.length) await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    })();
    return () => { alive = false; };
  }, [inCategory, showUnread]);

  useEffect(() => {
    if (!showUnread) return undefined;
    return progress.subscribe((change) => {
      if (change?.type === 'reset') {
        const updates = [];
        inCategory.forEach((manga) => {
          const sid = sourceIdFor(manga);
          if (!extensions.isInstalled(sid)) return;
          const key = `${sid}|${manga.url}`;
          unreadVersions.current.set(key, (unreadVersions.current.get(key) || 0) + 1);
          updates.push([key, unreadCountFor(manga, sid)]);
        });
        setUnread((prev) => {
          const next = { ...prev };
          updates.forEach(([key, count]) => { next[key] = count; });
          return next;
        });
        persistUnreadCountCache();
        return;
      }
      if (change?.type !== 'read' || !change.mangaUrl) return;
      const manga = inCategory.find((item) => item.url === change.mangaUrl && sourceIdFor(item) === change.sourceId);
      if (!manga) return;
      const key = `${change.sourceId}|${manga.url}`;
      unreadVersions.current.set(key, (unreadVersions.current.get(key) || 0) + 1);
      const count = unreadCountFor(manga, change.sourceId);
      setUnread((prev) => prev[key] === count ? prev : { ...prev, [key]: count });
      persistUnreadCountCache();
    });
  }, [inCategory, showUnread]);

  useEffect(() => {
    if (!showUnread) return undefined;
    return chapterIndex.subscribe((change) => {
      const changedSourceId = change?.sourceId || 'leercapitulo';
      const affected = change?.type === 'set' || change?.type === 'drop'
        ? inCategory.filter((manga) => {
            const savedSourceId = manga.sourceId || 'leercapitulo';
            return sameMangaUrl(manga.url, change.mangaUrl)
              && (sourceIdFor(manga) === changedSourceId || savedSourceId === changedSourceId);
          })
        : inCategory;
      if (!affected.length) return;
      const updates = affected
        .filter((manga) => extensions.isInstalled(sourceIdFor(manga)))
        .map((manga) => {
          const sid = sourceIdFor(manga);
          const key = unreadKeyFor(manga, sid);
          unreadCountCache.delete(key);
          unreadCountCache.delete(unreadKeyFor(manga, manga.sourceId || 'leercapitulo'));
          unreadVersions.current.set(key, (unreadVersions.current.get(key) || 0) + 1);
          return [key, unreadCountFor(manga, sid)];
        });
      setUnread((prev) => {
        const next = { ...prev };
        updates.forEach(([key, count]) => { next[key] = count; });
        return next;
      });
      persistUnreadCountCache();
    });
  }, [inCategory, showUnread]);

  const librarySearchField = (
    <div className="relative min-w-0 flex-1" role="search">
      <Input
        ref={librarySearchInputRef}
        className="bg-card border-border/70"
        placeholder={t('Buscar en {category}', { category: truncateCategoryName(categoryName, 10) })}
        aria-label={t('Buscar en {category}', { category: categoryName })}
        value={libraryQuery}
        onChange={(event) => {
          setLibraryQuery(event.target.value);
          const main = libraryScroller();
          if (main?.scrollTop > 0) {
            libraryScroll.set(sel, 0);
            main.scrollTop = 0;
          }
        }}
        enterKeyHint="search"
        style={{
          height: px(32, scale, 28),
          fontSize: fontPx(14, scale),
          paddingLeft: px(12, scale, 9),
          paddingRight: px(40, scale, 34)
        }}
      />
      <button
        type="button"
        aria-label={libraryQuery ? t('Limpiar búsqueda') : t('Buscar en {category}', { category: categoryName })}
        onClick={() => libraryQuery ? setLibraryQuery('') : librarySearchInputRef.current?.focus()}
        className="absolute inset-y-0 right-0 grid place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        style={{ width: px(36, scale, 30) }}
      >
        {libraryQuery
          ? <X aria-hidden="true" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
          : <Search aria-hidden="true" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />}
      </button>
    </div>
  );
  return (
    <div
      className={isBrowserApp ? 'flex h-full min-h-0 min-w-0 flex-col' : 'min-h-full flex flex-col'}
      style={isBrowserApp ? {
        paddingTop: 'var(--web-page-padding, 16px)',
        paddingLeft: px(16, scale, 12),
        paddingRight: px(16, scale, 12),
        paddingBottom: 0
      } : undefined}
    >
      <div
        className="library-toolbar -mt-2 max-md:-mt-3 flex min-w-0 shrink-0 flex-col border-b border-border/70 bg-sidebar"
        style={{
          marginBottom: isBrowserApp ? 0 : `${Math.max(8, Math.round(12 * scale))}px`,
          marginTop: isBrowserApp ? 'calc(-1 * var(--web-page-padding, 0px))' : undefined,
          marginLeft: isBrowserApp ? `-${px(16, scale, 12)}` : undefined,
          marginRight: isBrowserApp ? `-${px(16, scale, 12)}` : undefined
        }}
      >
      <div
        className="library-toolbar-row flex shrink-0 min-w-0 flex-nowrap items-center"
        style={{
          gap: px(16, scale, 12),
          height: `calc(${px(38, scale, 34)} - 1px)`,
          minHeight: `calc(${px(38, scale, 34)} - 1px)`,
          maxHeight: `calc(${px(38, scale, 34)} - 1px)`,
          boxSizing: 'border-box',
          overflow: 'hidden',
          paddingLeft: px(16, scale, 12),
          paddingRight: px(16, scale, 12)
        }}
      >
        <nav
          ref={categoryTabsRef}
          aria-label={t('Categorías de Biblioteca')}
          className="flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain whitespace-nowrap no-scrollbar"
          style={{ height: `calc(${px(38, scale, 34)} - 1px)`, minWidth: 0 }}
        >
          <div
            data-catalog-subroutes
            className="flex w-max min-w-max items-center whitespace-nowrap"
            style={{ gap: `${Math.max(16, Math.round(24 * scale))}px`, height: '100%' }}
          >
            {visibleCats.map((c) => {
              const active = c.id === visibleSel;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  aria-label={c.id === 'todos' && c.name === 'Todos' ? t('Todos') : c.name}
                  title={c.id === 'todos' && c.name === 'Todos' ? t('Todos') : c.name}
                  onClick={(event) => {
                    if (active) {
                      const main = libraryScroller();
                      if (main?.scrollTop > 1) {
                        libraryScroll.set(sel, 0);
                        main.scrollTo({ top: 0, behavior: 'smooth' });
                        return;
                      }
                      revealCategoryTab(event.currentTarget);
                      return;
                    }
                    selectCategory(c.id);
                  }}
                  className={cn(
                    'group relative shrink-0 p-0 transition-colors'
                  )}
                  style={{ fontSize: fontPx(14, scale), scrollMarginInline: px(16, scale, 12) }}
                >
                  <SubrouteTabLabel active={active}>{truncateCategoryName(c.id === 'todos' && c.name === 'Todos' ? t('Todos') : c.name, 15)}</SubrouteTabLabel>
                </button>
              );
            })}
          </div>
        </nav>
        <div ref={libraryActionsRef} className="ml-auto flex min-w-0 shrink items-center" style={{ gap: px(8, scale, 6) }}>
          {compactLibrarySearch ? (
            <div className="relative z-30 flex shrink-0 items-center">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={librarySearchOpen ? t('Cerrar búsqueda') : t('Abrir búsqueda en {category}', { category: categoryName })}
                aria-expanded={librarySearchOpen}
                aria-controls="library-search-row"
                onClick={toggleLibrarySearch}
                className="library-search-trigger rounded-none"
                style={{ ...toolbarButtonStyle(scale), width: px(32, scale, 26), paddingLeft: 0, paddingRight: 0 }}
              >
                <Search aria-hidden="true" style={{ width: px(16, scale, 14), height: px(16, scale, 14) }} />
              </Button>
            </div>
          ) : (
            <div
              className="catalog-search flex min-w-0 flex-1 items-center self-center"
              style={{
                flexBasis: px(280, scale, 240),
                minWidth: px(140, scale, 120),
                height: px(32, scale, 28),
                gap: px(12, scale, 9)
              }}
            >
              {librarySearchField}
            </div>
          )}
          <Button
            size="sm"
            variant="secondary"
            title={t('Ordenar')}
            data-library-sort
            className="library-sort-trigger shrink-0 rounded-none disabled:opacity-100"
            onClick={() => {
              const order = ['title-asc', 'title-desc', 'unread-desc', 'recent'];
              const next = order[(order.indexOf(sortBy) + 1) % order.length];
              setSortBy(next);
              try { localStorage.setItem('cytlex:librarySort', next); } catch {}
            }}
            style={toolbarButtonStyle(scale)}
          >
            <ArrowUpDown
              className="mr-2"
              style={{ width: `${Math.round(14 * scale)}px`, height: `${Math.round(14 * scale)}px` }}
            />
            {sortBy === 'title-asc' ? 'A-Z' : sortBy === 'title-desc' ? 'Z-A' : sortBy === 'unread-desc' ? 'Sin leer' : 'Recientes'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!visibleFavs.length || checking || checkCooldown > 0}
            aria-busy={checking}
            aria-label={t(checking ? 'Buscando actualizaciones' : 'Buscar actualizaciones')}
            data-library-updates
            onClick={runCheck}
            title={checkCooldown ? t('Puedes volver a buscar en {seconds} s', { seconds: checkCooldown }) : t('Buscar actualizaciones')}
            className={cn('library-updates-trigger extensions-refresh-button shrink-0 rounded-none', compactLibraryUpdates && 'is-compact')}
            style={toolbarButtonStyle(scale)}
          >
            {checking ? (
              <RefreshCw
                className="extensions-button-icon mr-2 animate-spin"
                style={{ width: `${Math.round(14 * scale)}px`, height: `${Math.round(14 * scale)}px` }}
              />
            ) : (
              <RefreshCw
                className="extensions-button-icon mr-2"
                style={{ width: `${Math.round(14 * scale)}px`, height: `${Math.round(14 * scale)}px` }}
              />
            )}
            <span className="extensions-button-label">
              {checking ? (
                <>
                  {t('Buscando')}
                  <span className="ml-2 tabular-nums opacity-75" aria-live="polite">
                    {checkProgress.current}/{checkProgress.total}
                  </span>
                </>
              ) : t('Buscar actualizaciones')}
            </span>
          </Button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {compactLibrarySearch && librarySearchOpen && (
          <motion.div
            initial={skipInitialLibrarySearchAnimation.current ? false : { height: 0, opacity: 0, transform: 'translateY(-4px)' }}
            id="library-search-row"
            animate={{ height: 'auto', opacity: 1, transform: 'translateY(0px)' }}
            exit={{ height: 0, opacity: 0, transform: 'translateY(-4px)' }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="min-w-0 shrink-0 overflow-hidden"
            style={{ containerType: 'inline-size' }}
          >
            <div className="flex min-w-0 items-center justify-center bg-sidebar" style={{ padding: `0 ${px(16, scale, 12)} ${px(3, scale, 3)}` }}>
              <div className="catalog-search flex min-w-0 items-center" style={{ width: '100%', height: px(32, scale, 28) }}>
                {librarySearchField}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      <div
        className={isBrowserApp ? 'page-content-scroll library-page-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain' : ''}
        style={isBrowserApp ? {
          marginRight: `-${px(16, scale, 12)}`,
          paddingRight: px(16, scale, 12),
          paddingTop: px(12, scale, 10),
          paddingBottom: px(12, scale, 10)
        } : undefined}
      >
      <section hidden={searched.length !== 0} aria-hidden={searched.length !== 0}>
        <EmptyState
          face="(っ-;)"
          tone="sad"
          title={t(libraryQuery.trim() ? 'No hay mangas que coincidan con la búsqueda' : visibleFavs.some((f) => (f.cats || []).includes(visibleSel)) ? 'No hay mangas visibles con este filtro' : 'Tu biblioteca está vacía')}
        />
      </section>
      {visitedCategories.map((category) => {
        const selected = category.id === visibleSel;
        const categoryItems = category.items;
        return (
          <section key={category.id} hidden={!selected} aria-hidden={!selected}>
            {categoryItems.length > 0 && (view === 'grid' ? (
              <VirtualMangaGrid
                items={categoryItems}
                coverSize={displayCoverSize}
                scale={scale}
                active={active && selected}
                overscanRows={2}
                responsiveCards
                renderCard={(m, cardWidth) => {
                  const sid = sourceIdFor(m);
                  const sourceNotOffered = isUnavailableMangaSource(sid);
                  const sourceManifest = extensions.manifest(sid);
                  const adultBlocked = !isExtensionAllowed(sourceManifest, showAdultExtensions);
                  const sourceNotConfigured = extensions.isInstalled(sid) && !isSourceConfigured(sourceManifest);
                  const sourceUnavailable = !extensions.isInstalled(sid) || adultBlocked || sourceNotConfigured;
                  const validCover = isMangaCover(m.cover, m.url);
                  const cover = (validCover && m.cover) || recallCover(m.url, sid);
                  return (
                    <MangaCard
                      key={`${sid}|${m.url}`}
                      m={validCover && m.cover === cover ? m : { ...m, cover, ...(!validCover && { coverCached: '', coverLocal: '' }) }}
                      sourceId={sid}
                      unavailable={sourceUnavailable}
                      canOpenUnavailable={sourceNotOffered}
                      unavailableLabel={t(sourceNotOffered ? 'Extensión no disponible' : adultBlocked ? 'Fuente bloqueada' : !extensions.isInstalled(sid) ? 'Fuente no instalada' : 'Fuente desactivada')}
                      minimal
                      from="biblioteca"
                      coverSize={cardWidth}
                      chapterCount={showUnread ? unread[unreadKeyFor(m, sid)] ?? unreadCountCache.get(unreadKeyFor(m, sid)) ?? null : null}
                    />
                  );
                }}
              />
            ) : (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${px(260, scale, 230)}), 1fr))` }}
              >
                {categoryItems.map((m) => {
                  const sid = sourceIdFor(m);
                  const validCover = isMangaCover(m.cover, m.url);
                  const cover = (validCover && m.cover) || recallCover(m.url, sid);
                  const unreadCount = unread[unreadKeyFor(m, sid)] ?? unreadCountCache.get(unreadKeyFor(m, sid));
                  const sourceManifest = extensions.manifest(sid);
                  const savedSourceName = String(m.sourceName || '');
                  const manifestSourceName = String(sourceManifest.name || '');
                  const hasSavedSourceName = savedSourceName && !/^(mihon-\d+|Fuente Mihon \d+)$/i.test(savedSourceName);
                  const sourceInfo = {
                    ...sourceManifest,
                    name: hasSavedSourceName
                      ? savedSourceName
                      : (manifestSourceName && !/^(mihon-|Fuente Mihon)/i.test(manifestSourceName) ? manifestSourceName : sid),
                    icon: sourceManifest.icon || m.sourceIcon
                  };
                  const adultBlocked = !isExtensionAllowed(sourceManifest, showAdultExtensions);
                  const installed = extensions.isInstalled(sid);
                  const sourceNotConfigured = installed && !isSourceConfigured(sourceManifest);
                  const unavailable = !installed || adultBlocked || sourceNotConfigured;
                  const sourceNotOffered = isUnavailableMangaSource(sid);
                  const linkDisabled = unavailable && !sourceNotOffered;
                  const unavailableLabel = t(sourceNotOffered ? 'Extensión no disponible' : adultBlocked ? 'Fuente bloqueada' : !installed ? 'Fuente no instalada' : 'Fuente desactivada');
                  return (
                    <div key={`${sid}|${m.url}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
                      <a
                        href={`#/manga?u=${encodeURIComponent(m.url)}&s=${encodeURIComponent(sid)}&from=biblioteca`}
                        className={cn('flex items-end gap-3 flex-1 min-w-0', unavailable && 'opacity-60', linkDisabled && 'pointer-events-none')}
                        onClick={(event) => rememberMangaPreview(m, sid, event.currentTarget.querySelector('img'))}
                        aria-disabled={linkDisabled}
                        tabIndex={linkDisabled ? -1 : undefined}
                      >
                        <span
                          className="manga-cover-corners relative rounded-sm shrink-0 overflow-hidden bg-muted"
                          style={{ width: px(68 * displayCoverSize / 160, scale, 56), height: px(102 * displayCoverSize / 160, scale, 82) }}
                        >
                          {cover && (
                            <CachedLibraryCover cover={cover} title={m.title} className="w-full h-full object-cover bg-black" cachedOnly={unavailable && !sourceNotOffered} cachedCover={validCover ? storedCoverThumbnail(m) : ''} allowRemoteFallback={m.coverRefreshPending} />
                          )}
                          {unavailable && (
                            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 px-0.5 text-center font-semibold leading-tight text-white" style={{ fontSize: fontPx(8, scale, 7) }}>
                              <span>{unavailableLabel}</span>
                              <span className="flex max-w-full min-w-0 items-center rounded-full bg-black/80 py-0.5 pl-0.5 pr-1 text-left" style={{ gap: px(4, scale, 3) }} title={sourceInfo.name}>
                                <SourceBadge m={sourceInfo} className="rounded-full bg-white shadow-sm" style={{ width: px(18, scale, 16), height: px(18, scale, 16), fontSize: fontPx(8, scale, 7) }} />
                                <span className="min-w-0 truncate" style={{ fontSize: fontPx(8, scale, 7) }}>{sourceInfo.name}</span>
                              </span>
                            </span>
                          )}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-semibold truncate" style={{ fontSize: fontPx(16, scale, 13) }}>{m.title}</span>
                          {showUnread && unreadCount != null && (
                            <span className="mt-1 block truncate text-muted-foreground" style={{ fontSize: fontPx(12, scale, 10) }}>
                              {unreadCount > 0 ? (language === 'en' ? `${unreadCount} unread` : `${unreadCount} sin leer`) : t('Lectura al día')}
                            </span>
                          )}
                        </span>
                      </a>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
      </div>
    </div>
  );
});

export default Library;

