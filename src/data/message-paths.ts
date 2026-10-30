/**
 * Exact JSON paths inside `session_message.data`, verified against the real
 * OpenCode database (never guessed) and stable across the rows sampled:
 *
 * One `assistant` message looks like:
 * ```json
 * {
 *   "time": { "created": 1793360614143, "streamed": ..., "completed": ... },
 *   "agent": "build",
 *   "model": { "id": "mimo-v2.6-flash-free", "providerID": "opencode", "variant": "default" },
 *   "tokens": { "input": 102, "output": 316, "reasoning": 48,
 *               "cache": { "read": 129664, "write": 0 } },
 *   "cost": 0,
 *   "finish": "tool-calls",
 *   "content": [ { "type": "text" | "reasoning" | "tool", ... } ]
 * }
 * ```
 *
 * Paths this module reads:
 *   $.tokens.input        number   prompt tokens billed for this turn
 *   $.tokens.output       number   completion tokens
 *   $.tokens.reasoning    number   reasoning tokens
 *   $.tokens.cache.read   number   cached prompt tokens read back
 *   $.tokens.cache.write  number   prompt tokens written to cache
 *   $.cost                number   USD charged for this turn
 *   $.model.id            string   model id,  e.g. "mimo-v2.6-flash-free"
 *   $.model.providerID    string   provider,  e.g. "opencode" | "openrouter"
 *   $.model.variant       string   e.g. "default"
 *   $.agent               string   e.g. "build"
 *   $.time.created/.streamed/.completed   epoch ms (turn timing)
 *
 * Row-level columns used alongside the JSON: `type` (only 'assistant' carries
 * usage), `time_created` (epoch ms, indexed by session_message_time_created_idx),
 * `session_id` (FK to session_v2.id), `seq`.
 *
 * Data-quality facts measured on the real DB, all of which the queries below
 * must survive:
 *   - `json_extract()` *throws* "malformed JSON" on bad input, so validity is
 *     checked exactly once per row, in the WHERE clause (see USAGE_ROW_FILTER).
 *     json_valid() itself never throws. Measured on the real DB: 1 guard per
 *     row = 7.8 ms vs 12 per-expression guards = 8.6 ms for totalsSince(0),
 *     with byte-identical results. 0 malformed rows exist today; a malformed
 *     row carries no readable usage, so it is excluded from every aggregate.
 *   - 42 assistant messages omit `tokens` and `cost` entirely (their turn
 *     finished with an error) -> json_extract returns NULL -> ignored by SUM().
 *   - COALESCE(..., 0) keeps the empty window (0 rows) reporting zeros.
 *
 * Only `type='assistant'` rows carry usage; user/idle/system/synthetic rows
 * have no `tokens` key and are excluded from every aggregate.
 */

/**
 * Row filter shared by every aggregate. Both halves are required and both are
 * evaluated in WHERE, i.e. *before* any projection:
 *   - only `assistant` rows carry usage at all;
 *   - json_valid(data) is the single malformed-JSON guard for the whole query,
 *     which is what lets the EXPR_* extractions below be plain json_extract.
 * A row failing either condition contributes nothing and never reaches
 * json_extract, so no query can crash on a corrupt `data` column.
 */
export const USAGE_ROW_FILTER = "type = 'assistant' AND json_valid(data)";

/** Plain extraction — safe only under USAGE_ROW_FILTER. */
function extract(path: string): string {
  return `json_extract(data, '$.${path}')`;
}

const EXPR_INPUT = extract("tokens.input");
const EXPR_OUTPUT = extract("tokens.output");
const EXPR_REASONING = extract("tokens.reasoning");
const EXPR_CACHE_READ = extract("tokens.cache.read");
const EXPR_CACHE_WRITE = extract("tokens.cache.write");
const EXPR_COST = extract("cost");
export const EXPR_PROVIDER_ID = `COALESCE(${extract("model.providerID")}, 'unknown')`;
export const EXPR_MODEL_ID = `COALESCE(${extract("model.id")}, 'unknown')`;

/**
 * What the quota counts, in SQL: everything the model produces plus cache
 * *writes* (priced like fresh input), excluding cache *reads* — in a real DB
 * reads dwarf everything else (296M vs ~748K other tokens) at a fraction of
 * the price, so counting them would pin the bar at 100% forever.
 *
 * This is the single definition of "countable tokens" in the codebase; every
 * aggregate below reuses it, so the bar, the reports and the SQL ordering can
 * never disagree. Per-component COALESCE keeps a partially-shaped row (valid
 * JSON missing a field) contributing whatever it does have instead of vanishing.
 */
export const EXPR_COUNTABLE = [
  `COALESCE(${EXPR_INPUT}, 0)`,
  `COALESCE(${EXPR_OUTPUT}, 0)`,
  `COALESCE(${EXPR_REASONING}, 0)`,
  `COALESCE(${EXPR_CACHE_WRITE}, 0)`,
].join(" + ");

/**
 * The aggregate column list shared by every totals query, so the SUMs are
 * written exactly once in the whole codebase.
 */
export const TOTALS_COLUMNS = `
    COUNT(*) AS messages,
    COUNT(DISTINCT session_id) AS sessions,
    COALESCE(SUM(${EXPR_COST}), 0) AS cost,
    COALESCE(SUM(${EXPR_INPUT}), 0) AS tokens_input,
    COALESCE(SUM(${EXPR_OUTPUT}), 0) AS tokens_output,
    COALESCE(SUM(${EXPR_REASONING}), 0) AS tokens_reasoning,
    COALESCE(SUM(${EXPR_CACHE_READ}), 0) AS tokens_cache_read,
    COALESCE(SUM(${EXPR_CACHE_WRITE}), 0) AS tokens_cache_write,
    COALESCE(SUM(${EXPR_COUNTABLE}), 0) AS total_tokens,
    MAX(time_created) AS last_activity
`;
