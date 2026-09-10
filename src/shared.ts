export const KEY_PREFIX = "v:";
export const CLEANUP_KEY = "meta:lastCleanup";
export const WATCH_URL_PATTERN = "*://*.youtube.com/watch*";

export const MIN_POSITION_SECONDS = 60;
export const MIN_REMAINING_SECONDS = 90;
export const MAX_PROGRESS = 0.95;
export const SEEK_TOLERANCE_SECONDS = 5;
export const SAVE_INTERVAL_MS = 2000;
export const FORGET_GRACE_MS = 3000;
export const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const WINDOW_CLOSE_GRACE_MS = 5000;

export type Entry = {
  position: number;
  duration: number;
  title: string;
  updated: number;
};

export const entryKey = (videoId: string): string => `${KEY_PREFIX}${videoId}`;

export const isEntryKey = (key: string): boolean => key.startsWith(KEY_PREFIX);

export const videoIdFromKey = (key: string): string => key.slice(KEY_PREFIX.length);

export const worthKeeping = (position: number, duration: number): boolean => {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return false;
  if (position < MIN_POSITION_SECONDS) return false;
  if (duration - position < MIN_REMAINING_SECONDS) return false;
  return position / duration <= MAX_PROGRESS;
};

export const shouldForget = (
  position: number,
  duration: number,
  msSinceReady: number,
  played: boolean,
): boolean => {
  if (!played) return false;
  if (worthKeeping(position, duration)) return false;
  return msSinceReady >= FORGET_GRACE_MS;
};

export const isStale = (entry: Entry | undefined, now: number): boolean =>
  !entry || typeof entry.updated !== "number" || now - entry.updated > ENTRY_TTL_MS;

export const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
};

export const videoIdFromUrl = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(parsed.hostname)) return null;
    if (parsed.pathname !== "/watch") return null;
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
};

export const readEntries = async (): Promise<Array<Entry & { id: string }>> => {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => isEntryKey(key))
    .map(([key, value]) => ({ id: videoIdFromKey(key), ...(value as Entry) }))
    .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
};

export type OpenTab = { tabId: number; windowId: number };

export const readOpenTabs = async (): Promise<Map<string, OpenTab>> => {
  const open = new Map<string, OpenTab>();
  try {
    const tabs = await browser.tabs.query({ url: WATCH_URL_PATTERN });
    for (const tab of tabs) {
      const id = videoIdFromUrl(tab.url);
      if (id === null || tab.id === undefined || open.has(id)) continue;
      open.set(id, { tabId: tab.id, windowId: tab.windowId ?? browser.windows.WINDOW_ID_CURRENT });
    }
  } catch {
    return open;
  }
  return open;
};
