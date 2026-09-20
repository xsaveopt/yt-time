export class FakeElement extends EventTarget {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  className = "";
  title = "";
  href = "";
  target = "";
  rel = "";
  textContent = "";
  hidden = false;

  constructor(tagName: string) {
    super();
    this.tagName = tagName;
  }

  append = (...nodes: FakeElement[]): void => {
    this.children.push(...nodes);
  };

  replaceChildren = (...nodes: FakeElement[]): void => {
    this.children.length = 0;
    this.children.push(...nodes);
  };

  click = (): boolean => this.dispatchEvent(new Event("click", { cancelable: true }));
}

export class FakeVideo extends EventTarget {
  currentTime = 0;
  duration = Number.NaN;
  readyState = 0;
  error: unknown = null;

  emit = (type: string): void => {
    this.dispatchEvent(new Event(type));
  };
}

export class FakeDocument extends EventTarget {
  readonly elements = new Map<string, FakeElement>();
  readonly created: FakeElement[] = [];
  title = "";
  visibilityState = "visible";
  video: FakeVideo | null = null;

  querySelector = (selector: string): unknown => {
    if (selector === "video" || selector === "video.html5-main-video") return this.video;
    return this.elements.get(selector) ?? null;
  };

  createElement = (tagName: string): FakeElement => {
    const element = new FakeElement(tagName);
    this.created.push(element);
    return element;
  };

  emit = (type: string): void => {
    this.dispatchEvent(new Event(type));
  };
}

export class FakeWindow extends EventTarget {
  closeCount = 0;

  close = (): void => {
    this.closeCount += 1;
  };

  emit = (type: string): void => {
    this.dispatchEvent(new Event(type));
  };
}

export type Dom = {
  document: FakeDocument;
  window: FakeWindow;
  location: { href: string; search: string };
  setUrl: (href: string) => void;
};

export const installDom = (href = "https://www.youtube.com/"): Dom => {
  const doc = new FakeDocument();
  const win = new FakeWindow();
  const location = { href: "", search: "" };
  const setUrl = (next: string): void => {
    const parsed = new URL(next);
    location.href = next;
    location.search = parsed.search;
  };
  setUrl(href);
  Object.assign(globalThis, {
    document: doc,
    window: win,
    location,
    HTMLMediaElement: { HAVE_NOTHING: 0, HAVE_METADATA: 1, HAVE_ENOUGH_DATA: 4 },
  });
  return { document: doc, window: win, location, setUrl };
};
