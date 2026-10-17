/**
 * Object pool for transient simulation/render entities. The sim runs at a fixed rate on
 * low-end phones; garbage collection spikes are visible as hitches, so anything created
 * per-event (impacts, projectiles, particles, network snapshots) comes from a pool.
 */
export class Pool<T> {
  private free: T[] = [];
  private liveCount = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(factory());
  }

  acquire(): T {
    this.liveCount++;
    const item = this.free.pop();
    return item ?? this.factory();
  }

  release(item: T): void {
    this.reset(item);
    this.liveCount--;
    this.free.push(item);
  }

  get live(): number {
    return this.liveCount;
  }

  get pooled(): number {
    return this.free.length;
  }
}

/** Fixed-capacity ring buffer — input history for prediction, snapshot history for interpolation. */
export class RingBuffer<T> {
  private items: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = Array.from({ length: capacity }, () => undefined as T | undefined);
  }

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** 0 = most recently pushed. */
  at(indexFromNewest: number): T | undefined {
    if (indexFromNewest < 0 || indexFromNewest >= this.count) return undefined;
    const i = (this.head - 1 - indexFromNewest + this.capacity * 2) % this.capacity;
    return this.items[i];
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  toArrayOldestFirst(): T[] {
    const out: T[] = [];
    for (let i = this.count - 1; i >= 0; i--) {
      const v = this.at(i);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
}
