import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const SCHEMA = `
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE session_message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
  );
  CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq);
  CREATE INDEX session_message_time_created_idx ON session_message (time_created);
`;

function payloadTemplates(now: number): string[] {
  const sizes = [1_500, 3_200, 3_200, 6_000];
  return sizes.map((size, index) =>
    JSON.stringify({
      time: { created: now, streamed: now + 7, completed: now + 9_000 },
      agent: "build",
      model: { id: `model-${index % 3}`, providerID: "opencode", variant: "default" },
      tokens: { input: 1_000 + index, output: 300, reasoning: 120, cache: { read: 40_000, write: 0 } },
      cost: 0.004,
      finish: "tool-calls",
      content: [{ type: "text", text: "x".repeat(Math.max(0, size - 260)) }],
    }),
  );
}

export interface ScaleFixture {
  readonly path: string;
  readonly dir: string;
  readonly seedMs: number;
  readonly avgPayload: number;
}

export function seedScaleFixture(rows: number, days: number, sessions: number, now: number): ScaleFixture {
  const dir = mkdtempSync(join(tmpdir(), "ocquota-scale-"));
  const path = join(dir, "scale.db");
  const db = new Database(path);
  db.exec(SCHEMA);
  const templates = payloadTemplates(now);
  const avgPayload = Math.round(templates.reduce((sum, t) => sum + t.length, 0) / templates.length);
  const started = performance.now();
  const insertSession = db.prepare("INSERT INTO session_v2 VALUES (?, ?)");
  const insertMessage = db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (let s = 0; s < sessions; s += 1) insertSession.run(`ses_${s}`, `Session ${s}`);
  const span = days * 86_400_000;
  for (let i = 0; i < rows; i += 1) {
    const timeCreated = now - Math.floor((i * span) / rows);
    const template = templates[i % templates.length] ?? "";
    insertMessage.run(`msg_${i}`, `ses_${i % sessions}`, "assistant", i, timeCreated, timeCreated + 9_000, template);
  }
  db.exec("COMMIT");
  db.close();
  return { path, dir, seedMs: Math.round(performance.now() - started), avgPayload };
}
