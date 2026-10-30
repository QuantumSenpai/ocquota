/**
 * Report blocks for the report commands (totals / models / daily / top). Pure
 * functions of domain objects: no clock, no SQL, no I/O. Column widths and
 * number formats live here so every report lines up and "385K" means the same
 * thing as in the bar.
 */

import { formatCompact, formatCount, formatLocalDate, formatLocalDateTime, formatMoney } from "../core/format.ts";
import type { TimeZone } from "../core/time.ts";
import type { DailyBucket, ModelTotals, SessionTotals, TokenUsage, Totals } from "../core/types.ts";
import type { RendererColors } from "./renderer.ts";

/** Detail line for a TokenUsage; shared by every report that shows one. */
function tokenDetail(tokens: TokenUsage, colors: RendererColors): string {
  return (
    `${colors.dim("input")} ${formatCount(tokens.input)}` +
    ` ${colors.dim("output")} ${formatCount(tokens.output)}` +
    ` ${colors.dim("reasoning")} ${formatCount(tokens.reasoning)}` +
    ` ${colors.dim("cache write")} ${formatCount(tokens.cacheWrite)}` +
    ` ${colors.dim("· cache read")} ${formatCount(tokens.cacheRead)} ${colors.dim("(excluded)")}`
  );
}

/** Truncate to `width` columns with an ellipsis, then pad. O(width). */
function cell(text: string, width: number): string {
  return text.length <= width ? text.padEnd(width) : `${text.slice(0, width - 1)}…`;
}

/** Right-aligned integer column. */
function num(value: number, width: number): string {
  return formatCount(value).padStart(width);
}

const EMPTY = "no usage yet.";

/** Exact per-message totals for everything since `totals.from`. */
export function renderTotals(totals: Totals, colors: RendererColors, timeZone: TimeZone): string {
  const header = `${colors.bold("totals")} ${colors.dim(`· since ${formatLocalDateTime(totals.from, timeZone)} · exact per-message`)}`;
  if (totals.messages === 0) return `${header}\n${colors.dim(EMPTY)}`;
  return [
    header,
    `${colors.dim("counted")} ${formatCount(totals.totalTokens)} tokens ${colors.dim("(input + output + reasoning + cache write)")}`,
    tokenDetail(totals.tokens, colors),
    `${colors.dim("messages")} ${formatCount(totals.messages)} ${colors.dim("· sessions")} ${totals.sessions} ${colors.dim("· cost")} ${formatMoney(totals.cost)}`,
    `${colors.dim("last activity")} ${totals.lastActivityAt === null ? "never" : formatLocalDateTime(totals.lastActivityAt, timeZone)}`,
  ].join("\n");
}

/** Per-model rollup, heaviest first, with each model's share of the total. */
export function renderModels(models: ModelTotals[], colors: RendererColors): string {
  if (models.length === 0) return colors.dim(EMPTY);
  const grandTotal = models.reduce((sum, model) => sum + model.totalTokens, 0);
  const head = `${cell("model", 42)}${"msgs".padStart(6)}${"tokens".padStart(11)}${"share".padStart(8)}${"cost".padStart(10)}`;
  const rows = models.map((model) => {
    const share = grandTotal > 0 ? model.totalTokens / grandTotal : 0;
    return (
      cell(`${model.providerId}/${model.modelId}`, 42) +
      num(model.messages, 6) +
      num(model.totalTokens, 11) +
      `${(share * 100).toFixed(1)}%`.padStart(8) +
      formatMoney(model.cost).padStart(10)
    );
  });
  return [
    colors.dim(head),
    ...rows,
    `${cell("total", 42)}${num(models.reduce((sum, m) => sum + m.messages, 0), 6)}${num(grandTotal, 11)}${"100.0%".padStart(8)}${formatMoney(models.reduce((sum, m) => sum + m.cost, 0)).padStart(10)}`,
  ].join("\n");
}

/** One row per local day, oldest first. */
export function renderDaily(buckets: DailyBucket[], colors: RendererColors, timeZone: TimeZone): string {
  if (buckets.length === 0) return colors.dim(EMPTY);
  const head = `${cell("day", 11)}${"msgs".padStart(6)}${"tokens".padStart(11)}${"cost".padStart(10)}  detail`;
  const rows = buckets.map((bucket) => {
    const detail =
      `${formatCompact(bucket.tokens.input)} in · ${formatCompact(bucket.tokens.output)} out · ` +
      `${formatCompact(bucket.tokens.reasoning)} rsn · ${formatCompact(bucket.tokens.cacheWrite)} w`;
    return (
      cell(formatLocalDate(bucket.dayStart, timeZone), 11) +
      num(bucket.messages, 6) +
      num(bucket.totalTokens, 11) +
      formatMoney(bucket.cost).padStart(10) +
      `  ${detail}`
    );
  });
  return [colors.dim(head), ...rows].join("\n");
}

/** The `n` heaviest sessions, heaviest first. */
export function renderSessions(sessions: SessionTotals[], colors: RendererColors, timeZone: TimeZone): string {
  if (sessions.length === 0) return colors.dim(EMPTY);
  const head = `${cell("#", 3)}${cell("session", 42)}${"msgs".padStart(6)}${"tokens".padStart(11)}${"cost".padStart(10)}  last active`;
  const rows = sessions.map((session, index) => {
    const title = session.title === null || session.title.trim() === "" ? session.sessionId : session.title.trim();
    return (
      cell(String(index + 1), 3) +
      cell(title, 42) +
      num(session.messages, 6) +
      num(session.totalTokens, 11) +
      formatMoney(session.cost).padStart(10) +
      `  ${formatLocalDateTime(session.lastActivityAt, timeZone)}`
    );
  });
  return [colors.dim(head), ...rows].join("\n");
}
