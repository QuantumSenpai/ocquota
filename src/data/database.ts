/**
 * Read-only access to a SQLite database. Owns the connection lifecycle and the
 * statement cache: every distinct SQL string is compiled once and reused, so
 * repeated calls are O(1) prepares. bun:sqlite types stay inside this module —
 * callers depend on the DatabaseConnection interface only.
 */

import { Database, type SQLQueryBindings, type Statement } from "bun:sqlite";
import { DatabaseBusyError, DatabaseError } from "../core/errors.ts";

export interface DatabaseConnection {
  /** File this connection reads; used in error messages. */
  readonly path: string;
  /** SELECT producing many rows; `params` are bound positionally. */
  all<T>(sql: string, params: readonly SQLQueryBindings[]): T[];
  /** SELECT producing at most one row; null when there is none. */
  get<T>(sql: string, params: readonly SQLQueryBindings[]): T | null;
  /** EXPLAIN QUERY PLAN for `sql` as human-readable lines (diagnostics). */
  explain(sql: string, params: readonly SQLQueryBindings[]): string[];
  close(): void;
}

interface OpenOptions {
  /** how long SQLite waits for a competing writer before raising SQLITE_BUSY */
  busyTimeoutMs?: number | undefined;
}

type CachedStatement = Statement<unknown, SQLQueryBindings[]>;

const DEFAULT_BUSY_TIMEOUT_MS = 250;

export class SqliteDatabase implements DatabaseConnection {
  private readonly db: Database;
  /** O(1) statement reuse: sql text -> compiled statement. */
  private readonly statements = new Map<string, CachedStatement>();
  readonly path: string;
  private closed = false;

  constructor(path: string, options: OpenOptions = {}) {
    this.path = path;
    try {
      // readonly + create:false: this process can never write or lock OpenCode out.
      this.db = new Database(path, { readonly: true, create: false });
    } catch (cause) {
      throw new DatabaseError(
        "DB_OPEN_FAILED",
        `Cannot open the OpenCode database at ${path}. Is OpenCode installed and has it run at least once?`,
        path,
        { cause },
      );
    }
    // Both pragmas are connection-local: no write to OpenCode's files.
    this.db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS))}`);
    this.db.exec("PRAGMA query_only = ON");
  }

  all<T>(sql: string, params: readonly SQLQueryBindings[]): T[] {
    return this.guard(sql, (statement) => statement.all(...params) as T[]);
  }

  get<T>(sql: string, params: readonly SQLQueryBindings[]): T | null {
    return this.guard(sql, (statement) => statement.get(...params) as T | null);
  }

  explain(sql: string, params: readonly SQLQueryBindings[]): string[] {
    const rows = this.guard(`EXPLAIN QUERY PLAN ${sql}`, (statement) => {
      return statement.all(...params) as Array<{ detail: string }>;
    });
    return rows.map((row) => row.detail);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const statement of this.statements.values()) statement.finalize();
    this.statements.clear();
    this.db.close();
  }

  private statement(sql: string): CachedStatement {
    const cached = this.statements.get(sql);
    if (cached !== undefined) return cached;
    // Explicit ParamsType makes bun return exactly the cache's statement type.
    const compiled = this.db.query<unknown, SQLQueryBindings[]>(sql);
    this.statements.set(sql, compiled);
    return compiled;
  }

  private guard<T>(sql: string, run: (statement: CachedStatement) => T): T {
    try {
      return run(this.statement(sql));
    } catch (cause) {
      throw this.toDatabaseError(sql, cause);
    }
  }

  private toDatabaseError(sql: string, cause: unknown): DatabaseError {
    const code = sqliteErrorCode(cause);
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
      return new DatabaseBusyError(this.path, { cause });
    }
    const firstLine = sql.trim().split("\n", 1)[0] ?? "query";
    return new DatabaseError(
      code ?? "DB_QUERY_FAILED",
      `SQLite error ${code ?? "(unknown)"} while running: ${firstLine}`,
      this.path,
      { cause },
    );
  }
}

/** Extract SQLite's symbolic code (e.g. "SQLITE_BUSY") from a driver error. */
function sqliteErrorCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code: unknown = cause.code;
  return typeof code === "string" ? code : null;
}
