import type { TokenUsage } from "../core/types.ts";

export interface CodexUsageEvent {
  key: string;
  sessionId: string;
  modelId: string;
  providerId: string;
  timestamp: number;
  tokens: TokenUsage;
  totalTokens: number;
}

interface RawUsage {
  input: number;
  cached: number;
  write: number;
  output: number;
  reasoning: number;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function label(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0
    ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 256) : fallback;
}

function usage(value: unknown): RawUsage | undefined {
  const raw = object(value);
  const numbers = [raw["input_tokens"], raw["cached_input_tokens"] ?? 0, raw["cache_write_input_tokens"] ?? 0,
    raw["output_tokens"], raw["reasoning_output_tokens"] ?? 0];
  if (!numbers.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) return undefined;
  const [input, cached, write, output, reasoning] = numbers as [number, number, number, number, number];
  if (cached + write > input || reasoning > output) return undefined;
  return { input, cached, write, output, reasoning };
}

function signature(value: RawUsage): string {
  return `${value.input}:${value.cached}:${value.write}:${value.output}:${value.reasoning}`;
}

/** Holds usage and metadata only; conversation and tool contents are discarded. */
export class CodexSessionParser {
  readonly events: CodexUsageEvent[] = [];
  private sessionId: string;
  private providerId = "openai";
  private modelId = "unknown";
  private previous: RawUsage | undefined;
  private previousSignature = "";
  private readonly responses = new Set<string>();
  private usesResponseRecords = false;

  constructor(fallbackId: string) {
    this.sessionId = fallbackId;
  }

  line(text: string): void {
    let row: Record<string, unknown>;
    try { row = object(JSON.parse(text)); } catch { return; }
    const payload = object(row["payload"]);
    if (row["type"] === "session_meta") {
      this.sessionId = label(payload["id"] ?? payload["session_id"], this.sessionId);
      this.providerId = label(payload["model_provider"], "openai");
      return;
    }
    if (row["type"] === "turn_context") {
      this.modelId = label(payload["model"], "unknown");
      return;
    }
    const timestamp = typeof row["timestamp"] === "string" ? Date.parse(row["timestamp"]) : NaN;
    if (!Number.isFinite(timestamp)) return;
    if (row["type"] === "token_usage_record") {
      const raw = usage(payload["usage"]);
      const responseId = payload["response_id"];
      if (!raw || typeof responseId !== "string" || responseId.length === 0 || this.responses.has(responseId)) return;
      if (!this.usesResponseRecords) {
        // Legacy totals can diverge after resume/compaction; never combine both formats.
        this.events.length = 0;
        this.usesResponseRecords = true;
      }
      this.responses.add(responseId);
      this.add(`${this.providerId}:${responseId}`, raw, timestamp, label(payload["thread_id"], this.sessionId));
      return;
    }
    if (this.usesResponseRecords || row["type"] !== "event_msg" || payload["type"] !== "token_count") return;
    const info = object(payload["info"]);
    const total = usage(info["total_token_usage"]);
    if (!total) return; // Null info and synthetic context-window counts are not usage.
    const nextSignature = signature(total);
    if (nextSignature === this.previousSignature) return;
    const previous = this.previous;
    this.previous = total;
    this.previousSignature = nextSignature;
    let last = usage(info["last_token_usage"]);
    if (!last) {
      last = usage({
        input_tokens: total.input - (previous?.input ?? 0),
        cached_input_tokens: total.cached - (previous?.cached ?? 0),
        cache_write_input_tokens: total.write - (previous?.write ?? 0),
        output_tokens: total.output - (previous?.output ?? 0),
        reasoning_output_tokens: total.reasoning - (previous?.reasoning ?? 0),
      });
      if (!last) return;
    }
    this.add(`${this.sessionId}:${timestamp}:${nextSignature}`, last, timestamp, this.sessionId);
  }

  private add(key: string, raw: RawUsage, timestamp: number, sessionId: string): void {
    // Codex cache/read and reasoning are subsets of input/output, not additive usage.
    const tokens: TokenUsage = {
      input: raw.input - raw.cached - raw.write,
      output: raw.output - raw.reasoning,
      reasoning: raw.reasoning,
      cacheRead: raw.cached,
      cacheWrite: raw.write,
    };
    const totalTokens = raw.input - raw.cached + raw.output;
    if (totalTokens === 0 && raw.cached === 0) return;
    this.events.push({ key, sessionId, modelId: this.modelId, providerId: this.providerId, timestamp, tokens, totalTokens });
  }
}
