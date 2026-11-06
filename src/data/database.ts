/** Read-only SQLite connection with O(1) prepared-statement caching. */

import { Database, type SQLQueryBindings, type Statement } from "bun:sqlite";
import { BUSY_RETRY_DELAYS_MS, sleepSync, toDatabaseError } from "./sqlite-errors.ts";
import { DatabaseError } from "../core/errors.ts";

/** Named params (`$from`): bun:sqlite binds `?N` by textual order, which breaks dailyBucketsSql. */
export type SqlParams = Readonly<Record<string, string | number | boolean | null>>;

export interface DatabaseConnection {
  readonly path: string;
  all<T>(sql: string, params: SqlParams): T[];
  get<T>(sql: string, params: SqlParams): T | null;
  explain(sql: string, params: SqlParams): string[];
  close(): void;
}

interface OpenOptions {
  busyTimeoutMs?: number | undefined;
}

type CachedStatement = Statement<unknown, SQLQueryBindings[]>;

const DEFAULT_BUSY_TIMEOUT_MS = 250;

export class SqliteDatabase implements DatabaseConnection {
  private readonly db: Database;
  private readonly statements = new Map<string, CachedStatement>();
  readonly path: string;
  private closed = false;

  constructor(path: string, options: OpenOptions = {}) {
    this.path = path;
    try {
      // readonly + create:false prevents any write or lock against OpenCode.
      this.db = new Database(path, { readonly: true, create: false });
    } catch (cause) {
      throw new DatabaseError(
        "DB_OPEN_FAILED",
        `Cannot open the OpenCode database at ${path}. Is OpenCode installed and has it run at least once?`,
        path,
        { cause },
      );
    }
    // Connection-local pragmas; temp_store=MEMORY keeps GROUP BY B-trees in RAM.
    const busyTimeout = Math.max(0, Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS));
    this.db.exec(`PRAGMA busy_timeout = ${busyTimeout}`);
    this.db.exec("PRAGMA temp_store = MEMORY");
    this.db.exec("PRAGMA query_only = ON");
  }

  all<T>(sql: string, params: SqlParams): T[] {
    return this.guard(sql, (statement) => statement.all(params) as T[]);
  }

  get<T>(sql: string, params: SqlParams): T | null {
    return this.guard(sql, (statement) => statement.get(params) as T | null);
  }

  explain(sql: string, params: SqlParams): string[] {
    const rows = this.guard(`EXPLAIN QUERY PLAN ${sql}`, (statement) => {
      return statement.all(params) as Array<{ detail: string }>;
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
    const compiled = this.db.query<unknown, SQLQueryBindings[]>(sql);
    this.statements.set(sql, compiled);
    return compiled;
  }

  private guard<T>(sql: string, run: (statement: CachedStatement) => T): T {
    for (let attempt = 0; ; attempt++) {
      try {
        return run(this.statement(sql));
      } catch (cause) {
        const busy = toDatabaseError(this.path, sql, cause);
        if (busy.code !== "DB_BUSY" || attempt >= BUSY_RETRY_DELAYS_MS.length) throw busy;
        sleepSync(BUSY_RETRY_DELAYS_MS[attempt] ?? 80);
      }
    }
  }
}
