interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/** Map-based cache with O(1) lazy expiry on read. */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.clock() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number = this.ttlMs): void {
    if (ttlMs <= 0) {
      this.entries.delete(key);
      return;
    }
    this.entries.set(key, { value, expiresAt: this.clock() + ttlMs });
  }

  getOrCompute(key: K, compute: () => V, ttlMs: number = this.ttlMs): V {
    const entry = this.entries.get(key);
    const now = this.clock();
    if (entry !== undefined && now < entry.expiresAt) return entry.value;
    const value = compute();
    if (ttlMs > 0) this.entries.set(key, { value, expiresAt: now + ttlMs });
    else this.entries.delete(key);
    return value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
