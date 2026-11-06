import { DatabaseBusyError, DatabaseError } from "../core/errors.ts";

/** Extra retries after busy_timeout for longer locks (e.g. WAL checkpoints). */
export const BUSY_RETRY_DELAYS_MS = [40, 80] as const;

export function toDatabaseError(path: string, sql: string, cause: unknown): DatabaseError {
  if (isBusyError(cause)) return new DatabaseBusyError(path, { cause });
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

/** Synchronous pause via Atomics.wait because bun:sqlite is synchronous. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusyError(cause: unknown): boolean {
  const code = sqliteErrorCode(cause);
  if (code === null) return false;
  return code === "SQLITE_BUSY" || code.startsWith("SQLITE_BUSY_") ||
    code === "SQLITE_LOCKED" || code.startsWith("SQLITE_LOCKED_");
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sqliteErrorCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code: unknown = cause.code;
  return typeof code === "string" ? code : null;
}
