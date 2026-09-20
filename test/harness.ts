import { setImmediate as immediate } from "node:timers/promises";

type PendingTimer = { id: number; at: number; fn: () => void };
type Interval = { id: number; every: number; fn: () => void };

export class FakeClock {
  now = 1_700_000_000_000;
  readonly intervals: Interval[] = [];
  timers: PendingTimer[] = [];
  nextId = 1;
  saved: Record<string, unknown> = {};
  savedDateNow: () => number = Date.now;

  install = (): void => {
    this.saved = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    };
    this.savedDateNow = Date.now;
    Object.assign(globalThis, {
      setTimeout: (fn: () => void, ms = 0) => {
        const id = this.nextId++;
        this.timers.push({ id, at: this.now + ms, fn });
        return id;
      },
      clearTimeout: (id: number) => {
        this.timers = this.timers.filter((timer) => timer.id !== id);
      },
      setInterval: (fn: () => void, ms = 0) => {
        const id = this.nextId++;
        this.intervals.push({ id, every: ms, fn });
        return id;
      },
      clearInterval: (id: number) => {
        const index = this.intervals.findIndex((interval) => interval.id === id);
        if (index >= 0) this.intervals.splice(index, 1);
      },
    });
    Date.now = (): number => this.now;
  };

  restore = (): void => {
    Object.assign(globalThis, this.saved);
    Date.now = this.savedDateNow;
  };

  advance = (ms: number): void => {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)
        .at(0);
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  };

  runInterval = (index = 0): void => {
    const interval = this.intervals.at(index);
    if (!interval) throw new Error(`no interval at ${index}`);
    interval.fn();
  };
}

export const settle = async (rounds = 6): Promise<void> => {
  for (let round = 0; round < rounds; round += 1) await immediate();
};

let counter = 0;

export const loadModule = async (name: string): Promise<Record<string, unknown>> => {
  counter += 1;
  return await import(`../src/${name}.ts?case=${counter}`);
};

export const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;
