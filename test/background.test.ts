import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { entryKey, WINDOW_CLOSE_GRACE_MS } from "../src/shared.ts";
import type { Entry } from "../src/shared.ts";
import { installBrowser } from "./fake-browser.ts";
import type { FakeBrowser } from "./fake-browser.ts";
import { FakeClock, loadModule, settle, watchUrl } from "./harness.ts";

type State = { tabs: Record<string, string>; closed: string[] };

const FEED_URL = "https://www.youtube.com/feed/subscriptions";

const saved: Entry = { position: 300, duration: 1200, title: "example", updated: 1 };

let api: FakeBrowser;
let clock: FakeClock;

const start = async (): Promise<void> => {
  await loadModule("background");
  await settle();
};

const state = (): State => api.storage.session.data.get("state") as State;

const held = (videoId: string): boolean => api.storage.local.data.has(entryKey(videoId));

beforeEach(() => {
  clock = new FakeClock();
  clock.install();
  api = installBrowser();
});

afterEach(() => {
  clock.restore();
});

describe("tab tracking", () => {
  it("records a watch tab as it opens", async () => {
    await start();

    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await settle();

    assert.deepEqual(state().tabs, { 7: "abc" });
  });

  it("ignores a tab that is not on a watch page", async () => {
    await start();

    api.openTab({ id: 7, url: FEED_URL, windowId: 1 });
    await settle();

    assert.equal(api.storage.session.data.has("state"), false);
  });

  it("seeds state from tabs that were already open", async () => {
    api.tabs.records.push({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await start();

    api.openTab({ id: 8, url: watchUrl("def"), windowId: 1 });
    await settle();

    assert.deepEqual(state().tabs, { 7: "abc", 8: "def" });
  });

  it("serializes overlapping updates for the same tab", async () => {
    await start();

    api.openTab({ id: 8, url: watchUrl("abc"), windowId: 1 });
    api.storage.local.seed({ [entryKey("abc")]: saved });
    api.navigateTab(8, watchUrl("def"));
    await settle();

    assert.deepEqual(state().tabs, { 8: "def" });
    assert.deepEqual(state().closed, ["abc"]);
    assert.equal(held("abc"), false);
  });
});

describe("release", () => {
  it("drops the saved position when a tab navigates off the video", async () => {
    await start();
    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await settle();
    api.storage.local.seed({ [entryKey("abc")]: saved });

    api.navigateTab(7, FEED_URL);
    await settle();

    assert.equal(held("abc"), false);
    assert.deepEqual(state().closed, ["abc"]);
    assert.deepEqual(state().tabs, {});
  });

  it("drops the saved position when a tab closes", async () => {
    await start();
    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await settle();
    api.storage.local.seed({ [entryKey("abc")]: saved });

    api.closeTab(7);
    await settle();

    assert.equal(held("abc"), false);
    assert.deepEqual(state().closed, ["abc"]);
  });

  it("keeps the position while the same video is open in another tab", async () => {
    await start();
    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    api.openTab({ id: 8, url: watchUrl("abc"), windowId: 1 });
    await settle();
    api.storage.local.seed({ [entryKey("abc")]: saved });

    api.closeTab(7);
    await settle();

    assert.equal(held("abc"), true);
    assert.deepEqual(state().closed, []);
    assert.deepEqual(state().tabs, { 8: "abc" });
  });
});

describe("window close grace", () => {
  it("holds the release until the grace window passes", async () => {
    await start();
    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await settle();
    api.storage.local.seed({ [entryKey("abc")]: saved });

    api.closeTab(7, true);
    await settle();
    assert.equal(held("abc"), true);

    clock.advance(WINDOW_CLOSE_GRACE_MS);
    await settle();

    assert.equal(held("abc"), false);
  });

  it("keeps everything when the whole browser is shutting down", async () => {
    await start();
    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await settle();
    api.storage.local.seed({ [entryKey("abc")]: saved });
    api.windows.ids = [];

    api.closeTab(7, true);
    clock.advance(WINDOW_CLOSE_GRACE_MS);
    await settle();

    assert.equal(held("abc"), true);
    assert.deepEqual(state().tabs, { 7: "abc" });
  });
});

describe("storage listener", () => {
  it("removes a late write for a video that was already released", async () => {
    await start();
    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await settle();
    api.storage.local.seed({ [entryKey("abc")]: saved });
    api.closeTab(7);
    await settle();

    await api.storage.local.set({ [entryKey("abc")]: saved });
    await settle();

    assert.equal(held("abc"), false);
  });

  it("keeps a write once the video has been reopened", async () => {
    await start();
    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await settle();
    api.storage.local.seed({ [entryKey("abc")]: saved });
    api.closeTab(7);
    await settle();
    assert.deepEqual(state().closed, ["abc"]);

    api.openTab({ id: 9, url: watchUrl("abc"), windowId: 1 });
    await settle();
    assert.deepEqual(state().closed, []);

    await api.storage.local.set({ [entryKey("abc")]: saved });
    await settle();

    assert.equal(held("abc"), true);
  });

  it("ignores writes that are not saved positions", async () => {
    await start();
    api.openTab({ id: 7, url: watchUrl("abc"), windowId: 1 });
    await settle();
    api.closeTab(7);
    await settle();

    await api.storage.local.set({ "meta:lastCleanup": clock.now });
    await settle();

    assert.equal(api.storage.local.data.get("meta:lastCleanup"), clock.now);
  });
});
