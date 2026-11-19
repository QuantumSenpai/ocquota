import { chmodSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const result = await Bun.build({
  entrypoints: [resolve(root, "src/cli.ts")],
  outdir: resolve(root, "dist"),
  target: "bun",
  minify: true,
});
if (!result.success) throw new AggregateError(result.logs, "CLI build failed");
chmodSync(resolve(root, "dist/cli.js"), 0o755);

const tui = await Bun.build({
  entrypoints: [resolve(root, "src/opencode/runtime.ts")],
  outdir: resolve(root, "dist"),
  naming: "tui-runtime.js",
  target: "bun",
  minify: true,
});
if (!tui.success) throw new AggregateError(tui.logs, "OpenCode plugin build failed");
// Let OpenCode transform TSX against its own Solid/OpenTUI runtime.
const component = readFileSync(resolve(root, "src/opencode/tui.tsx"), "utf8").replace('"./runtime.ts"', '"./tui-runtime.js"');
await Bun.write(resolve(root, "dist/tui.tsx"), component);

const licenses = ["cac", "picocolors", "zod"].map((name) => {
  const text = readFileSync(resolve(root, "node_modules", name, "LICENSE"), "utf8");
  return `${name}\n${"=".repeat(name.length)}\n${text}`;
});
await Bun.write(resolve(root, "dist/licenses.txt"), licenses.join("\n\n"));
