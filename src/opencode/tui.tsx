import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type Accessor } from "solid-js";
import { clamp, formatCompact, formatDuration, formatMoney, formatPercent, friendlyMessage, openNativeUsage, type QuotaSnapshot } from "./runtime.ts";

interface ViewProps {
  context: Pick<Context, "theme"> & { data: { session: Pick<Context["data"]["session"], "cost"> } };
  snapshot: Accessor<QuotaSnapshot | undefined>;
  error: Accessor<string>;
  motion: boolean;
  limitConfigured?: boolean;
}

function value(snapshot: QuotaSnapshot, amount: number): string {
  return snapshot.metric === "cost" ? formatMoney(amount) : formatCompact(amount);
}

function status(snapshot: QuotaSnapshot, configured = snapshot.limit > 0): string {
  if (!configured) return "No limit set";
  if (snapshot.used > snapshot.limit) return `${value(snapshot, snapshot.used - snapshot.limit)} over budget`;
  if (snapshot.used === snapshot.limit) return "Budget reached";
  return `${value(snapshot, snapshot.limit - snapshot.used)} remaining`;
}

function color(props: ViewProps) {
  const theme = props.context.theme;
  const percent = props.snapshot()?.percent ?? 0;
  const snapshot = props.snapshot();
  const reached = snapshot && (props.limitConfigured ?? snapshot.limit > 0) && snapshot.used >= snapshot.limit;
  return reached || percent >= 1 ? theme.text.feedback.error.base : percent >= 0.8 ? theme.text.feedback.warning.base : theme.hue.accent[300];
}

function Meter(props: ViewProps) {
  const [fill, setFill] = createSignal(0);
  createEffect(() => {
    const snapshot = props.snapshot();
    const target = snapshot?.limit === 0 && props.limitConfigured && snapshot.used > 0 ? 1 : clamp(snapshot?.percent ?? 0, 0, 1);
    if (!props.motion) { setFill(target); return; }
    const initial = untrack(fill);
    if (initial === target) return;
    const started = performance.now();
    const timer = setInterval(() => {
      const progress = clamp((performance.now() - started) / 240, 0, 1);
      setFill(initial + (target - initial) * (1 - (1 - progress) ** 3));
      if (progress >= 1) clearInterval(timer);
    }, 30);
    onCleanup(() => clearInterval(timer));
  });
  const cells = createMemo(() => Math.round(fill() * 22));
  return <text><span style={{ fg: color(props) }}>{"━".repeat(cells())}</span><span style={{ fg: props.context.theme.border.base }}>{"─".repeat(22 - cells())}</span></text>;
}

export function NativeSidebar(props: ViewProps & { sessionID?: string }) {
  const theme = () => props.context.theme;
  return <box flexDirection="column" gap={0} paddingTop={1}>
    <text fg={theme().text.base}><strong>ocquota</strong><span style={{ fg: theme().text.muted }}> · local budget</span></text>
    <Show when={props.snapshot()} fallback={<text fg={theme().text.muted}>Waiting for usage…</text>}>{(snapshot: Accessor<QuotaSnapshot>) => <>
      <text fg={color(props)}><strong>{snapshot().limit > 0 ? formatPercent(snapshot().percent) : "—"}</strong><span style={{ fg: theme().text.muted }}> · {snapshot().windowKind} window</span></text>
      <Meter {...props} />
      <text fg={theme().text.base}>{value(snapshot(), snapshot().used)} / {(props.limitConfigured ?? snapshot().limit > 0) ? value(snapshot(), snapshot().limit) : "no limit"}</text>
      <text fg={color(props)}>{status(snapshot(), props.limitConfigured)}</text>
      <box flexDirection="column" paddingTop={1}>
        <text fg={theme().text.muted}>Tokens <span style={{ fg: theme().text.base }}>{formatCompact(snapshot().totalTokens)}</span> · Cost <span style={{ fg: theme().text.base }}>{formatMoney(snapshot().cost)}</span></text>
        <text fg={theme().text.muted}>{snapshot().sessions} sessions · {snapshot().messages} messages</text>
        <text fg={theme().text.muted}>Reset in {formatDuration(snapshot().resetAt - snapshot().takenAt)}</text>
        <Show when={snapshot().burnRatePerHour > 0}><text fg={theme().text.muted}>{value(snapshot(), snapshot().burnRatePerHour)}/h · {snapshot().projection}</text></Show>
      </box>
      <Show when={props.sessionID}><box paddingTop={1} flexDirection="column">
        <text fg={theme().text.muted}>This session <span style={{ fg: theme().text.base }}>{formatMoney(props.context.data.session.cost(props.sessionID!))}</span></text>
      </box></Show>
    </>}</Show>
    <Show when={props.error()}><text fg={theme().text.feedback.warning.base}>Usage unavailable · /ocquota for details</text></Show>
    <text fg={theme().text.faint}>/ocquota · /themes</text>
  </box>;
}

export function NativeFooter(props: ViewProps) {
  return <Show when={props.snapshot()}>{(snapshot: Accessor<QuotaSnapshot>) => <text fg={color(props)}>
    {" ◈ "}{snapshot().limit > 0 ? formatPercent(snapshot().percent) : "Quota"}{" · "}{formatCompact(snapshot().totalTokens)}{" tokens"}
    <Show when={props.error()}><span style={{ fg: props.context.theme.text.feedback.warning.base }}> · stale</span></Show>
  </text>}</Show>;
}

// Native slots and commands: https://opencode.ai/docs/build/plugins/cli/
export default Plugin.define({
  id: "ocquota.native",
  setup(context) {
    const [snapshot, setSnapshot] = createSignal<QuotaSnapshot>();
    const [error, setError] = createSignal("");
    let usage: ReturnType<typeof openNativeUsage> | undefined;
    const refresh = () => {
      try {
        usage ??= openNativeUsage(context.options);
        setSnapshot(usage.refresh()); setError("");
      } catch (cause) { setError(friendlyMessage(cause)); }
    };
    refresh();
    const timer = setInterval(refresh, Math.max(1000, usage?.config.refreshMs ?? 2000));
    const props: ViewProps = { context, snapshot, error,
      get motion() { return usage?.motion ?? false; },
      get limitConfigured() { return usage ? usage.config.metric !== "cost" || usage.config.limitCost !== null : false; },
    };
    const cleanups = [
      context.ui.slot({ append: "sidebar.content", render: (input) => <NativeSidebar {...props} sessionID={input.sessionID} /> }),
      context.ui.slot({ append: "prompt.footer.status", render: (input) => <Show when={input.sessionID && input.mode === "normal"}><NativeFooter {...props} /></Show> }),
      context.ui.slot({ append: "home.footer.status", render: () => <NativeFooter {...props} /> }),
      context.keymap.layer(() => ({ mode: "global", commands: [{ id: "ocquota.details", title: "Show usage and budget", group: "ocquota", palette: true,
        slash: { name: "ocquota" }, run: async () => {
          refresh();
          const current = snapshot();
          await context.ui.dialog.alert({ title: "ocquota · local usage budget", message: error() || (current
            ? `${formatCompact(current.totalTokens)} tokens · ${formatMoney(current.cost)}\n${status(current, props.limitConfigured)}\n${current.sessions} sessions · ${current.messages} messages\nResets in ${formatDuration(current.resetAt - current.takenAt)}\n\nChange the whole workspace theme with /themes → ocquota-aurora, ocquota-ember or ocquota-mono.\nCached reads are excluded. This is your local budget, not a provider account limit.`
            : "Start an OpenCode session to see usage.") });
        } }] })),
    ];
    return () => { clearInterval(timer); for (const cleanup of cleanups) if (cleanup) cleanup(); usage?.close(); };
  },
});
