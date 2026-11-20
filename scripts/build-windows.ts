import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const out = resolve(root, "dist/windows-x64");
mkdirSync(out, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "src/cli.ts")],
  compile: { target: "bun-windows-x64", outfile: resolve(out, "ocquota.exe") },
  minify: true,
});
if (!result.success) throw new AggregateError(result.logs, "Windows build failed");
for (const file of ["tui.tsx", "tui-runtime.js", "server.js", "rpc.js", "licenses.txt"]) copyFileSync(resolve(root, "dist", file), resolve(out, file));
for (const file of ["README.md", "CHANGELOG.md", "LICENSE"]) copyFileSync(resolve(root, file), resolve(out, file));
console.log(`Windows x64 distribution: ${out}`);
