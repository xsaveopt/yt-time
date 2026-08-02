import { entryKey, formatClock, isEntryKey, readEntries } from "./shared.ts";

const list = document.querySelector<HTMLUListElement>("#list");
const empty = document.querySelector<HTMLParagraphElement>("#empty");
const clearAll = document.querySelector<HTMLButtonElement>("#clear");

const watchUrl = (videoId: string, position: number): string =>
  `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(position)}s`;

const render = async (): Promise<void> => {
  if (!list || !empty) return;

  const entries = await readEntries();
  list.replaceChildren();
  empty.hidden = entries.length > 0;

  for (const entry of entries) {
    const item = document.createElement("li");

    const link = document.createElement("a");
    link.href = watchUrl(entry.id, entry.position);
    link.target = "_blank";
    link.rel = "noreferrer";

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

    item.append(link, remove);
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
