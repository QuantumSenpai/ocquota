<p align="center">
  <img src="https://raw.githubusercontent.com/QuantumSenpai/ocquota/main/assets/banner.svg" alt="ocquota — Your coding window, in bloom. Thirteen themes, ten ambient scenes and live usage statistics." width="1280">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kyzenn.raw/ocquota">npm</a> ·
  <a href="https://github.com/QuantumSenpai/ocquota/releases/latest">Downloads</a> ·
  <a href="https://github.com/QuantumSenpai/ocquota/actions/workflows/compatibility.yml">Windows / macOS / Linux CI</a> ·
  <a href="LICENSE">MIT</a>
</p>

# ocquota

Local, read-only usage statistics with calm workspace themes and a little atmosphere.
Cherry blossoms, rain, drifting leaves and seven more ambient scenes live in their
own small strip, leaving your code and statistics easy to read.

**13 themes · 10 scenes · live pause and speed controls · no telemetry**

## Install or update

The npm package requires **Bun 1.4.4+** on your PATH. If needed, install it with
`npm install -g bun`, then:

```sh
npm install -g @kyzenn.raw/ocquota@latest
ocquota --version
ocquota themes
ocquota preview --theme sakura
```

Or use `bun add -g @kyzenn.raw/ocquota`. The standalone Windows x64 ZIP bundles
Bun; extract **all files** together and use `.\ocquota.exe` in PowerShell.
Windows 10 1809+ / Windows 11 are supported. Native CI also covers macOS and Linux.

## OpenCode: themes, live stats and ambient motion inside your workspace

Requires **OpenCode 2.3.2+**.

```sh
ocquota opencode-install --theme sakura --animation sakura --speed 0.75
opencode
```

Restart OpenCode after installing. The native sidebar shows your local budget,
remaining tokens or cost, total tokens, input/output tokens, reasoning tokens,
cache reads/writes, sessions, messages, reset time, burn rate, projection and
current-session cost. A compact footer keeps your quota visible while you code.

Inside OpenCode:

| Command | What it does |
| --- | --- |
| `/ocquota` | Usage and local-budget details |
| `/themes` | Switch the workspace to any `ocquota-*` theme |
| `/motion` | Pause or resume the ambient strip |
| `/motion-next` | Cycle through the ten scenes |
| `/motion-faster` | Increase speed, up to 3× |
| `/motion-slower` | Decrease speed, down to 0.25× |

Live controls apply to the current OpenCode session. To persist your choice,
rerun the installer with `--animation` and `--speed`, or edit the plugin options:

```json
{
  "plugins": [{
    "package": "@kyzenn.raw/ocquota@0.4.0",
    "options": {
      "theme": "sakura",
      "animation": "sakura",
      "speed": 0.75,
      "motion": true,
      "limitTokens": 5000000,
      "window": "day",
      "refreshMs": 2000
    }
  }]
}
```

The installer copies the plugin locally and installs theme files into
`~/.config/opencode/themes`. If `XDG_CONFIG_HOME` is set, it uses that directory
instead. Preserve the installer's local `package` path when editing its options.
For themes, run the installer even if you load the plugin directly from npm.
Existing settings and plugins are preserved; config backups sit beside `cli.json`
or `cli.jsonc`. JSONC comments survive in the verbatim backup; the updated file
is formatted JSON. Existing global `animations: false` is respected.

## Codex: native themes and footer stats

```sh
ocquota codex-install --theme sakura
codex
```

Restart Codex. `/theme` selects any of the thirteen `ocquota-*` themes;
`/statusline` customizes built-in footer items. Themes color syntax, diffs and the
native footer; Codex controls its background and the rest of its UI.

New theme presets include model/reasoning mode, context remaining, used tokens,
input/output tokens, and five-hour/weekly account limits. Existing footer items
are retained. Account limit indicators appear when supplied by the account.
Use `/status` for further account/session details.

**Codex does not expose an arbitrary animated UI slot.** Falling scenes and the
complete local usage dashboard run in a separate terminal pane alongside Codex:

```sh
ocquota watch --source codex --theme sakura --animation sakura --speed 0.75
```

This companion follows live session logs without changing or wrapping Codex.
Codex logs do not supply billed dollar cost; reports display `N/A` for cost and
reject `--metric cost`. Local budgets are separate from provider account limits.

Codex setup respects `--codex-home`, `OCQUOTA_CODEX_HOME`, then `CODEX_HOME`,
then `~/.codex`. Existing TOML settings are preserved, with a private config
backup before changes. `--no-motion` disables Codex's native animations.

## Pick a theme

The ten new themes join Aurora, Ember and Mono. All thirteen are available for
the standalone CLI, OpenCode (light and dark) and Codex syntax/footer themes.

| Theme | Palette | Default scene |
| --- | --- | --- |
| `sakura` | Cherry blossom pink / soft violet | Sakura |
| `forest` | Fern green / woodland | Leaves |
| `ocean` | Tidal blue / sea glass | Waves |
| `midnight` | Indigo / silver | Stars |
| `matcha` | Moss / oat | Wind |
| `lavender` | Lilac / muted blue | Fireflies |
| `rose` | Rose clay / warm blush | Sakura |
| `sand` | Linen / soft gold | Wind |
| `glacier` | Pale cyan / ice blue | Snow |
| `neon` | Lime / lilac | Rain |
| `aurora` | Cyan / violet | Stars |
| `ember` | Amber / coral | Embers |
| `mono` | Neutral ink | Snow |

`--theme raw` keeps the original quota-bar layout. Preview any theme without a
database with `ocquota preview --theme forest --animation leaves`.

## Ten scenes, at your pace

| Scene | Motion |
| --- | --- |
| `sakura` | Cherry petals drifting down |
| `rain` | Light vertical rainfall |
| `leaves` | Green leaves drifting with a breeze |
| `wind` | Horizontal wisps |
| `snow` | Slow snowflakes |
| `fireflies` | Gently flickering lights |
| `stars` | Quiet twinkling sky |
| `bubbles` | Rising rings |
| `embers` | Warm rising sparks |
| `waves` | A moving wave line |

```sh
ocquota watch --theme forest --animation leaves --speed 0.5
ocquota watch --source codex --theme ocean --animation waves
ocquota watch --theme mono --no-motion
```

In an interactive watch terminal: **Space** pauses, **n** changes scene,
**+ / -** adjusts speed and **q / Ctrl-C** exits. Stats keep refreshing while
motion is paused. `--speed` accepts 0.25–3; it changes movement speed without
increasing frame rate. The current scene and speed are shown in the strip.

`OCQUOTA_ANIMATION` and `OCQUOTA_SPEED` set CLI defaults. Set
`OCQUOTA_REDUCED_MOTION=1` to disable ambient motion and meter interpolation.
For a persistent OpenCode setup without motion, run:

```sh
ocquota opencode-install --theme sakura --no-motion
```

Ambient motion is confined to a small fixed strip, capped at 24 particles and
roughly 6 frames/second. Data refreshes independently, using cached/incremental
reads. Timers stop on disposal; watch restores the terminal and input mode on
exit. Piped watch output is one static report. Glyph appearance depends on your
terminal font; modern Windows Terminal, macOS Terminal and iTerm2 work best.
The README SVG banner also respects browser reduced-motion preferences.

## Reports and budgets

```sh
ocquota                                      # today's local quota
ocquota watch --limit 5000000 --window day
ocquota watch --source codex --window week
ocquota bar --metric cost --limit-cost 20      # OpenCode only
ocquota oneline
ocquota json
ocquota totals
ocquota models
ocquota daily --days 14
ocquota top --n 10
ocquota explain
```

Every report supports `--source opencode|codex`. Windows, macOS and Linux use
native paths; quote paths with spaces:

```powershell
ocquota watch --source codex --codex-home "C:\Users\Your Name\.codex"
ocquota watch --db "C:\path with spaces\opencode.db"
```

Default OpenCode database: `~/.local/share/opencode/opencode.db`.
Default Codex logs: `~/.codex/sessions` and `~/.codex/archived_sessions`, including
plain and Zstandard-compressed JSONL. On Windows `~` means your user profile.
WSL keeps its own sessions; run ocquota inside WSL to read those sessions.

Config lives at `~/.config/ocquota/config.json`. Precedence is CLI → environment
→ config file → defaults. Useful options:

| CLI | Environment | Purpose |
| --- | --- | --- |
| `--db` | `OCQUOTA_DB` | OpenCode SQLite database |
| `--source` | `OCQUOTA_SOURCE` | Usage source |
| `--codex-home` | `OCQUOTA_CODEX_HOME`, `CODEX_HOME` | Codex home |
| `--theme` | `OCQUOTA_THEME` | Appearance |
| `--window` | `OCQUOTA_WINDOW` | `day`, `week`, `month` |
| `--limit` | `OCQUOTA_LIMIT` | Local token budget |
| `--limit-cost` | `OCQUOTA_LIMIT_COST` | Local cost budget, or `none` |
| `--metric` | `OCQUOTA_METRIC` | `tokens` or `cost` |
| `--refresh` | `OCQUOTA_REFRESH_MS` | Data refresh interval (250ms minimum) |
| `--tz` | `OCQUOTA_TZ` | IANA zone or UTC offset |
| `--animation` | `OCQUOTA_ANIMATION` | Decorative scene |
| `--speed` | `OCQUOTA_SPEED` | Movement multiplier |

Day/week/month windows follow your selected timezone, including DST. Cached reads
are excluded from the token budget. Session logs are deduplicated; file changes
are incrementally parsed. OpenCode access is read-only and native plugin reads
fail quickly on busy databases. No telemetry, network reporting or credential access.

## Build and verify

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bun run build:windows
```

The Windows build writes `dist/windows-x64/ocquota.exe` with native plugin files,
licenses and docs. Keep the folder together. CI builds a downloadable ZIP and
tests offline npm installation, standalone installation, real OpenTUI rendering,
settings preservation, light/dark contrast and Windows/macOS/Linux compatibility.

```sh
npm pack
npm install -g ./kyzenn.raw-ocquota-0.4.0.tgz
```

The npm package includes the bundled CLI, native TUI source/runtime and licenses.
`npm publish` runs type checking and tests first. Publishing requires npm login.
The [logo](assets/logo.svg) and [animated banner](assets/banner.svg) are original
SVG assets; `docs/preview.html` is a local visual-review page.

Built on the supported [OpenCode TUI plugin API](https://opencode.ai/docs/build/plugins/cli/)
and [Codex TUI configuration](https://github.com/openai/codex/blob/main/codex-rs/config/src/types.rs).
See [CHANGELOG.md](CHANGELOG.md) for releases. Claude Code support is not included.
