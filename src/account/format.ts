import { formatCompact, formatDuration, formatMoney } from "../core/format.ts";
import { cleanLabel, type AccountSnapshot, type QuotaMeter } from "./types.ts";
export function meterValue(meter: QuotaMeter): string {
  const remaining = meter.remaining;
  if (remaining === undefined) return "Not supplied";
  if (meter.unit === "percent") return `${remaining.toFixed(0)}% left`;
  const value = meter.unit === "USD" ? formatMoney(remaining) : formatCompact(remaining);
  const limit = meter.limit === undefined ? "" : ` / ${meter.unit === "USD" ? formatMoney(meter.limit) : formatCompact(meter.limit)}`;
  return `${value}${limit} ${meter.unit === "USD" ? "left" : `${meter.unit} left`}`;
}
export function accountLines(account: AccountSnapshot | undefined, now = Date.now(), detailed = true): string[] {
  if (!account) return ["ACCOUNT", "Checking provider allowance…"];
  const lines = [`ACCOUNT${account.plan ? ` · ${cleanLabel(account.plan)}` : ""} · ${account.blocked ? "blocked" : account.status}`];
  if (account.source.includes("linked Codex")) lines.push("Shared plan via linked Codex", "OpenCode app cap: not exposed");
  for (const meter of account.meters) {
    lines.push(`${cleanLabel(meter.label)}  ${meterValue(meter)}`);
    if (detailed) lines.push(cleanLabel(meter.scope));
    if (meter.resetsAt !== undefined) lines.push(meter.resetsAt <= now ? "Reset passed · awaiting refresh" : `Resets in ${formatDuration(meter.resetsAt - now)}`);
  }
  if (!account.meters.length) lines.push("Allowance unavailable");
  lines.push(`Checked ${formatDuration(Math.max(0, now - account.fetchedAt))} ago`);
  return lines;
}
