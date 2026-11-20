import type { AccountSnapshot } from "./types.ts";
/** Cache projected counters only. No credentials, prompts or response bodies. */
export class AccountCache {
  private readonly entries = new Map<string, { checkedAt: number; snapshot?: AccountSnapshot; pending?: Promise<AccountSnapshot> }>();
  constructor(private readonly now = Date.now, private readonly ttlMs = 60_000) {}
  clear(): void { this.entries.clear(); }
  read(key: string, load: () => Promise<AccountSnapshot>): Promise<AccountSnapshot> {
    let entry = this.entries.get(key);
    if (entry?.pending) return entry.pending;
    if (entry?.snapshot && this.now() - entry.checkedAt < this.ttlMs) return Promise.resolve(entry.snapshot);
    if (!entry) {
      if (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
      entry = { checkedAt: 0 }; this.entries.set(key, entry);
    }
    const current = entry;
    current.pending = load().then((next) => {
      current.checkedAt = this.now();
      current.snapshot = next.status === "unavailable" && current.snapshot?.meters.length
        ? { ...current.snapshot, status: "stale", note: next.note } : next;
      return current.snapshot;
    }).finally(() => { delete current.pending; });
    return current.pending;
  }
}
