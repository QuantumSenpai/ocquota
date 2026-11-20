import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AccountCredential } from "./types.ts";
const auth = z.object({ tokens: z.object({ access_token: z.string().min(1), account_id: z.string().optional() }) });
export function codexCredential(home: string): AccountCredential | undefined {
  try {
    const parsed = auth.parse(JSON.parse(readFileSync(join(home, "auth.json"), "utf8")));
    return { type: "oauth", access: parsed.tokens.access_token, accountId: parsed.tokens.account_id };
  } catch { return undefined; }
}
