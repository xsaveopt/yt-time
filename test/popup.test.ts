import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { entryKey } from "../src/shared.ts";
import type { Entry } from "../src/shared.ts";
import { installBrowser } from "./fake-browser.ts";
import type { FakeBrowser } from "./fake-browser.ts";
import { FakeElement, installDom } from "./fake-dom.ts";
import type { Dom } from "./fake-dom.ts";
import { FakeClock, loadModule, settle, watchUrl } from "./harness.ts";

let api: FakeBrowser;
let dom: Dom;
let clock: FakeClock;
let list: FakeElement;
let empty: FakeElement;
let clear: FakeElement;

const stored = (position: number, title: string, updated: number): Entry => ({
  position,
  duration: 1200,
  title,
  updated,
});

const open = async (): Promise<void> => {
  await loadModule("popup");
  await settle();
};

const rows = (): FakeElement[] => list.children;

const parts = (row: FakeElement): { dot: FakeElement; link: FakeElement; remove: FakeElement } => {
  const [dot, link, remove] = row.children;
  if (!dot || !link || !remove) throw new Error("unexpected row shape");
  return { dot, link, remove };
};

beforeEach(() => {
  clock = new FakeClock();
  clock.install();
  api = installBrowser();
  dom = installDom();
  list = new FakeElement("ul");
  empty = new FakeElement("p");
  clear = new FakeElement("button");
  dom.document.elements.set("#list", list);
  dom.document.elements.set("#empty", empty);
  dom.document.elements.set("#clear", clear);
});

afterEach(() => {
  clock.restore();
});

describe("render", () => {
  it("lists saved positions newest first", async () => {
    api.storage.local.seed({
      [entryKey("older")]: stored(300.7, "Older video", 100),
      [entryKey("newer")]: stored(65, "Newer video", 200),
      "meta:lastCleanup": 1,
    });

    await open();

    assert.equal(empty.hidden, true);
    assert.equal(rows().length, 2);

    const first = parts(rows()[0] as FakeElement);
    assert.equal(first.link.href, `${watchUrl("newer")}&t=65s`);
    assert.equal(first.link.children[0]?.textContent, "Newer video");
    assert.equal(first.link.children[1]?.textContent, "1:05 / 20:00");
    assert.equal(first.dot.className, "dot");

    const second = parts(rows()[1] as FakeElement);
    assert.equal(second.link.href, `${watchUrl("older")}&t=300s`);
  });

  it("shows the empty note when nothing is saved", async () => {
    await open();

    assert.equal(empty.hidden, false);
    assert.equal(rows().length, 0);
  });

  it("falls back to the video id when the title is missing", async () => {
    api.storage.local.seed({ [entryKey("abc")]: stored(300, "", 1) });

    await open();

    assert.equal(parts(rows()[0] as FakeElement).link.children[0]?.textContent, "abc");
  });

  it("marks an entry that is still open in a tab", async () => {
    api.storage.local.seed({ [entryKey("abc")]: stored(300, "Open video", 1) });
    api.tabs.records.push({ id: 7, url: watchUrl("abc"), windowId: 3 });

    await open();

    assert.equal(parts(rows()[0] as FakeElement).dot.className, "dot open");
  });
});

describe("focus tab", () => {
  it("focuses the existing tab instead of following the link", async () => {
    api.storage.local.seed({ [entryKey("abc")]: stored(300, "Open video", 1) });
    api.tabs.records.push({ id: 7, url: watchUrl("abc"), windowId: 3 });
    await open();

    const followed = parts(rows()[0] as FakeElement).link.click();
    await settle();

    assert.equal(followed, false);
    assert.deepEqual(api.tabs.updates, [{ tabId: 7, props: { active: true } }]);
    assert.deepEqual(api.windows.updates, [{ windowId: 3, props: { focused: true } }]);
    assert.equal(dom.window.closeCount, 1);
  });

  it("follows the link when the video is not open anywhere", async () => {
    api.storage.local.seed({ [entryKey("abc")]: stored(300, "Closed video", 1) });
    await open();

    const followed = parts(rows()[0] as FakeElement).link.click();
    await settle();

    assert.equal(followed, true);
    assert.deepEqual(api.tabs.updates, []);
    assert.equal(dom.window.closeCount, 0);
  });
});

describe("removal", () => {
  it("forgets one entry and re-renders", async () => {
    api.storage.local.seed({
      [entryKey("abc")]: stored(300, "First", 200),
      [entryKey("def")]: stored(400, "Second", 100),
    });
    await open();

    parts(rows()[0] as FakeElement).remove.click();
    await settle();

    assert.equal(api.storage.local.data.has(entryKey("abc")), false);
    assert.equal(rows().length, 1);
    assert.equal(parts(rows()[0] as FakeElement).link.children[0]?.textContent, "Second");
  });

  it("clears every entry but leaves the housekeeping keys", async () => {
    api.storage.local.seed({
      [entryKey("abc")]: stored(300, "First", 200),
      [entryKey("def")]: stored(400, "Second", 100),
      "meta:lastCleanup": 1234,
    });
    await open();

    clear.click();
    await settle();

    assert.deepEqual(api.storage.local.snapshot(), { "meta:lastCleanup": 1234 });
    assert.equal(rows().length, 0);
    assert.equal(empty.hidden, false);
  });
});
