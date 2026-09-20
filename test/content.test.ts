import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  entryKey,
  ENTRY_TTL_MS,
  FORGET_GRACE_MS,
  SAVE_INTERVAL_MS,
  SEEK_TOLERANCE_SECONDS,
} from "../src/shared.ts";
import type { Entry } from "../src/shared.ts";
import { installBrowser } from "./fake-browser.ts";
import type { FakeBrowser } from "./fake-browser.ts";
import { FakeVideo, installDom } from "./fake-dom.ts";
import type { Dom } from "./fake-dom.ts";
import { FakeClock, loadModule, settle, watchUrl } from "./harness.ts";

const FEED_URL = "https://www.youtube.com/feed/subscriptions";

let api: FakeBrowser;
let dom: Dom;
let clock: FakeClock;

const player = (
  options: { readyState?: number; duration?: number; currentTime?: number } = {},
): FakeVideo => {
  const video = new FakeVideo();
  video.readyState = options.readyState ?? 1;
  video.duration = options.duration ?? 1200;
  video.currentTime = options.currentTime ?? 0;
  return video;
};

const stored = (position: number, duration = 1200): Entry => ({
  position,
  duration,
  title: "example",
  updated: 1,
});

const boot = async (url: string): Promise<void> => {
  dom.setUrl(url);
  await loadModule("content");
  await settle();
};

const entryFor = (videoId: string): Entry | undefined =>
  api.storage.local.data.get(entryKey(videoId)) as Entry | undefined;

beforeEach(() => {
  clock = new FakeClock();
  clock.install();
  api = installBrowser();
  dom = installDom();
  dom.document.title = "Example - YouTube";
  api.storage.local.seed({ "meta:lastCleanup": clock.now });
});

afterEach(() => {
  clock.restore();
});

describe("player discovery", () => {
  it("waits for the player element to appear", async () => {
    api.storage.local.seed({ [entryKey("abc")]: stored(300) });
    await boot(watchUrl("abc"));

    const video = player();
    dom.document.video = video;
    clock.advance(250);
    await settle();

    assert.equal(video.currentTime, 300);
  });

  it("stays out of the way on a page that is not a watch page", async () => {
    const video = player();
    dom.document.video = video;
    await boot(FEED_URL);

    video.currentTime = 300;
    video.emit("timeupdate");
    await settle();

    assert.deepEqual(api.storage.local.snapshot(), { "meta:lastCleanup": clock.now });
  });
});

describe("restore", () => {
  it("seeks to the saved position", async () => {
    const video = player();
    dom.document.video = video;
    api.storage.local.seed({ [entryKey("abc")]: stored(300) });

    await boot(watchUrl("abc"));

    assert.equal(video.currentTime, 300);
  });

  it("leaves the player alone when the url asks for a start time", async () => {
    const video = player();
    dom.document.video = video;
    api.storage.local.seed({ [entryKey("abc")]: stored(300) });

    await boot(`${watchUrl("abc")}&t=90s`);

    assert.equal(video.currentTime, 0);
  });

  it("does not seek when the player is already within tolerance", async () => {
    const video = player({ currentTime: 300 - SEEK_TOLERANCE_SECONDS + 1 });
    dom.document.video = video;
    api.storage.local.seed({ [entryKey("abc")]: stored(300) });

    await boot(watchUrl("abc"));

    assert.equal(video.currentTime, 296);
  });

  it("forgets a stored position that is no longer worth keeping", async () => {
    const video = player();
    dom.document.video = video;
    api.storage.local.seed({ [entryKey("abc")]: stored(10) });

    await boot(watchUrl("abc"));

    assert.equal(entryFor("abc"), undefined);
    assert.equal(video.currentTime, 0);
  });

  it("waits for metadata before seeking", async () => {
    const video = player({ readyState: 0, duration: Number.NaN });
    dom.document.video = video;
    api.storage.local.seed({ [entryKey("abc")]: stored(300) });

    await boot(watchUrl("abc"));
    assert.equal(video.currentTime, 0);

    video.readyState = 1;
    video.duration = 1200;
    video.emit("loadedmetadata");
    await settle();

    assert.equal(video.currentTime, 300);
  });
});

describe("save", () => {
  it("writes a worthwhile position on timeupdate", async () => {
    const video = player();
    dom.document.video = video;
    await boot(watchUrl("abc"));

    video.currentTime = 300;
    video.emit("timeupdate");
    await settle();

    assert.deepEqual(entryFor("abc"), {
      position: 300,
      duration: 1200,
      title: "Example",
      updated: clock.now,
    });
  });

  it("throttles repeated timeupdates", async () => {
    const video = player();
    dom.document.video = video;
    await boot(watchUrl("abc"));

    video.currentTime = 300;
    video.emit("timeupdate");
    await settle();

    video.currentTime = 600;
    video.emit("timeupdate");
    await settle();
    assert.equal(entryFor("abc")?.position, 300);

    clock.advance(SAVE_INTERVAL_MS);
    video.emit("timeupdate");
    await settle();
    assert.equal(entryFor("abc")?.position, 600);
  });

  it("flushes on pause, seek and page hide without throttling", async () => {
    const video = player();
    dom.document.video = video;
    await boot(watchUrl("abc"));

    video.currentTime = 300;
    video.emit("pause");
    await settle();
    assert.equal(entryFor("abc")?.position, 300);

    video.currentTime = 400;
    video.emit("seeked");
    await settle();
    assert.equal(entryFor("abc")?.position, 400);

    video.currentTime = 500;
    dom.window.emit("pagehide");
    await settle();
    assert.equal(entryFor("abc")?.position, 500);

    video.currentTime = 600;
    dom.document.visibilityState = "hidden";
    dom.document.emit("visibilitychange");
    await settle();
    assert.equal(entryFor("abc")?.position, 600);
  });
});

describe("forget grace", () => {
  it("keeps the saved position while the grace window is open", async () => {
    const video = player();
    dom.document.video = video;
    await boot(watchUrl("abc"));

    video.emit("playing");
    video.currentTime = 300;
    video.emit("pause");
    await settle();
    assert.equal(entryFor("abc")?.position, 300);

    video.currentTime = 5;
    video.emit("pause");
    await settle();

    assert.equal(entryFor("abc")?.position, 300);
  });

  it("forgets once the grace window has passed", async () => {
    const video = player();
    dom.document.video = video;
    await boot(watchUrl("abc"));

    video.emit("playing");
    video.currentTime = 300;
    video.emit("pause");
    await settle();

    clock.advance(FORGET_GRACE_MS);
    video.currentTime = 5;
    video.emit("pause");
    await settle();

    assert.equal(entryFor("abc"), undefined);
  });

  it("never forgets when playback never started", async () => {
    const video = player();
    dom.document.video = video;
    api.storage.local.seed({ [entryKey("abc")]: stored(300) });
    await boot(watchUrl("abc"));

    clock.advance(FORGET_GRACE_MS * 10);
    video.currentTime = 5;
    video.emit("pause");
    await settle();

    assert.equal(entryFor("abc")?.position, 300);
  });

  it("forgets when the video runs to the end", async () => {
    const video = player();
    dom.document.video = video;
    api.storage.local.seed({ [entryKey("abc")]: stored(300) });
    await boot(watchUrl("abc"));

    video.emit("ended");
    await settle();

    assert.equal(entryFor("abc"), undefined);
  });
});

describe("media swap", () => {
  it("holds the last kept position while the source is replaced", async () => {
    const video = player();
    dom.document.video = video;
    await boot(watchUrl("abc"));

    video.emit("playing");
    video.currentTime = 300;
    video.emit("pause");
    await settle();

    video.emit("emptied");
    video.currentTime = 0;
    video.emit("pause");
    await settle();

    assert.equal(entryFor("abc")?.position, 300);
  });

  it("starts saving again once the new source has metadata", async () => {
    const video = player();
    dom.document.video = video;
    await boot(watchUrl("abc"));

    video.emit("playing");
    video.currentTime = 300;
    video.emit("pause");
    await settle();

    video.emit("loadstart");
    await settle();

    video.currentTime = 600;
    video.emit("pause");
    await settle();

    assert.equal(entryFor("abc")?.position, 600);
  });
});

describe("in-page navigation", () => {
  it("attaches to the next video after a youtube navigation event", async () => {
    const first = player();
    dom.document.video = first;
    await boot(watchUrl("abc"));

    const second = player({ duration: 2400 });
    api.storage.local.seed({ [entryKey("def")]: stored(900, 2400) });
    dom.document.video = second;
    dom.setUrl(watchUrl("def"));
    dom.document.emit("yt-navigate-finish");
    await settle();

    assert.equal(second.currentTime, 900);
  });

  it("stops listening to the player it left behind", async () => {
    const first = player();
    dom.document.video = first;
    await boot(watchUrl("abc"));

    const second = player({ duration: 2400 });
    dom.document.video = second;
    dom.setUrl(watchUrl("def"));
    dom.document.emit("yt-navigate-finish");
    await settle();

    first.currentTime = 300;
    first.emit("timeupdate");
    await settle();

    assert.equal(entryFor("abc"), undefined);
  });

  it("follows a url change that only the poll notices", async () => {
    const first = player();
    dom.document.video = first;
    await boot(watchUrl("abc"));

    const second = player({ duration: 2400 });
    api.storage.local.seed({ [entryKey("def")]: stored(900, 2400) });
    dom.document.video = second;
    dom.setUrl(watchUrl("def"));
    clock.runInterval();
    await settle();

    assert.equal(second.currentTime, 900);
  });
});

describe("cleanup", () => {
  it("sweeps stale entries on load", async () => {
    api.storage.local.data.delete("meta:lastCleanup");
    api.storage.local.seed({
      [entryKey("old")]: { ...stored(300), updated: clock.now - ENTRY_TTL_MS - 1 },
      [entryKey("new")]: { ...stored(300), updated: clock.now },
    });

    await boot(FEED_URL);

    assert.equal(entryFor("old"), undefined);
    assert.equal(entryFor("new")?.position, 300);
    assert.equal(api.storage.local.data.get("meta:lastCleanup"), clock.now);
  });

  it("skips the sweep when it ran recently", async () => {
    api.storage.local.seed({
      "meta:lastCleanup": clock.now - 1000,
      [entryKey("old")]: { ...stored(300), updated: clock.now - ENTRY_TTL_MS - 1 },
    });

    await boot(FEED_URL);

    assert.equal(entryFor("old")?.position, 300);
  });
});
