# ocquota

A local, read-only usage and theme integration for OpenCode, with Codex usage
reports too. Track tokens or cost against your own daily, weekly, or monthly budget.

Requires Bun. The native integration targets OpenCode 2.3.2+. OpenCode uses its
local SQLite database; Codex uses local session rollout files. Codex reports are
available in the CLI. Claude Code support is still planned.

Native OpenCode integration is included from version 0.2.0.

Install globally using either package manager:

```sh
npm install -g @kyzenn.raw/ocquota
# or: bun add -g @kyzenn.raw/ocquota

ocquota opencode-install --theme aurora
opencode
```

Inside OpenCode, use `/ocquota` for statistics and `/themes` to switch themes.
For Codex CLI native themes and live footer stats, see the Codex setup below.
The standalone usage view is `ocquota watch --source codex --theme aurora`.

### Native Codex CLI setup

Install or update to ocquota 0.3.0 or newer:

```bash
npm install -g @kyzenn.raw/ocquota@latest
ocquota codex-install --theme aurora
codex
```

Restart Codex after setup. Use `/theme` to switch between `ocquota-aurora`,
`ocquota-ember` and `ocquota-mono`; use `/statusline` to customize the native
footer and `/status` for account/session details. Verified with Codex CLI 0.170.0.

The themes color syntax highlighting, diffs and the native footer. Codex keeps
control of the terminal background and the rest of its UI. The footer uses
Codex's live data: Aurora emphasizes context and tokens, Ember prioritizes
5-hour/weekly limits and input/output tokens, and Mono starts with a compact
model/context/token layout. Limits appear when supplied by the account; these
are account limits, separate from ocquota's configurable local token budget.
Existing footer items are retained, including when changing theme presets.

The installer respects `--codex-home`, `OCQUOTA_CODEX_HOME`, then `CODEX_HOME`
(default `~/.codex`). It preserves settings, creates a private verbatim backup
of `config.toml`, and installs `.tmTheme` files under `themes/`. TOML formatting
and comments are normalized in the active config; the original remains in the
backup. Use `--no-motion` to disable Codex animations; existing animation
preferences otherwise remain in effect. No extra background process is needed.

See the official [CLI customization guide](https://learn.chatgpt.com/docs/cli-customization)
and [Codex 0.170.0 TUI configuration schema](https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/core/config.schema.json).

Bun 1.4.4 or newer must be installed and on your PATH, including when using npm
to install this package. The npm package contains a bundled CLI, so users do not
need to clone this repository or install development dependencies. Run
`ocquota --help` from any directory after installation.

To try it from a source checkout:

```sh
bun install
bun src/cli.ts themes
bun src/cli.ts preview --theme aurora
bun src/cli.ts watch --theme ember
bun src/cli.ts watch --source codex --theme aurora
```

To put themes and statistics **inside OpenCode** from this source checkout:

```sh
bun run build
bun dist/cli.js opencode-install --theme aurora
opencode
```

The installer copies a native TUI plugin, installs three whole-workspace themes,
backs up the existing `cli.json`/`cli.jsonc`, and preserves other plugins and
settings. JSONC values are preserved; a verbatim backup retains original comments.
Restart OpenCode after installation. Then use:

- `/ocquota` for detailed usage and budget statistics.
- `/themes` → `ocquota-aurora`, `ocquota-ember`, or `ocquota-mono` to style OpenCode itself.
- The built-in session sidebar for the budget meter and current-session cost.
- The prompt footer for compact usage, including when the sidebar is hidden.

Use `--no-motion` with the installer to disable animation. Settings are stored in
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`). Local
OpenCode database usage is labeled as a local budget, independent of provider
account limits. The plugin opens the database read-only and releases it on unload.

The native plugin can also be loaded through `plugins` in OpenCode's `cli.json`:

```json
{
  "plugins": [{
    "package": "@kyzenn.raw/ocquota@0.3.0",
    "options": { "limitTokens": 5000000, "window": "day", "motion": true }
  }]
}
```

Custom themes still need the installer because OpenCode loads theme JSON
separately from TUI plugins.
The plugin uses OpenCode's [native slots and commands](https://opencode.ai/docs/build/plugins/cli/)
and [custom theme format](https://opencode.ai/docs/cli/theme/).

Development audit note: the matching OpenCode/OpenTUI SDKs currently bring two
moderate upstream advisory groups in `glob` and `minimatch`. Those packages are
development dependencies and are not bundled into ocquota's release artifacts.
The installed plugin uses OpenCode's own UI runtime. Recheck these advisories
when updating the SDK versions.

| Theme | Style |
| --- | --- |
| `aurora` | Cyan and violet, spacious overview, token breakdown and reset time. Default. |
| `ember` | Amber and coral, remaining budget first, spend and pace. |
| `mono` | Compact essentials using your terminal's own foreground, for light or dark backgrounds. |
| `raw` | Original four-line quota bar. |

`preview` uses clearly labeled sample data and needs no database. Themes change
presentation, never the underlying usage. Narrow or short terminals use a compact
layout; very short watch panes show an enlargement hint instead of scrolling.
Colors follow terminal color detection and `NO_COLOR`; themes use RGB foreground
colors and leave your terminal background intact.

Watch mode uses a subtle live indicator and redraws in place in the terminal's
alternate screen, restoring your previous screen and cursor when you exit with
Ctrl-C. Animation reuses the latest snapshot; it does not query the database on
each animation frame. For still output, use `--no-motion` or set
`OCQUOTA_REDUCED_MOTION=1`. Piped watch output prints once without animation.

```sh
bun src/cli.ts watch --theme mono --no-motion
bun src/cli.ts --theme raw
bun src/cli.ts json
bun src/cli.ts daily --days 7
bun src/cli.ts models
bun src/cli.ts top --n 5
```

Configuration precedence is CLI flags, `OCQUOTA_*` environment variables,
`~/.config/ocquota/config.json`, then defaults. Save a preference with the `theme`
config key or `OCQUOTA_THEME=ember`. An existing config without `theme` uses Aurora.

Common flags: `--db <path>`, `--window day|week|month`, `--limit <tokens>`,
`--metric tokens|cost`, `--limit-cost <usd>`, `--refresh <ms>`, and `--tz <zone>`.
The default database is `~/.local/share/opencode/opencode.db` (`OCQUOTA_DB` to
override), and the default budget is 5 million tokens per local day.

Countable tokens include input, output, reasoning and cache writes; cache reads
are shown separately and excluded. Budgets are local preferences, not provider
account limits. Watch mode settles messages after a 10-minute grace period;
updates to older messages are picked up when watch restarts. Pace estimates need
multiple samples and do not persist between runs.

Codex usage:

```sh
bun src/cli.ts preview --source codex --theme ember
bun src/cli.ts watch --source codex --theme aurora
bun src/cli.ts json --source codex
bun src/cli.ts models --source codex
bun src/cli.ts daily --source codex --days 7
bun src/cli.ts top --source codex --n 5
```

Use `--codex-home <path>` for a custom Codex home. The path precedence is
`--codex-home`, `OCQUOTA_CODEX_HOME`, `CODEX_HOME`, the `codexHome` config key,
then `~/.codex`. Set `OCQUOTA_SOURCE=codex` or add `"source": "codex"` to your
ocquota config to make Codex the default. OpenCode remains the default otherwise.

The Codex reader scans `sessions/` and `archived_sessions/`, including
`.jsonl.zst` files, without opening an OpenCode database. It prefers per-response
usage records for files that contain them; older `token_count` events are a
fallback for files without per-response records. Both formats are never added
together, since their cumulative accounting can diverge after resume/compaction. Repeated
usage snapshots, copied response IDs and rate-limit-only events are not counted
again. Usage is assigned to the time it was recorded, not the session's start.
In Codex views, "responses" (or "calls" in tables) counts recorded usage events;
the JSON field remains `messages` for compatibility.

Codex cached input and reasoning are subsets of input and output. The adapter
splits out those subsets so the same countable-token formula applies to both
sources: fresh input + visible output + reasoning + cache writes. Cached reads
stay excluded. This follows the
[Codex token usage protocol](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)
and [Responses usage conversion](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs).

Codex logs do not supply billed USD cost: terminal reports show `N/A`, JSON
returns `cost: null` and `costAvailable: false`, and `--metric cost` is rejected
for this source. The local token budget is separate from your account's provider
rate limits. No pricing estimates are invented.

Codex watch caches parsed usage in memory and reads only appended bytes from
changed plain JSONL files. Rewritten or replaced files are rebuilt; changed
compressed files are decompressed again. It does not use OpenCode's settlement
grace period. Initial startup reads the available rollout history; later refreshes
still scan cached usage events to calculate the requested window. No extra
database, credentials, conversation text storage or Codex config changes are used.

Development checks:

```sh
bun test
bun run typecheck
bun run build
```

Maintainer release workflow (from this repository):

```sh
bun install --frozen-lockfile
bun audit
npm pack --dry-run
npm login
npm publish --access public
```

`npm pack` builds the CLI and includes only the bundled executable, bundled
library licenses, package metadata, README, changelog and license. Tests verify
that the tarball installs offline and runs outside the repository. Publishing
also runs type checking and the test suite first. npm authentication is handled
by `npm login`; never put registry credentials in source files.

For a local installation before publication:

```sh
npm pack
npm install -g ./kyzenn.raw-ocquota-0.3.0.tgz
ocquota preview --source codex --theme ember
```
