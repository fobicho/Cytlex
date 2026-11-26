export const CLOUD_SYNC_LOCAL_CHANGE_EVENT = 'cytlex:cloud-sync-local-change';
export const CLOUD_SYNC_DETAILS_BACKFILL_EVENT = 'cytlex:cloud-sync-details-backfill';
export const CLOUD_SYNC_DETAILS_BACKFILL_PENDING_KEY = 'cytlex:cloud-sync-details-backfill-pending:v1';

export function notifyCloudSyncLocalChange(detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CLOUD_SYNC_LOCAL_CHANGE_EVENT, { detail }));
}
