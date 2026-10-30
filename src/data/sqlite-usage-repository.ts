/**
 * SqliteUsageRepository — the only place that knows OpenCode's schema.
 *
 * EXPLAIN QUERY PLAN against the real DB (~/.local/share/opencode/opencode.db,
 * 20 sessions, WAL, opened read-only):
 *
 *   ocquota $ explain
 *   `-- SCAN session_v2
 *
 * session_v2 has no index on time_updated, so the [start, end) filter is a
 * full table scan. That is the cheapest plan available to a read-only tool
 * (building an index would mean writing into OpenCode's own database), and the
 * aggregate itself is one SUM/GROUP-free pass inside SQLite — no rows ever
 * cross into JS. Keeping the scan is deliberate.
 */

import { DatabaseError } from "../core/errors.ts";
import type { UsageTotals, WindowRange } from "../core/types.ts";
import type { DatabaseConnection } from "./database.ts";
import type { UsageRepository } from "./repository.ts";

interface UsageRow {
  sessions: number;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  last_activity: number | null;
}

/** One aggregate query per window; every column the renderers need, nothing else. */
const USAGE_IN_RANGE_SQL = `
  SELECT
    COUNT(*) AS sessions,
    COALESCE(SUM(cost), 0) AS cost,
    COALESCE(SUM(tokens_input), 0) AS tokens_input,
    COALESCE(SUM(tokens_output), 0) AS tokens_output,
    COALESCE(SUM(tokens_reasoning), 0) AS tokens_reasoning,
    COALESCE(SUM(tokens_cache_read), 0) AS tokens_cache_read,
    COALESCE(SUM(tokens_cache_write), 0) AS tokens_cache_write,
    MAX(time_updated) AS last_activity
  FROM session_v2
  WHERE time_updated >= ?1 AND time_updated < ?2
`;

const EMPTY_TOTALS: UsageTotals = {
  sessions: 0,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  lastActivityAt: null,
};

export class SqliteUsageRepository implements UsageRepository {
  constructor(private readonly db: DatabaseConnection) {}

  usageInRange(range: WindowRange): UsageTotals {
    // COUNT(*) always yields a row; the fallback only guards a broken driver.
    const row = this.db.get<UsageRow>(USAGE_IN_RANGE_SQL, [range.start, range.end]);
    if (row === null) return EMPTY_TOTALS;
    return {
      sessions: row.sessions,
      cost: row.cost,
      tokens: {
        input: row.tokens_input,
        output: row.tokens_output,
        reasoning: row.tokens_reasoning,
        cacheRead: row.tokens_cache_read,
        cacheWrite: row.tokens_cache_write,
      },
      lastActivityAt: row.last_activity,
    };
  }

  explainUsageInRange(): string[] {
    const plan = this.db.explain(USAGE_IN_RANGE_SQL, [0, 0]);
    if (plan.length === 0) {
      throw new DatabaseError("DB_PLAN_FAILED", "SQLite returned no query plan for the usage query.", this.db.path);
    }
    return plan;
  }
}
