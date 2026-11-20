# Changelog

## 0.4.0 — 2026-11-20

- Prioritize provider-reported account allowance over optional local targets in a cleaner model-aware OpenCode sidebar.
- Add authenticated OpenAI/OpenRouter quota readers, actual Groq/NVIDIA response-header observation and OpenCode Console usage projection, without inferred free token totals.
- Add a compact Codex account companion panel and right-pane launch helpers for Windows Terminal and tmux.
- Migrate native installs to the supported server/RPC/TUI package layout, preserve both configurations and mark unavailable/stale counters honestly.

- Add ten workspace themes: Sakura, Forest, Ocean, Midnight, Matcha, Lavender, Rose, Sand, Glacier and Neon, alongside Aurora, Ember and Mono.
- Add ten bounded ambient motion scenes with live pause, style and speed controls in OpenCode and the standalone watch view.
- Show input/output, reasoning and cache statistics directly in the OpenCode sidebar; install all thirteen themes for Codex with live native footer statistics.
- Add an animated SVG README banner, original SVG logo, full setup instructions and honest integration boundaries.

- Add a standalone Windows x64 executable build with bundled Bun and native plugin files.
- Fix native OpenCode installation from compiled executables.
- Add Windows, macOS and Linux CI, including offline npm installation and standalone integration setup.

## 0.3.0 — 2026-11-20

- Add `codex-install` for native Aurora, Ember and Mono themes and live Codex CLI footer stats.
- Preserve existing Codex settings and footer items with a private config backup; support custom Codex homes and reduced motion.

## 0.2.0 — 2026-11-19

- Native OpenCode 2.3.2+ TUI plugin: sidebar budget meter, compact footer and `/ocquota` command.
- Aurora, Ember and Mono themes for OpenCode itself, with light and dark modes.
- One-time `opencode-install` setup with config backups and preserved plugin settings.
- Native statistics fail fast on database locks instead of blocking OpenCode's UI.

## 0.1.0

Initial release.

- Read-only OpenCode and Codex token usage with daily, weekly, and monthly budgets.
- Aurora, Ember, Mono, and the original Raw terminal view.
- Live watch mode with optional animation and terminal restoration on exit.
- JSON, totals, model, daily, and top-session reports.
- Compressed Codex session support and deduplication of usage records.
- Bundled CLI for global npm or Bun installation; requires Bun 1.4.4 or newer.
