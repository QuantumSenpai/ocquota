/**
 * OpenCode `session_message.data` JSON paths (for `type = 'assistant'` rows):
 *   $.tokens.input        number   prompt tokens
 *   $.tokens.output       number   completion tokens
 *   $.tokens.reasoning    number   reasoning tokens
 *   $.tokens.cache.read   number   cached prompt tokens read
 *   $.tokens.cache.write  number   prompt tokens written to cache
 *   $.cost                number   USD charged for the turn
 *   $.model.id            string   e.g. "mimo-v2.6-flash-free"
 *   $.model.providerID    string   e.g. "opencode" | "openrouter"
 *   $.model.variant       string   e.g. "default"
 *   $.agent               string   e.g. "build"
 *   $.time.created/.streamed/.completed   epoch ms
 *
 * Row columns: `type`, `time_created` (indexed by session_message_time_created_idx),
 * `session_id` (FK to session_v2.id), `seq`. Error turns omit `tokens` and `cost`.
 */

/**
 * Only `assistant` rows carry usage, and `json_valid(data)` guards `json_extract`
 * (which throws on malformed JSON) once per row in WHERE.
 */
export const USAGE_ROW_FILTER = "type = 'assistant' AND json_valid(data)";

/** Safe only under USAGE_ROW_FILTER. */
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
 * `total_tokens` is derived outside this subquery via withTotalTokens() to avoid
 * 4 extra json_extract() parses per row.
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
    MAX(time_created) AS last_activity
`;

/**
 * Countable tokens = input + output + reasoning + cache write. Cache reads are
 * excluded because they dwarf fresh tokens (e.g. 296M vs 748K) at minimal cost.
 */
const TOTALS_WRAPPER = `messages, sessions, cost, tokens_input, tokens_output, tokens_reasoning,
    tokens_cache_read, tokens_cache_write,
    COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) + COALESCE(tokens_reasoning, 0) + COALESCE(tokens_cache_write, 0) AS total_tokens,
    last_activity`;

export function withTotalTokens(aggregateQuery: string, passthrough = ""): string {
  const prefix = passthrough === "" ? "" : `${passthrough},\n    `;
  return `SELECT\n    ${prefix}${TOTALS_WRAPPER}\n  FROM (${aggregateQuery})`;
}
