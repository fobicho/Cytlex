export const CLOUD_SYNC_LOCAL_CHANGE_EVENT = 'cytlex:cloud-sync-local-change';

export function notifyCloudSyncLocalChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLOUD_SYNC_LOCAL_CHANGE_EVENT));
}
