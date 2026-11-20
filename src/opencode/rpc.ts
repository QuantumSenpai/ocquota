import { z } from "zod";
import { accountSnapshot } from "../account/types.ts";
export const accountRpc = {
  id: "ocquota.account",
  methods: { read: { input: z.object({ providerID: z.string().min(1).max(256), modelID: z.string().min(1).max(256) }), output: accountSnapshot } },
  events: {},
} as const;
