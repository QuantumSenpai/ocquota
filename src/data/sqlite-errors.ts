/**
 * SQLite error classification and the SQLITE_BUSY retry policy, kept out of
 * the connection so database.ts stays about the connection lifecycle.
 *
 * bun:sqlite is synchronous and ocquota has no concurrent work while a query
 * runs, so the retry pause is a synchronous Atomics.wait — a few ms blocked is
 * correct here and far cheaper than making the whole pipeline async.
 */

import { DatabaseBusyError, DatabaseError } from "../core/errors.ts";

/**
 * Extra attempts after SQLITE_BUSY/SQLITE_LOCKED, with a short pause between
 * them (the connection's busy_timeout already covers most collisions; this
 * catches the ones that outlast it, e.g. a WAL checkpoint).
 */
export const BUSY_RETRY_DELAYS_MS = [40, 80] as const;

/** Translate any driver throw into a typed, user-facing DatabaseError. */
export function toDatabaseError(path: string, sql: string, cause: unknown): DatabaseError {
  if (isBusyError(cause)) return new DatabaseBusyError(path, { cause });
  // Another OpenCode schema version: fail with a fix, not a stack trace.
  const missing = /no such table:\s*([A-Za-z0-9_]+)/i.exec(errorMessage(cause));
  if (missing !== null) {
    const table = missing[1] ?? "session_message";
    return new DatabaseError(
      "DB_SCHEMA_MISSING",
      `The database at ${path} has no "${table}" table, so it was written by a different OpenCode version. Upgrade OpenCode, or point --db/OCQUOTA_DB at the right file.`,
      path,
      { cause },
    );
  }
  const code = sqliteErrorCode(cause);
  const firstLine = sql.trim().split("\n", 1)[0] ?? "query";
  return new DatabaseError(
    code ?? "DB_QUERY_FAILED",
    `SQLite error ${code ?? "(unknown)"} while running: ${firstLine}`,
    path,
    { cause },
  );
}

/** Blocks the thread for `ms`. Valid in Bun because bun:sqlite is sync. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusyError(cause: unknown): boolean {
  const code = sqliteErrorCode(cause);
  if (code === null) return false;
  // SQLITE_BUSY, SQLITE_BUSY_SNAPSHOT, SQLITE_LOCKED, SQLITE_LOCKED_SHAREDCACHE...
  return code === "SQLITE_BUSY" || code.startsWith("SQLITE_BUSY_") ||
    code === "SQLITE_LOCKED" || code.startsWith("SQLITE_LOCKED_");
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Extract SQLite's symbolic code (e.g. "SQLITE_BUSY") from a driver error. */
function sqliteErrorCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code: unknown = cause.code;
  return typeof code === "string" ? code : null;
}
