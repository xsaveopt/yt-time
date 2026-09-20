export type StorageChange = { oldValue?: unknown; newValue?: unknown };

export type ChangeReport = (changes: Record<string, StorageChange>, area: string) => void;

export type FakeTab = { id: number; url?: string; windowId?: number };

export class FakeEvent<A extends unknown[]> {
  readonly listeners: Array<(...args: A) => void> = [];

  addListener = (fn: (...args: A) => void): void => {
    this.listeners.push(fn);
  };

  removeListener = (fn: (...args: A) => void): void => {
    const index = this.listeners.indexOf(fn);
    if (index >= 0) this.listeners.splice(index, 1);
  };

  hasListener = (fn: (...args: A) => void): boolean => this.listeners.includes(fn);

  emit = (...args: A): void => {
    for (const fn of this.listeners.slice()) fn(...args);
  };
}

const escapeLiteral = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const patternToRegExp = (pattern: string): RegExp => {
  const [scheme = "*", rest = ""] = pattern.split("://");
  const slash = rest.indexOf("/");
  const host = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "/*" : rest.slice(slash);
  const schemePart = scheme === "*" ? "https?" : escapeLiteral(scheme);
  const hostPart = host.startsWith("*.")
    ? `(?:[^/]+\\.)?${escapeLiteral(host.slice(2))}`
    : host === "*"
      ? "[^/]+"
      : escapeLiteral(host);
  const pathPart = path.split("*").map(escapeLiteral).join(".*");
  return new RegExp(`^${schemePart}://${hostPart}${pathPart}$`);
};

export class FakeStorageArea {
  readonly data = new Map<string, unknown>();
  readonly name: string;
  readonly report: ChangeReport;

  constructor(name: string, report: ChangeReport) {
    this.name = name;
    this.report = report;
  }

  seed = (items: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(items)) this.data.set(key, structuredClone(value));
  };

  snapshot = (): Record<string, unknown> => Object.fromEntries(structuredClone([...this.data]));

  get = async (keys?: string | string[] | null): Promise<Record<string, unknown>> => {
    const wanted =
      keys === undefined || keys === null
        ? [...this.data.keys()]
        : Array.isArray(keys)
          ? keys
          : [keys];
    const out: Record<string, unknown> = {};
    for (const key of wanted) {
      if (this.data.has(key)) out[key] = structuredClone(this.data.get(key));
    }
    return out;
  };

  set = async (items: Record<string, unknown>): Promise<void> => {
    const changes: Record<string, StorageChange> = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = {
        oldValue: structuredClone(this.data.get(key)),
        newValue: structuredClone(value),
      };
      this.data.set(key, structuredClone(value));
    }
    if (Object.keys(changes).length > 0) this.report(changes, this.name);
  };

  remove = async (keys: string | string[]): Promise<void> => {
    const changes: Record<string, StorageChange> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (!this.data.has(key)) continue;
      changes[key] = { oldValue: structuredClone(this.data.get(key)), newValue: undefined };
      this.data.delete(key);
    }
    if (Object.keys(changes).length > 0) this.report(changes, this.name);
  };

  clear = async (): Promise<void> => {
    await this.remove([...this.data.keys()]);
  };
}

export class FakeTabs {
  readonly records: FakeTab[] = [];
  readonly updates: Array<{ tabId: number; props: Record<string, unknown> }> = [];
  readonly onCreated = new FakeEvent<[FakeTab]>();
  readonly onUpdated = new FakeEvent<[number, Record<string, unknown>, FakeTab]>();
  readonly onRemoved = new FakeEvent<[number, { isWindowClosing: boolean }]>();
  queryError: Error | null = null;

  query = async (info: { url?: string }): Promise<FakeTab[]> => {
    if (this.queryError) throw this.queryError;
    if (info.url === undefined) return [...this.records];
    const matcher = patternToRegExp(info.url);
    return this.records.filter((tab) => tab.url !== undefined && matcher.test(tab.url));
  };

  update = async (tabId: number, props: Record<string, unknown>): Promise<void> => {
    this.updates.push({ tabId, props });
  };
}

export class FakeWindows {
  readonly WINDOW_ID_CURRENT = -2;
  readonly updates: Array<{ windowId: number; props: Record<string, unknown> }> = [];
  ids: number[] = [1];

  getAll = async (): Promise<Array<{ id: number }>> => this.ids.map((id) => ({ id }));

  update = async (windowId: number, props: Record<string, unknown>): Promise<void> => {
    this.updates.push({ windowId, props });
  };
}

export class FakeBrowser {
  readonly tabs = new FakeTabs();
  readonly windows = new FakeWindows();
  readonly storage: {
    local: FakeStorageArea;
    session: FakeStorageArea;
    onChanged: FakeEvent<[Record<string, StorageChange>, string]>;
  };

  constructor() {
    const onChanged = new FakeEvent<[Record<string, StorageChange>, string]>();
    this.storage = {
      onChanged,
      local: new FakeStorageArea("local", onChanged.emit),
      session: new FakeStorageArea("session", onChanged.emit),
    };
  }

  openTab = (tab: FakeTab): void => {
    this.tabs.records.push({ ...tab });
    const record = this.tabs.records.at(-1);
    if (record) this.tabs.onCreated.emit(record);
  };

  navigateTab = (tabId: number, url: string | undefined): void => {
    const record = this.tabs.records.find((tab) => tab.id === tabId);
    if (!record) throw new Error(`no tab ${tabId}`);
    record.url = url;
    this.tabs.onUpdated.emit(tabId, { url }, record);
  };

  closeTab = (tabId: number, isWindowClosing = false): void => {
    const index = this.tabs.records.findIndex((tab) => tab.id === tabId);
    if (index >= 0) this.tabs.records.splice(index, 1);
    this.tabs.onRemoved.emit(tabId, { isWindowClosing });
  };
}

export const installBrowser = (): FakeBrowser => {
  const fake = new FakeBrowser();
  Object.assign(globalThis, { browser: fake });
  return fake;
};
