import {
  entryKey,
  isEntryKey,
  videoIdFromKey,
  videoIdFromUrl,
  WATCH_URL_PATTERN,
  WINDOW_CLOSE_GRACE_MS,
} from "./shared.ts";

type State = { tabs: Record<string, string>; closed: string[] };
type OpenVideo = { tabId: number; videoId: string };

const STATE_KEY = "state";

let queue: Promise<void> = Promise.resolve();

const serialize = (task: () => Promise<void>): void => {
  queue = queue.then(task).catch(() => undefined);
};

const openVideos = async (): Promise<OpenVideo[]> => {
  const tabs = await browser.tabs.query({ url: WATCH_URL_PATTERN });
  return tabs.flatMap((tab) => {
    const videoId = videoIdFromUrl(tab.url);
    return videoId === null || tab.id === undefined ? [] : [{ tabId: tab.id, videoId }];
  });
};

const isOpen = async (videoId: string, exceptTabId?: number): Promise<boolean> =>
  (await openVideos()).some((open) => open.videoId === videoId && open.tabId !== exceptTabId);

const loadState = async (): Promise<State> => {
  const stored = (await browser.storage.session.get(STATE_KEY))[STATE_KEY] as State | undefined;
  if (stored) return stored;
  const tabs: Record<string, string> = {};
  for (const open of await openVideos()) tabs[open.tabId] = open.videoId;
  return { tabs, closed: [] };
};

const saveState = async (state: State): Promise<void> => {
  await browser.storage.session.set({ [STATE_KEY]: state });
};

const release = async (state: State, videoId: string, exceptTabId?: number): Promise<void> => {
  if (await isOpen(videoId, exceptTabId)) return;
  if (!state.closed.includes(videoId)) state.closed.push(videoId);
  await saveState(state);
  await browser.storage.local.remove(entryKey(videoId));
};

const track = (tabId: number, url: string | undefined): void =>
  serialize(async () => {
    const state = await loadState();
    const key = String(tabId);
    const previous = state.tabs[key];
    const current = videoIdFromUrl(url);
    if (previous === undefined && current === null) return;
    if (current === null) {
      delete state.tabs[key];
    } else {
      state.tabs[key] = current;
      state.closed = state.closed.filter((videoId) => videoId !== current);
    }
    await saveState(state);
    if (previous !== undefined && previous !== current) await release(state, previous);
  });

const untrack = (tabId: number): void =>
  serialize(async () => {
    const state = await loadState();
    const key = String(tabId);
    const previous = state.tabs[key];
    delete state.tabs[key];
    await saveState(state);
    if (previous !== undefined) await release(state, previous, tabId);
  });

browser.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined) track(tab.id, tab.url);
});

browser.tabs.onUpdated.addListener(
  (tabId, _changeInfo, tab) => {
    track(tabId, tab.url);
  },
  { properties: ["url", "status"] },
);

browser.tabs.onRemoved.addListener((tabId, { isWindowClosing }) => {
  if (!isWindowClosing) {
    untrack(tabId);
    return;
  }
  setTimeout(() => {
    void browser.windows.getAll().then((windows) => {
      if (windows.length > 0) untrack(tabId);
    });
  }, WINDOW_CLOSE_GRACE_MS);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const written = Object.entries(changes)
    .filter(([key, change]) => isEntryKey(key) && change.newValue !== undefined)
    .map(([key]) => videoIdFromKey(key));
  if (written.length === 0) return;

  serialize(async () => {
    const state = await loadState();
    for (const videoId of written) {
      if (!state.closed.includes(videoId) || (await isOpen(videoId))) continue;
      await browser.storage.local.remove(entryKey(videoId));
    }
  });
});
