import {
  CLEANUP_INTERVAL_MS,
  CLEANUP_KEY,
  entryKey,
  isEntryKey,
  isStale,
  QUALITY_CHANGE_EVENT,
  QUALITY_SET_EVENT,
  readSettings,
  SAVE_INTERVAL_MS,
  SEEK_TOLERANCE_SECONDS,
  SETTINGS_KEY,
  shouldForget,
  worthKeeping,
} from "./shared.ts";
import type { Entry, Settings } from "./shared.ts";

const CAPTIONS_SELECTOR = ".ytp-subtitles-button";
const AUTONAV_SELECTOR = ".ytp-autonav-toggle-button";

let currentId: string | null = null;
let video: HTMLVideoElement | null = null;
let lastSavedAt = 0;
let restored = false;
let readyAt = 0;
let lastKept: Entry | null = null;
let played = false;

let settings: Settings = {};
const settingsReady = readSettings().then((value) => {
  settings = value;
});
let captionsObserver: MutationObserver | null = null;
let autonavObserver: MutationObserver | null = null;

const playable = (element: HTMLVideoElement): boolean =>
  element.error === null &&
  element.readyState >= HTMLMediaElement.HAVE_METADATA &&
  Number.isFinite(element.duration) &&
  element.duration > 0;

const videoIdFromUrl = (): string | null => new URLSearchParams(location.search).get("v");

const hasExplicitStart = (): boolean => {
  const params = new URLSearchParams(location.search);
  return params.has("t") || params.has("start");
};

const pageTitle = (): string => document.title.replace(/ - YouTube$/, "").trim();

const forget = async (videoId: string): Promise<void> => {
  await browser.storage.local.remove(entryKey(videoId));
};

const saveSetting = async <K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> => {
  if (settings[key] === value) return;
  settings = { ...settings, [key]: value };
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
};

const onRateChange = (): void => {
  if (!video) return;
  void saveSetting("playbackRate", video.playbackRate);
};

const applyQuality = (): void => {
  if (!settings.quality) return;
  document.dispatchEvent(new CustomEvent(QUALITY_SET_EVENT, { detail: settings.quality }));
};

document.addEventListener(QUALITY_CHANGE_EVENT, (event) => {
  const quality = (event as CustomEvent<string>).detail;
  if (typeof quality !== "string") return;
  void saveSetting("quality", quality);
});

const waitForElement = <T extends Element>(selector: string, videoId: string): Promise<T | null> =>
  new Promise((resolve) => {
    const attempt = (): void => {
      if (currentId !== videoId) {
        resolve(null);
        return;
      }
      const element = document.querySelector<T>(selector);
      if (element) {
        resolve(element);
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });

const buttonState = (element: Element, attr: string): boolean =>
  element.getAttribute(attr) === "true";

const setupToggle = async (
  selector: string,
  attr: string,
  videoId: string,
  key: "autoplay" | "captions",
  getObserver: () => MutationObserver | null,
  setObserver: (observer: MutationObserver | null) => void,
): Promise<void> => {
  getObserver()?.disconnect();
  setObserver(null);

  const element = await waitForElement<HTMLElement>(selector, videoId);
  if (!element || currentId !== videoId) return;

  const desired = settings[key];
  if (typeof desired === "boolean" && buttonState(element, attr) !== desired) {
    element.click();
  }

  const observer = new MutationObserver(() => {
    void saveSetting(key, buttonState(element, attr));
  });
  observer.observe(element, { attributes: true, attributeFilter: [attr] });
  setObserver(observer);
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

  if (!element || readyAt === 0 || !stillOnCurrentVideo() || !playable(element)) {
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
    if (shouldForget(entry.position, entry.duration, Date.now() - readyAt, played)) {
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
  played = false;
  if (!element || !videoId) return;

  void persistKept(videoId).then(() => rearm(element, videoId));
};

const onPlaying = (): void => {
  played = true;
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

  const ready = playable(element);
  if (!worthKeeping(stored.position, ready ? element.duration : stored.duration)) {
    if (ready) await forget(videoId);
    return;
  }
  lastKept = stored;
  if (!ready) return;

  if (Math.abs(element.currentTime - stored.position) > SEEK_TOLERANCE_SECONDS) {
    element.currentTime = stored.position;
  }
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
  video.removeEventListener("playing", onPlaying);
  video.removeEventListener("pause", flush);
  video.removeEventListener("seeked", flush);
  video.removeEventListener("ended", onEnded);
  video.removeEventListener("emptied", onMediaSwap);
  video.removeEventListener("loadstart", onMediaSwap);
  video.removeEventListener("ratechange", onRateChange);
  video = null;
  readyAt = 0;
  played = false;
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
  played = false;
  lastKept = null;

  const element = await findVideo(videoId);
  if (!element || currentId !== videoId) return;

  video = element;

  await settingsReady;
  if (currentId !== videoId || video !== element) return;

  void setupToggle(
    CAPTIONS_SELECTOR,
    "aria-pressed",
    videoId,
    "captions",
    () => captionsObserver,
    (observer) => {
      captionsObserver = observer;
    },
  );
  void setupToggle(
    AUTONAV_SELECTOR,
    "aria-checked",
    videoId,
    "autoplay",
    () => autonavObserver,
    (observer) => {
      autonavObserver = observer;
    },
  );
  applyQuality();
  setTimeout(() => {
    if (currentId === videoId) applyQuality();
  }, 1500);

  await whenMetadataReady(element);
  if (currentId !== videoId || video !== element) return;
  await restore(videoId);
  if (currentId !== videoId || video !== element) return;

  if (typeof settings.playbackRate === "number" && element.playbackRate !== settings.playbackRate) {
    element.playbackRate = settings.playbackRate;
  }

  readyAt = Date.now();
  element.addEventListener("timeupdate", onTimeUpdate);
  element.addEventListener("playing", onPlaying);
  element.addEventListener("pause", flush);
  element.addEventListener("seeked", flush);
  element.addEventListener("ended", onEnded);
  element.addEventListener("emptied", onMediaSwap);
  element.addEventListener("loadstart", onMediaSwap);
  element.addEventListener("ratechange", onRateChange);
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
