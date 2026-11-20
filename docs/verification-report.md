# ocquota 0.4.0 verification report

Date: 20 November 2026. Scope includes the screenshot-driven account/UI changes,
thirteen themes, ten motion scenes, packaging and Windows compatibility.

## What changed

- OpenCode's selected model/provider now anchors a compact account-allowance
  section. Actual local usage stays in its own section. The former default `5M`
  local target is hidden unless explicitly requested; it is never an account cap.
- Local per-model and all-model totals, expanded token/cache/recorded-cost details,
  source/freshness/reset labels and live animation controls are supported.
- Codex has a compact `panel` companion and a `pane` helper for Windows Terminal
  and tmux. Native Codex themes/footer remain supported; no unsupported Codex
  sidebar injection is attempted.
- The OpenCode install now loads a server/RPC/TUI package through
  `opencode.json(c)`, migrating the previous TUI-only entry while preserving both
  configuration files and writing backups.

## Live verification

| Check | Result |
| --- | --- |
| Read-only quota request using existing Codex OAuth | Passed: OpenAI returned the plan and two allowance windows |
| Packaged server/RPC loaded by a real isolated OpenCode 2.3.2 host | Passed |
| Direct OpenCode token-sharing quota access | Provider rejected access; verified limitation, not a fabricated allowance |
| Explicit same-account Codex link through that real OpenCode host | Passed: real shared-plan windows, with linked source and unavailable app-specific cap labeled |
| Existing OpenRouter connection, quota-only endpoint | Passed: API returned a valid quota metric |
| Groq/NVIDIA live remaining counters | No observed model response in the isolated read-only check; correctly unavailable |
| Interactive 80×24 watch | Scene switch, speed, pause, quit, token details and terminal restoration passed |
| SVG artwork | Static banner/logo rendered and inspected; live browser animation preview unavailable |

No inference prompts were sent for account verification. Tokens, account identifiers,
provider keys and exact personal usage figures are omitted from this public report.
Same-account linking is explicit user confirmation, not automatic identity matching.

## Automated coverage

**Local result:** type checking passed; 102 tests passed, zero failed (18 files).

The suite covers:

- Actual OpenTUI sidebar/footer rendering, selected-model changes, stale state,
  out-of-order response rejection, expansion and scene controls.
- Account parser validation; no invented token allowance; distinct percentages,
  daily requests, per-minute tokens and dollar caps; missing/null quota data.
- OpenRouter free-model counters and key/effective spending caps; Console budgets
  scoped to the selected model; Groq documented header-window semantics.
- Account/model isolation, capture without consuming or replacing inference bodies,
  explicit linked-login source labels, shared-account cache reuse and cleanup.
- Bounded/deterministic motion, ten scenes, thirteen palettes, light/dark contrast,
  reduced motion and invalid setting rejection.
- Existing SQLite read-only behavior, timezone/DST windows, Codex log parsing and
  deduplication, installer preservation, offline npm installation and standalone setup.

Final suite and cross-platform CI results are recorded in the release notes and
linked workflow. Fixture tests verify parsing/security behavior; they do not imply
that every provider exposes a live quota API or that its capacity is unlimited.

## Data guarantees and limits

1. OpenAI allowance is provider-reported percentages/reset windows. Plus does not
   supply a fixed remaining token package. Named additional pools remain named.
2. The user's OpenCode login uses token-sharing, which currently cannot read the
   account usage endpoint. The approved Codex link supplies real shared-plan data;
   it does **not** expose the separate OpenCode app-specific cap.
3. OpenRouter request allowance and dollar spending caps retain their units and
   scopes. A key spending cap is not automatically the account's full balance.
4. Groq/NVIDIA capture only supported quota headers from actual HTTPS responses.
   If none are returned, quota remains unavailable. Public tier limits are not
   substituted for account-specific remaining capacity.
5. OpenCode free models, other routers and missing Console quotas have no invented
   total/reset. Local recorded usage remains available independently.
6. Codex's companion follows the latest modified local session record. It cannot
   observe an unsubmitted model-picker change or guarantee one-terminal binding
   when several sessions are active. Native custom sidebar support is unavailable.
7. Account snapshots are cached in memory for 60 seconds, with deduplicated reads.
   Old observed headers are marked stale. Requests use fixed HTTPS hosts, timeouts
   and disabled redirects. Credentials are not written into counters or reports.

## Dependency audit

- `bun audit --production`: passed; this package has no production dependency
  packages to audit. Its CLI and projection code are bundled.
- Full development-tree audit: two moderate advisory groups remain in existing
  `glob` and `minimatch` transitive dependencies of the OpenCode/OpenTUI development
  toolchain. They are not copied into the CLI package as runtime dependencies.
  OpenCode owns its externally supplied host SDK/runtime dependencies.
- Major transitive overrides were not forced across the host SDK's declared
  ranges. Reassess with the next compatible upstream SDK/toolchain update, by
  27 November 2026. This is a documented development-tool risk, not a clean full audit.

## Primary references

- [OpenCode plugin parts and loading](https://opencode.ai/docs/build/plugins/)
- [OpenCode server hooks](https://opencode.ai/docs/build/plugins/server/)
- [OpenCode RPC](https://opencode.ai/docs/build/plugins/rpc/)
- [OpenCode credential storage](https://opencode.ai/docs/cli/providers)
- [OpenAI usage request implementation](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)
- [OpenAI token-sharing quota limitation](https://github.com/openai/codex/issues/54219)
- [OpenRouter quota fields and scopes](https://openrouter.ai/docs/api_reference/limits)
- [Groq quota headers](https://console.groq.com/docs/rate-limits)
- [NVIDIA's explanation of variable free-tier limits](https://forums.developer.nvidia.com/t/api-rate-limit-increase-is-not-granted-by-requesting-it-here/368420)
