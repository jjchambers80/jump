// Cross-tab signal for "an organization was created" (spec 022).
// The org switcher opens /signup in a new tab; when that tab finishes, the
// original tab's OrgProvider refetches and selects the new organization.
// BroadcastChannel where available, localStorage `storage` events otherwise.

export const ORG_CHANNEL = 'jump-org';
const STORAGE_KEY = 'jump.org.created';

export interface OrgChannelMessage {
  type: 'org-created';
  id: string;
}

export function announceOrganizationCreated(id: string) {
  const message: OrgChannelMessage = { type: 'org-created', id };
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(ORG_CHANNEL);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...message, at: Date.now() }));
  } catch {
    // ignore
  }
}

/** Subscribe to org-created announcements from other tabs. Returns an unsubscribe. */
export function onOrganizationCreated(handler: (id: string) => void): () => void {
  const cleanups: Array<() => void> = [];
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(ORG_CHANNEL);
      channel.onmessage = (event: MessageEvent<OrgChannelMessage>) => {
        if (event.data?.type === 'org-created' && event.data.id) handler(event.data.id);
      };
      cleanups.push(() => channel.close());
    }
  } catch {
    // ignore
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as OrgChannelMessage;
      if (parsed.type === 'org-created' && parsed.id) handler(parsed.id);
    } catch {
      // ignore
    }
  };
  window.addEventListener('storage', onStorage);
  cleanups.push(() => window.removeEventListener('storage', onStorage));
  return () => cleanups.forEach((fn) => fn());
}
