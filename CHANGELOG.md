# Changelog

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
