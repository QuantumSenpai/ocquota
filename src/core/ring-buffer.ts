/** Fixed-capacity circular buffer with O(1) push, shift, first, and last. */
export class RingBuffer<T> {
  private readonly items: Array<T | undefined>;
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got ${capacity}.`);
    }
    this.items = new Array<T | undefined>(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(item: T): void {
    if (this.count < this.capacity) {
      this.items[(this.head + this.count) % this.capacity] = item;
      this.count += 1;
      return;
    }
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
  }

  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count -= 1;
    return item;
  }

  first(): T | undefined {
    return this.count === 0 ? undefined : this.items[this.head];
  }

  last(): T | undefined {
    if (this.count === 0) return undefined;
    return this.items[(this.head + this.count - 1) % this.capacity];
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const item = this.items[(this.head + i) % this.capacity];
      if (item !== undefined) out.push(item);
    }
    return out;
  }
}
