import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  entryKey,
  ENTRY_TTL_MS,
  FORGET_GRACE_MS,
  MAX_PROGRESS,
  MIN_POSITION_SECONDS,
  MIN_REMAINING_SECONDS,
  formatClock,
  isEntryKey,
  isStale,
  readEntries,
  readOpenTabs,
  shouldForget,
  videoIdFromKey,
  videoIdFromUrl,
  worthKeeping,
} from "../src/shared.ts";
import type { Entry } from "../src/shared.ts";
import { installBrowser } from "./fake-browser.ts";
import type { FakeBrowser } from "./fake-browser.ts";
import { watchUrl } from "./harness.ts";

const entry = (updated: number): Entry => ({
  position: 300,
  duration: 1200,
  title: "example",
  updated,
});

describe("worthKeeping", () => {
  it("keeps a position in the middle of a long video", () => {
    assert.equal(worthKeeping(300, 1200), true);
  });

  it("drops a position near the start", () => {
    assert.equal(worthKeeping(42, 1200), false);
  });

  it("drops a position near the end by remaining time", () => {
    assert.equal(worthKeeping(1150, 1200), false);
  });

  it("drops a position past the progress ceiling", () => {
    assert.equal(worthKeeping(9700, 10000), false);
  });

  it("drops non-finite or zero-length input", () => {
    assert.equal(worthKeeping(Number.NaN, 1200), false);
    assert.equal(worthKeeping(300, Number.POSITIVE_INFINITY), false);
    assert.equal(worthKeeping(300, 0), false);
  });

  it("rejects a short video where no position clears both margins", () => {
    assert.equal(worthKeeping(70, 140), false);
  });
});

describe("shouldForget", () => {
  it("never forgets a position worth keeping", () => {
    assert.equal(shouldForget(300, 1200, 60_000, true), false);
  });

  it("holds off during the grace window after load", () => {
    assert.equal(shouldForget(0, 1200, 0, true), false);
    assert.equal(shouldForget(0, 1200, FORGET_GRACE_MS - 1, true), false);
  });

  it("forgets a near-start position once the grace window passes", () => {
    assert.equal(shouldForget(5, 1200, FORGET_GRACE_MS, true), true);
  });

  it("forgets a near-end position once the grace window passes", () => {
    assert.equal(shouldForget(1190, 1200, 60_000, true), true);
  });

  it("never forgets when playback never started", () => {
    assert.equal(shouldForget(0, 1200, 60_000, false), false);
    assert.equal(shouldForget(0, Number.NaN, 60_000, false), false);
    assert.equal(shouldForget(1190, 1200, 60_000, false), false);
  });
});

describe("isStale", () => {
  const now = 1_700_000_000_000;

  it("keeps a recent entry", () => {
    assert.equal(isStale(entry(now - 1000), now), false);
  });

  it("drops an entry past the ttl", () => {
    assert.equal(isStale(entry(now - ENTRY_TTL_MS - 1), now), true);
  });

  it("drops a missing or malformed entry", () => {
    assert.equal(isStale(undefined, now), true);
    assert.equal(isStale({ position: 1, duration: 2, title: "x" } as Entry, now), true);
  });
});

describe("formatClock", () => {
  it("formats under an hour", () => {
    assert.equal(formatClock(754), "12:34");
  });

  it("formats over an hour with padding", () => {
    assert.equal(formatClock(3725), "1:02:05");
  });

  it("clamps negatives", () => {
    assert.equal(formatClock(-5), "0:00");
  });
});

describe("keys", () => {
  it("round-trips a video id", () => {
    const key = entryKey("Ab3_cD-4eFg");
    assert.equal(isEntryKey(key), true);
    assert.equal(videoIdFromKey(key), "Ab3_cD-4eFg");
  });

  it("ignores non-entry keys", () => {
    assert.equal(isEntryKey("meta:lastCleanup"), false);
  });
});

describe("videoIdFromUrl", () => {
  it("reads the id from a watch url", () => {
    assert.equal(videoIdFromUrl("https://www.youtube.com/watch?v=abc123&t=90s"), "abc123");
  });

  it("accepts other youtube subdomains", () => {
    assert.equal(videoIdFromUrl("https://m.youtube.com/watch?v=abc123"), "abc123");
  });

  it("ignores non-watch pages", () => {
    assert.equal(videoIdFromUrl("https://www.youtube.com/feed/subscriptions"), null);
  });

  it("ignores lookalike hosts", () => {
    assert.equal(videoIdFromUrl("https://notyoutube.com/watch?v=abc123"), null);
  });

  it("ignores missing or malformed input", () => {
    assert.equal(videoIdFromUrl(undefined), null);
    assert.equal(videoIdFromUrl("watch?v=abc123"), null);
  });
});

describe("readEntries", () => {
  let api: FakeBrowser;

  beforeEach(() => {
    api = installBrowser();
  });

  it("returns entries newest first with the id attached", async () => {
    api.storage.local.seed({
      "v:older": { ...entry(100), title: "older" },
      "v:newer": { ...entry(200), title: "newer" },
      "meta:lastCleanup": 1234,
    });

    const entries = await readEntries();

    assert.deepEqual(
      entries.map((item) => item.id),
      ["newer", "older"],
    );
    assert.equal(entries[0]?.title, "newer");
    assert.equal(entries[0]?.position, 300);
  });

  it("returns nothing when storage holds no entries", async () => {
    api.storage.local.seed({ "meta:lastCleanup": 1234 });
    assert.deepEqual(await readEntries(), []);
  });
});

describe("readOpenTabs", () => {
  let api: FakeBrowser;

  beforeEach(() => {
    api = installBrowser();
  });

  it("maps each open watch tab to its tab and window", async () => {
    api.tabs.records.push(
      { id: 7, url: watchUrl("abc"), windowId: 3 },
      { id: 8, url: "https://www.youtube.com/feed/subscriptions", windowId: 3 },
    );

    const open = await readOpenTabs();

    assert.deepEqual(open.get("abc"), { tabId: 7, windowId: 3 });
    assert.equal(open.size, 1);
  });

  it("keeps the first tab when the same video is open twice", async () => {
    api.tabs.records.push(
      { id: 7, url: watchUrl("abc"), windowId: 3 },
      { id: 9, url: `${watchUrl("abc")}&t=30s`, windowId: 4 },
    );

    const open = await readOpenTabs();

    assert.deepEqual(open.get("abc"), { tabId: 7, windowId: 3 });
  });

  it("falls back to the current window when a tab reports none", async () => {
    api.tabs.records.push({ id: 7, url: watchUrl("abc") });

    const open = await readOpenTabs();

    assert.deepEqual(open.get("abc"), { tabId: 7, windowId: api.windows.WINDOW_ID_CURRENT });
  });

  it("returns an empty map when the tabs query fails", async () => {
    api.tabs.records.push({ id: 7, url: watchUrl("abc"), windowId: 3 });
    api.tabs.queryError = new Error("no permission");

    assert.equal((await readOpenTabs()).size, 0);
  });
});

describe("worthKeeping boundaries", () => {
  it("keeps a position exactly at the minimum", () => {
    assert.equal(worthKeeping(MIN_POSITION_SECONDS, 1200), true);
    assert.equal(worthKeeping(MIN_POSITION_SECONDS - 0.01, 1200), false);
  });

  it("keeps a position with exactly the minimum time remaining", () => {
    assert.equal(worthKeeping(1200 - MIN_REMAINING_SECONDS, 1200), true);
    assert.equal(worthKeeping(1200 - MIN_REMAINING_SECONDS + 0.01, 1200), false);
  });

  it("keeps a position exactly at the progress ceiling", () => {
    assert.equal(worthKeeping(10000 * MAX_PROGRESS, 10000), true);
    assert.equal(worthKeeping(10000 * MAX_PROGRESS + 1, 10000), false);
  });

  it("drops a negative duration and a non-finite position", () => {
    assert.equal(worthKeeping(300, -1200), false);
    assert.equal(worthKeeping(Number.POSITIVE_INFINITY, 1200), false);
  });
});

describe("isStale boundaries", () => {
  const now = 1_700_000_000_000;

  it("keeps an entry exactly at the ttl", () => {
    assert.equal(isStale(entry(now - ENTRY_TTL_MS), now), false);
  });
});

describe("formatClock boundaries", () => {
  it("floors fractional seconds", () => {
    assert.equal(formatClock(59.9), "0:59");
  });

  it("rolls over to hours at exactly one hour", () => {
    assert.equal(formatClock(3600), "1:00:00");
    assert.equal(formatClock(3599), "59:59");
  });
});

describe("videoIdFromUrl edge cases", () => {
  it("accepts the bare domain and plain http", () => {
    assert.equal(videoIdFromUrl("http://youtube.com/watch?v=abc123"), "abc123");
  });

  it("accepts an uppercase host", () => {
    assert.equal(videoIdFromUrl("https://WWW.YOUTUBE.COM/watch?v=abc123"), "abc123");
  });

  it("returns null when the watch url has no video id", () => {
    assert.equal(videoIdFromUrl("https://www.youtube.com/watch"), null);
    assert.equal(videoIdFromUrl("https://www.youtube.com/watch?list=abc123"), null);
  });

  it("returns null when the video id is empty", () => {
    assert.equal(videoIdFromUrl("https://www.youtube.com/watch?v="), null);
  });

  it("ignores a host that only starts with youtube.com", () => {
    assert.equal(videoIdFromUrl("https://youtube.com.example.test/watch?v=abc123"), null);
  });

  it("ignores paths that only resemble the watch page", () => {
    assert.equal(videoIdFromUrl("https://www.youtube.com/watch/abc123"), null);
    assert.equal(videoIdFromUrl("https://www.youtube.com/shorts/abc123"), null);
  });

  it("takes the first id when the parameter repeats", () => {
    assert.equal(videoIdFromUrl("https://www.youtube.com/watch?v=abc123&v=def456"), "abc123");
  });
});

describe("readEntries ordering", () => {
  let api: FakeBrowser;

  beforeEach(() => {
    api = installBrowser();
  });

  it("puts entries without an updated time last", async () => {
    const { updated: _updated, ...undated } = entry(0);
    api.storage.local.seed({
      "v:undated": undated,
      "v:dated": entry(100),
    });

    const entries = await readEntries();

    assert.deepEqual(
      entries.map((item) => item.id),
      ["dated", "undated"],
    );
  });
});
