import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { createEffect, createMemo, createSignal, createRoot, For, onCleanup, Show, untrack, type Accessor } from "solid-js";
import { clamp, formatCompact, formatDuration, formatMoney, friendlyMessage, openNativeUsage, type QuotaSnapshot, renderMotion, MOTION_STYLES, type MotionStyle, accountLines, parseConsoleUsage, unavailable, type AccountSnapshot, type ModelTotals, type QuotaMeter } from "./runtime.ts";

import { accountRpc } from "./rpc.ts";

interface ViewProps {
  context: Pick<Context, "theme"> & { data: { session: Pick<Context["data"]["session"], "cost"> } };
  snapshot: Accessor<QuotaSnapshot | undefined>;
  error: Accessor<string>;
  motion: boolean;
  animation?: MotionStyle;
  speed?: number;
  limitConfigured?: boolean;
  budgetVisible?: boolean;
  account?: Accessor<AccountSnapshot | undefined>;
  models?: Accessor<ModelTotals[]>;
  selection?: Accessor<{ providerID: string; modelID: string } | undefined>;
  details?: Accessor<boolean>;
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

export function NativeScene(props: ViewProps) {
  const [frame, setFrame] = createSignal("");
  let elapsed = 0;
  createEffect(() => {
    const enabled = props.motion;
    const style = props.animation ?? "sakura";
    const speed = props.speed ?? 1;
    if (!enabled) return;
    let last = performance.now();
    const draw = () => {
      const now = performance.now();
      elapsed += (now - last) * speed;
      last = now;
      setFrame(renderMotion(style, elapsed, 22, 3));
    };
    draw();
    const timer = setInterval(draw, 180);
    onCleanup(() => clearInterval(timer));
  });
  return <Show when={props.motion}><box height={4} flexShrink={0} flexDirection="column">
    <text fg={props.context.theme.hue.accent[300]}>{frame()}</text>
    <text fg={props.context.theme.text.faint}>{props.animation ?? "sakura"} · {props.speed ?? 1}x</text>
  </box></Show>;
}

export function NativeSidebar(props: ViewProps & { sessionID?: string }) {
  const theme = () => props.context.theme;
  const selected = createMemo(() => props.selection?.());
  const modelUsage = createMemo(() => props.models?.().find((item) => item.providerId === selected()?.providerID && item.modelId === selected()?.modelID));
  const lines = createMemo(() => accountLines(props.account?.(), props.snapshot()?.takenAt ?? Date.now(), props.details?.() ?? false));
  return <box flexDirection="column" gap={0} paddingTop={1}>
    <text fg={theme().text.base}><strong>ocquota</strong><span style={{ fg: theme().text.muted }}> · live usage</span></text>
    <Show when={selected()}>{(model: Accessor<{ providerID: string; modelID: string }>) => <>
      <text fg={theme().hue.accent[300]}>{model().modelID}</text>
      <text fg={theme().text.muted}>{model().providerID}</text>
    </>}</Show>
    <NativeScene {...props} />
    <box paddingTop={1} flexDirection="column">
      <For each={lines()}>{(line, index) => <text fg={index() === 0 ? theme().text.base : theme().text.muted}>{line}</text>}</For>
    </box>
    <Show when={props.snapshot()} fallback={<text fg={theme().text.muted}>Waiting for local usage…</text>}>{(snapshot: Accessor<QuotaSnapshot>) => <>
      <box paddingTop={1} flexDirection="column">
        <text fg={theme().text.base}><strong>LOCAL · {snapshot().windowKind}</strong></text>
        <Show when={modelUsage()}>{(usage: Accessor<ModelTotals>) => <text fg={theme().hue.accent[300]}>This model {formatCompact(usage().totalTokens)} tokens</text>}</Show>
        <text fg={theme().text.muted}>All models {formatCompact(snapshot().totalTokens)} tokens</text>
        <text fg={theme().text.muted}>{snapshot().sessions} sessions · {snapshot().messages} messages</text>
      </box>
      <Show when={props.budgetVisible}><box paddingTop={1} flexDirection="column">
        <text fg={theme().text.muted}>YOUR LOCAL TARGET · not account quota</text>
        <Meter {...props} />
        <text fg={color(props)}>{value(snapshot(), snapshot().used)} / {value(snapshot(), snapshot().limit)}</text>
        <text fg={color(props)}>{status(snapshot(), props.limitConfigured)}</text>
      </box></Show>
      <Show when={props.details?.()}><box paddingTop={1} flexDirection="column">
        <text fg={theme().text.muted}>In {formatCompact(snapshot().tokens.input)} · Out {formatCompact(snapshot().tokens.output)}</text>
        <text fg={theme().text.muted}>Reasoning {formatCompact(snapshot().tokens.reasoning)}</text>
        <text fg={theme().text.muted}>Cache read {formatCompact(snapshot().tokens.cacheRead)} (excluded)</text>
        <text fg={theme().text.muted}>Cache write {formatCompact(snapshot().tokens.cacheWrite)}</text>
        <text fg={theme().text.muted}>Recorded cost {formatMoney(snapshot().cost)}</text>
        <Show when={props.sessionID}><text fg={theme().text.muted}>This session {formatMoney(props.context.data.session.cost(props.sessionID!))}</text></Show>
        <text fg={theme().text.faint}>Recorded cost is not subscription billing.</text>
      </box></Show>
    </>}</Show>
    <Show when={props.error()}><text fg={theme().text.feedback.warning.base}>Local usage stale · /ocquota</text></Show>
    <text fg={theme().text.faint}>/ocquota · /ocquota-details · /motion</text>
  </box>;
}

export function NativeFooter(props: ViewProps) {
  const primary = () => props.account?.()?.meters.find((meter) => meter.unit === "percent");
  return <Show when={props.snapshot()}>{(snapshot: Accessor<QuotaSnapshot>) => <text fg={props.context.theme.hue.accent[300]}>
    {" ◈ "}{formatCompact(snapshot().totalTokens)}{" local tokens"}
    <Show when={primary()}>{(meter: Accessor<QuotaMeter>) => <span>{" · "}{meter().remaining}% account left</span>}</Show>
    <Show when={props.error() || props.account?.()?.status === "stale"}><span style={{ fg: props.context.theme.text.feedback.warning.base }}> · stale</span></Show>
  </text>}</Show>;
}

// Native slots and commands: https://opencode.ai/docs/build/plugins/cli/
export default Plugin.define({
  id: "ocquota.native",
  setup(context) {
    const [snapshot, setSnapshot] = createSignal<QuotaSnapshot>();
    const [error, setError] = createSignal("");
    const [account, setAccount] = createSignal<AccountSnapshot>();
    const [models, setModels] = createSignal<ModelTotals[]>([]);
    const [details, setDetails] = createSignal(false);
    let usage: ReturnType<typeof openNativeUsage> | undefined;
    const refresh = () => {
      try {
        usage ??= openNativeUsage(context.options);
        setSnapshot(usage.refresh()); setModels(usage.models()); setError("");
      } catch (cause) { setError(friendlyMessage(cause)); }
    };
    refresh();
    const [enabled, setEnabled] = createSignal(usage?.motion ?? false);
    const [animation, setAnimation] = createSignal<MotionStyle>(usage?.scene.animation ?? "sakura");
    const [speed, setSpeed] = createSignal(usage?.scene.speed ?? 1);
    const timer = setInterval(refresh, Math.max(1000, usage?.config.refreshMs ?? 2000));
    const disposeAccounts = createRoot((dispose) => {
      createEffect(() => {
        const selected = context.ui.model?.current();
        setAccount(undefined);
        if (!selected) { setAccount(unavailable("none", "Select a model to inspect its provider allowance.")); return; }
        let controller = new AbortController();
        let active = true, generation = 0;
        const update = async () => {
          const request = ++generation;
          controller.abort(); controller = new AbortController();
          const signal = controller.signal;
          try {
            const provider = context.data.location?.provider.list(context.location)?.find((item) => item.id === selected.providerID);
            const canonical = provider?.canonical ?? provider?.integrationID ?? selected.providerID;
            const result = canonical.startsWith("opencode")
              ? parseConsoleUsage((await context.client.experimental.usage.limits({}, { signal })).data, selected.providerID, selected.modelID)
              : await context.client.rpc(accountRpc).read(selected, { signal });
            if (active && request === generation) setAccount(result);
          } catch { if (active && request === generation) setAccount(unavailable(selected.providerID, "Account adapter unavailable. Run the updated installer and restart OpenCode.")); }
        };
        void update();
        const accountTimer = setInterval(() => { void update(); }, 30000);
        const changed = context.data.on?.("credential.switched", () => { setAccount(undefined); void update(); });
        onCleanup(() => { active = false; controller.abort(); clearInterval(accountTimer); changed?.(); });
      });
      return dispose;
    });
    const props: ViewProps = { context, snapshot, error, account, models, details,
      selection: () => context.ui.model?.current(),
      get budgetVisible() { return usage?.budgetVisible ?? false; },
      get motion() { return enabled() && process.env["OCQUOTA_REDUCED_MOTION"] !== "1"; },
      get animation() { return animation(); },
      get speed() { return speed(); },
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
            ? `${accountLines(account()).join("\n")}\n${account()?.note ?? ""}\nSource: ${account()?.source ?? "pending"}\n\nLOCAL USAGE\n${formatCompact(current.totalTokens)} tokens · ${formatMoney(current.cost)}\n${status(current, props.limitConfigured)}\n${current.sessions} sessions · ${current.messages} messages\nResets in ${formatDuration(current.resetAt - current.takenAt)}\n\nChange the whole workspace theme with /themes → any ocquota theme.\n/motion pauses decor; /motion-next changes scene; /motion-faster and /motion-slower adjust speed.\nCached reads are excluded. This is your local budget, not a provider account limit.`
            : "Start an OpenCode session to see usage.") });
        } },
        { id: "ocquota.expand", title: "Toggle detailed local statistics", group: "ocquota", palette: true, slash: { name: "ocquota-details" }, run: () => { setDetails((value) => !value); } },
        { id: "ocquota.motion", title: "Pause or resume ambient motion", group: "ocquota", palette: true, slash: { name: "motion" }, run: () => { setEnabled((value) => !value); } },
        { id: "ocquota.motion.next", title: "Next ambient scene", group: "ocquota", palette: true, slash: { name: "motion-next" }, run: () => { setAnimation((value) => MOTION_STYLES[(MOTION_STYLES.indexOf(value) + 1) % MOTION_STYLES.length]!); } },
        { id: "ocquota.motion.faster", title: "Speed up ambient motion", group: "ocquota", palette: true, slash: { name: "motion-faster" }, run: () => { setSpeed((value) => Math.min(3, value + 0.25)); } },
        { id: "ocquota.motion.slower", title: "Slow down ambient motion", group: "ocquota", palette: true, slash: { name: "motion-slower" }, run: () => { setSpeed((value) => Math.max(0.25, value - 0.25)); } },
        ] })),
    ];
    return () => { disposeAccounts(); clearInterval(timer); for (const cleanup of cleanups) if (cleanup) cleanup(); usage?.close(); };
  },
});
