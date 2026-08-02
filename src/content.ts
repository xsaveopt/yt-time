import {
  CLEANUP_INTERVAL_MS,
  CLEANUP_KEY,
  entryKey,
  isEntryKey,
  isStale,
  SAVE_INTERVAL_MS,
  SEEK_TOLERANCE_SECONDS,
  shouldForget,
  worthKeeping,
} from "./shared.ts";
import type { Entry } from "./shared.ts";

let currentId: string | null = null;
let video: HTMLVideoElement | null = null;
let lastSavedAt = 0;
let restored = false;
let readyAt = 0;
let lastKept: Entry | null = null;

const videoIdFromUrl = (): string | null => new URLSearchParams(location.search).get("v");

const hasExplicitStart = (): boolean => {
  const params = new URLSearchParams(location.search);
  return params.has("t") || params.has("start");
};

const pageTitle = (): string => document.title.replace(/ - YouTube$/, "").trim();

const forget = async (videoId: string): Promise<void> => {
  await browser.storage.local.remove(entryKey(videoId));
};

const stillOnCurrentVideo = (): boolean => currentId !== null && videoIdFromUrl() === currentId;

const persistKept = async (videoId: string): Promise<void> => {
  if (!lastKept) return;
  await browser.storage.local.set({ [entryKey(videoId)]: lastKept });
};

const save = async (): Promise<void> => {
  const element = video;
  const videoId = currentId;
  if (!videoId) return;

  if (!element || readyAt === 0 || !stillOnCurrentVideo()) {
    await persistKept(videoId);
    return;
  }

  const entry: Entry = {
    position: element.currentTime,
    duration: element.duration,
    title: pageTitle(),
    updated: Date.now(),
  };

  if (!worthKeeping(entry.position, entry.duration)) {
    if (shouldForget(entry.position, entry.duration, Date.now() - readyAt)) {
      lastKept = null;
      await forget(videoId);
    }
    return;
  }

  lastKept = entry;
  await browser.storage.local.set({ [entryKey(videoId)]: entry });
};

const onTimeUpdate = (): void => {
  const now = Date.now();
  if (now - lastSavedAt < SAVE_INTERVAL_MS) return;
  lastSavedAt = now;
  void save();
};

const flush = (): void => {
  void save();
};

const rearm = async (element: HTMLVideoElement, videoId: string): Promise<void> => {
  await whenMetadataReady(element);
  if (video !== element || currentId !== videoId) return;
  if (videoIdFromUrl() !== videoId) return;
  readyAt = Date.now();
};

const onMediaSwap = (): void => {
  if (readyAt === 0) return;

  const element = video;
  const videoId = currentId;
  readyAt = 0;
  if (!element || !videoId) return;

  void persistKept(videoId).then(() => rearm(element, videoId));
};

const onEnded = (): void => {
  if (!currentId || !stillOnCurrentVideo()) return;
  lastKept = null;
  void forget(currentId);
};

const restore = async (videoId: string): Promise<void> => {
  if (restored || hasExplicitStart()) return;

  const key = entryKey(videoId);
  const stored = (await browser.storage.local.get(key))[key] as Entry | undefined;
  const element = video;
  if (!stored || !element || currentId !== videoId) return;

  if (!worthKeeping(stored.position, element.duration || stored.duration)) {
    await forget(videoId);
    return;
  }
  if (Math.abs(element.currentTime - stored.position) > SEEK_TOLERANCE_SECONDS) {
    element.currentTime = stored.position;
  }
  lastKept = stored;
  restored = true;
};

const findVideo = (videoId: string): Promise<HTMLVideoElement | null> =>
  new Promise((resolve) => {
    const attempt = (): void => {
      if (currentId !== videoId) {
        resolve(null);
        return;
      }
      const element =
        document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
        document.querySelector<HTMLVideoElement>("video");
      if (element) {
        resolve(element);
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });

const whenMetadataReady = (element: HTMLVideoElement): Promise<void> =>
  new Promise((resolve) => {
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    const done = (): void => {
      element.removeEventListener("loadedmetadata", done);
      resolve();
    };
    element.addEventListener("loadedmetadata", done);
    setTimeout(done, 15000);
  });

const detach = (): void => {
  if (!video) return;
  video.removeEventListener("timeupdate", onTimeUpdate);
  video.removeEventListener("pause", flush);
  video.removeEventListener("seeked", flush);
  video.removeEventListener("ended", onEnded);
  video.removeEventListener("emptied", onMediaSwap);
  video.removeEventListener("loadstart", onMediaSwap);
  video = null;
  readyAt = 0;
};

const attach = async (): Promise<void> => {
  const videoId = videoIdFromUrl();
  if (!videoId || videoId === currentId) return;

  flush();
  detach();
  currentId = videoId;
  restored = false;
  lastSavedAt = 0;
  readyAt = 0;
  lastKept = null;

  const element = await findVideo(videoId);
  if (!element || currentId !== videoId) return;

  video = element;

  await whenMetadataReady(element);
  if (currentId !== videoId || video !== element) return;
  await restore(videoId);
  if (currentId !== videoId || video !== element) return;

  readyAt = Date.now();
  element.addEventListener("timeupdate", onTimeUpdate);
  element.addEventListener("pause", flush);
  element.addEventListener("seeked", flush);
  element.addEventListener("ended", onEnded);
  element.addEventListener("emptied", onMediaSwap);
  element.addEventListener("loadstart", onMediaSwap);
};

const cleanup = async (): Promise<void> => {
  const all = await browser.storage.local.get(null);
  const now = Date.now();
  const last = all[CLEANUP_KEY] as number | undefined;
  if (typeof last === "number" && now - last < CLEANUP_INTERVAL_MS) return;

  const stale = Object.entries(all)
    .filter(([key, value]) => isEntryKey(key) && isStale(value as Entry | undefined, now))
    .map(([key]) => key);

  if (stale.length > 0) await browser.storage.local.remove(stale);
  await browser.storage.local.set({ [CLEANUP_KEY]: now });
};

document.addEventListener("yt-navigate-finish", () => void attach());
window.addEventListener("pagehide", flush);
window.addEventListener("beforeunload", flush);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
});

let lastHref = location.href;
setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  void attach();
}, 1000);

void attach();
void cleanup();
