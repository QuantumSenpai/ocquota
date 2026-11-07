import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SqliteDatabase } from "../../src/data/database.ts";

const SCHEMA = `
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE session_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    seq INTEGER NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq);
  CREATE INDEX session_message_time_created_idx ON session_message (time_created);
`;

export interface UsageFixture {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  modelId?: string;
  providerId?: string;
  finish?: string;
}

/** Omitting `input` produces an error-turn payload (no tokens, no cost). */
export function assistantData(usage: UsageFixture): string {
  const tokens = usage.input === undefined
    ? {}
    : {
        tokens: {
          input: usage.input,
          output: usage.output ?? 0,
          reasoning: usage.reasoning ?? 0,
          cache: { read: usage.cacheRead ?? 0, write: usage.cacheWrite ?? 0 },
        },
        cost: usage.cost ?? 0,
      };
  return JSON.stringify({
    time: { created: 0, streamed: 0, completed: 0 },
    agent: "build",
    model: { id: usage.modelId ?? "test-model", providerID: usage.providerId ?? "test-provider", variant: "default" },
    finish: usage.finish ?? (usage.input === undefined ? "error" : "tool-calls"),
    ...tokens,
  });
}

export interface MessageFixture {
  sessionId?: string;
  type?: "assistant" | "user";
  data: string;
  timeCreated: number;
  timeUpdated?: number;
}

export class Fixture {
  readonly path: string;
  readonly db: SqliteDatabase;
  private readonly seed: Database;
  private seq = 0;

  constructor(schema: string = SCHEMA) {
    this.path = join(mkdtempSync(join(tmpdir(), "ocquota-fixture-")), "fixture.db");
    this.seed = new Database(this.path);
    this.seed.exec(schema);
    this.db = new SqliteDatabase(this.path);
  }

  session(id: string, title: string | null): void {
    this.seed.prepare("INSERT INTO session_v2 VALUES (?, ?)").run(id, title);
  }

  message(row: MessageFixture): string {
    const sessionId = row.sessionId ?? "ses_1";
    this.seq += 1;
    const id = `msg_${this.seq}`;
    this.seed
      .prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        id,
        sessionId,
        row.type ?? "assistant",
        this.seq,
        row.timeCreated,
        row.timeUpdated ?? row.timeCreated + 1_000,
        row.data,
      );
    return id;
  }

  updateMessage(id: string, data: string, timeUpdated: number): void {
    this.seed.prepare("UPDATE session_message SET data = ?, time_updated = ? WHERE id = ?").run(data, timeUpdated, id);
  }

  lockConnection(): Database {
    return new Database(this.path);
  }

  close(): void {
    this.db.close();
    this.seed.close();
    rmSync(join(this.path, ".."), { recursive: true, force: true });
  }
}

export function withFixture(body: (fixture: Fixture) => void, schema?: string): void {
  const fixture = new Fixture(schema);
  try {
    body(fixture);
  } finally {
    fixture.close();
  }
}
