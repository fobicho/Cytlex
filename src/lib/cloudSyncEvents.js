export const CLOUD_SYNC_LOCAL_CHANGE_EVENT = 'cytlex:cloud-sync-local-change';
export const CLOUD_SYNC_DETAILS_BACKFILL_EVENT = 'cytlex:cloud-sync-details-backfill';
export const CLOUD_SYNC_DETAILS_BACKFILL_PENDING_KEY = 'cytlex:cloud-sync-details-backfill-pending:v1';

export function readPendingLibraryDetails() {
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_DETAILS_BACKFILL_PENDING_KEY);
    if (raw === '1') return { id: 'legacy', pending: null };
    const value = JSON.parse(raw);
    return value?.id && Array.isArray(value.pending) ? value : null;
  } catch { return null; }
}

export function pendingLibraryDetailKey(manga) {
  return `${manga.sourceId || 'leercapitulo'}|${manga.url}`;
}

export function notifyCloudSyncLocalChange(detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CLOUD_SYNC_LOCAL_CHANGE_EVENT, { detail }));
}
