import type { QuotaSnapshot } from "../core/types.ts";
import type { Renderer } from "./renderer.ts";

export class JsonRenderer implements Renderer {
  render(snapshot: QuotaSnapshot): string {
    return JSON.stringify(snapshot.costAvailable === false ? { ...snapshot, cost: null } : snapshot);
  }
}
