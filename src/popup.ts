import { entryKey, formatClock, isEntryKey, readEntries, readOpenTabs } from "./shared.ts";
import type { OpenTab } from "./shared.ts";

const list = document.querySelector<HTMLUListElement>("#list");
const empty = document.querySelector<HTMLParagraphElement>("#empty");
const clearAll = document.querySelector<HTMLButtonElement>("#clear");

const watchUrl = (videoId: string, position: number): string =>
  `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(position)}s`;

const focusTab = async (tab: OpenTab): Promise<void> => {
  await browser.tabs.update(tab.tabId, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
  window.close();
};

const render = async (): Promise<void> => {
  if (!list || !empty) return;

  const [entries, openTabs] = await Promise.all([readEntries(), readOpenTabs()]);
  list.replaceChildren();
  empty.hidden = entries.length > 0;

  for (const entry of entries) {
    const item = document.createElement("li");
    const openTab = openTabs.get(entry.id);

    const dot = document.createElement("span");
    dot.className = openTab ? "dot open" : "dot";
    dot.title = openTab ? "Still open in a tab" : "Not open in any tab";

    const link = document.createElement("a");
    link.href = watchUrl(entry.id, entry.position);
    link.target = "_blank";
    link.rel = "noreferrer";

    if (openTab) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void focusTab(openTab);
      });
    }

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = entry.title || entry.id;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = entry.duration
      ? `${formatClock(entry.position)} / ${formatClock(entry.duration)}`
      : formatClock(entry.position);

    link.append(title, meta);

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "Forget this video";
    remove.addEventListener("click", () => {
      void browser.storage.local.remove(entryKey(entry.id)).then(render);
    });

    item.append(dot, link, remove);
    list.append(item);
  }
};

clearAll?.addEventListener("click", () => {
  void browser.storage.local
    .get(null)
    .then((all) => browser.storage.local.remove(Object.keys(all).filter(isEntryKey)))
    .then(render);
});

void render();
