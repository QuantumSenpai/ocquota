import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { OcquotaError } from "../core/errors.ts";
import { startOfDay, type TimeZone } from "../core/time.ts";
import type { DailyBucket, ModelTotals, SessionTotals, TokenUsage, Totals, UsageTotals, WindowRange } from "../core/types.ts";
import { CodexSessionParser, type CodexUsageEvent } from "./codex-session.ts";
import type { QueryPlan, UsageRepository } from "./repository.ts";

interface FileCache {
  size: number;
  mtimeMs: number;
  ino: number;
  offset: number;
  pending: string;
  decoder: StringDecoder;
  parser: CodexSessionParser;
}

function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function sum(rows: readonly CodexUsageEvent[]): UsageTotals {
  const tokens = emptyTokens();
  let totalTokens = 0;
  let lastActivityAt: number | null = null;
  for (const row of rows) {
    for (const key of Object.keys(tokens) as (keyof TokenUsage)[]) tokens[key] += row.tokens[key];
    totalTokens += row.totalTokens;
    lastActivityAt = Math.max(lastActivityAt ?? row.timestamp, row.timestamp);
  }
  return { tokens, totalTokens, lastActivityAt, cost: 0, messages: rows.length, sessions: new Set(rows.map((row) => row.sessionId)).size };
}

/** Read-only JSONL adapter. Cache parsed usage; read only appended bytes on refresh. */
export class CodexUsageRepository implements UsageRepository {
  readonly source = "codex";
  private readonly files = new Map<string, FileCache>();
  private readonly directories: string[];

  constructor(readonly home: string) {
    this.directories = [join(home, "sessions"), join(home, "archived_sessions")];
    if (!this.directories.some((dir) => existsSync(dir))) {
      throw new OcquotaError("CODEX_SESSIONS_MISSING", `No Codex sessions found in ${home}. Run Codex first, or set --codex-home / OCQUOTA_CODEX_HOME to your Codex home directory.`);
    }
  }

  usageInRange(range: WindowRange): UsageTotals { return sum(this.rows(range)); }
  totalsSince(from: number): Totals { return { ...this.usageInRange({ start: from, end: Infinity }), from }; }
  totalsByModel(from: number): ModelTotals[] { return this.totalsByModelInRange({ start: from, end: Infinity }); }

  totalsByModelInRange(range: WindowRange): ModelTotals[] {
    const groups = new Map<string, CodexUsageEvent[]>();
    for (const row of this.rows(range)) {
      const key = JSON.stringify([row.providerId, row.modelId]);
      const group = groups.get(key) ?? [];
      group.push(row); groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({ ...sum(group), providerId: group[0]!.providerId, modelId: group[0]!.modelId }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }

  sessionIdsInRange(range: WindowRange): string[] { return [...new Set(this.rows(range).map((row) => row.sessionId))]; }

  dailyBuckets(from: number, to: number, timeZone: TimeZone): DailyBucket[] {
    const groups = new Map<number, CodexUsageEvent[]>();
    for (const row of this.rows({ start: from, end: to })) {
      const day = startOfDay(timeZone, row.timestamp);
      const group = groups.get(day) ?? [];
      group.push(row); groups.set(day, group);
    }
    return [...groups].map(([dayStart, group]) => ({ ...sum(group), dayStart })).sort((a, b) => a.dayStart - b.dayStart);
  }

  topSessions(from: number, n: number): SessionTotals[] {
    const groups = new Map<string, CodexUsageEvent[]>();
    for (const row of this.rows({ start: from, end: Infinity })) {
      const group = groups.get(row.sessionId) ?? [];
      group.push(row); groups.set(row.sessionId, group);
    }
    return [...groups].map(([sessionId, group]) => {
      const totals = sum(group);
      return { ...totals, sessionId, title: null, lastActivityAt: totals.lastActivityAt! };
    })
      .sort((a, b) => b.totalTokens - a.totalTokens).slice(0, Math.max(0, Math.trunc(n)));
  }

  explainAll(): QueryPlan[] {
    return [{ name: "Codex JSONL reader (no SQL)", lines: ["Read-only sessions/ and archived_sessions/; plain and Zstandard JSONL.",
      "Cache per file; read appended bytes; deduplicate response IDs and repeated usage snapshots.", "Filter by usage-event time, then aggregate tokens in memory."] }];
  }

  private rows(range: WindowRange): CodexUsageEvent[] {
    const paths = new Set<string>();
    try {
      for (const dir of this.directories) this.walk(dir, paths);
      for (const path of paths) this.refresh(path);
    } catch (cause) {
      throw new OcquotaError("CODEX_READ_FAILED", `Cannot read Codex session logs in ${this.home}. Check directory permissions and compressed file integrity.`, { cause });
    }
    for (const path of this.files.keys()) if (!paths.has(path)) this.files.delete(path);
    const seen = new Set<string>();
    const rows: CodexUsageEvent[] = [];
    for (const file of this.files.values()) {
      for (const row of file.parser.events) {
        if (seen.has(row.key)) continue;
        seen.add(row.key);
        if (row.timestamp >= range.start && row.timestamp < range.end) rows.push(row);
      }
    }
    return rows;
  }

  private walk(dir: string, paths: Set<string>): void {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) this.walk(path, paths);
      else if (entry.isFile() && /\.jsonl(?:\.zst)?$/.test(entry.name)) paths.add(path);
    }
  }

  private refresh(path: string): void {
    let stat;
    try { stat = statSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { this.files.delete(path); return; } throw error; }
    let cache = this.files.get(path);
    if (cache && cache.size === stat.size && cache.mtimeMs === stat.mtimeMs && cache.ino === stat.ino) return;
    const compressed = path.endsWith(".zst");
    if (!cache || compressed || cache.ino !== stat.ino || stat.size <= cache.size) {
      cache = { size: 0, mtimeMs: 0, ino: stat.ino, offset: 0, pending: "", decoder: new StringDecoder("utf8"), parser: new CodexSessionParser(basename(path).replace(/\.jsonl(?:\.zst)?$/, "")) };
    }
    if (compressed) {
      this.consume(cache, Bun.zstdDecompressSync(readFileSync(path)).toString("utf8"));
    } else {
      const fd = openSync(path, "r");
      try {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        while (cache.offset < stat.size) {
          const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - cache.offset), cache.offset);
          if (bytes === 0) break;
          cache.offset += bytes;
          this.consume(cache, cache.decoder.write(buffer.subarray(0, bytes)));
        }
      } finally { closeSync(fd); }
    }
    cache.size = stat.size; cache.mtimeMs = stat.mtimeMs;
    if (cache.pending) cache.parser.line(cache.pending);
    this.files.set(path, cache);
  }

  private consume(cache: FileCache, text: string): void {
    const lines = (cache.pending + text).split("\n");
    cache.pending = lines.pop() ?? "";
    for (const line of lines) cache.parser.line(line);
  }
}
