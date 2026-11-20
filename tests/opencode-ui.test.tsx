import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { testRender, type JSX } from "@opentui/solid";
import { resolveThemeDocument } from "@opencode/theme/tui";
import type { QuotaSnapshot } from "../src/core/types.ts";
import nativePlugin, { NativeFooter, NativeSidebar } from "../src/opencode/tui.tsx";
import type { Context, KeymapLayer } from "@opencode/plugin/tui/context";
import { Fixture, assistantData } from "./helpers/fixture-db.ts";
import { nativeThemes } from "../src/opencode/themes.ts";
import { DEMO_SNAPSHOT } from "../src/render/theme-renderer.ts";

test("native sidebar renders real OpenTUI elements and updates budget state", async () => {
  const context = { theme: resolveThemeDocument(nativeThemes.aurora, "dark"), data: { session: { cost: () => 1.25 } } };
  const [snapshot, setSnapshot] = createSignal<QuotaSnapshot | undefined>(DEMO_SNAPSHOT);
  const [error, setError] = createSignal("");
  const view = await testRender(() => <NativeSidebar context={context} snapshot={snapshot} error={error} motion={false} budgetVisible={true} details={() => true} sessionID="test" />, { width: 40, height: 25 });
  try {
    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("ocquota");
    expect(frame).toContain("LOCAL");
    expect(frame).toContain("1.9M / 5M");
    expect(frame).toContain("This session $1.25");
    expect(frame).toContain("Reasoning 180K");
    expect(frame).toContain("Cache read 8.4M");
    setSnapshot({ ...DEMO_SNAPSHOT, used: 6_000_000, percent: 1.2 });
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("1M over budget");
    setError("database locked");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Local usage stale");
  } finally { await view.dispose(); }
});

test("native footer remains compact and marks cached statistics stale on error", async () => {
  const context = { theme: resolveThemeDocument(nativeThemes.ember, "light"), data: { session: { cost: () => 0 } } };
  const [error, setError] = createSignal("");
  const view = await testRender(() => <NativeFooter context={context} snapshot={() => DEMO_SNAPSHOT} error={error} motion={false} />, { width: 42, height: 2 });
  try {
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("1.9M local tokens");
    setError("connection lost");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("stale");
  } finally { await view.dispose(); }
});

test("native plugin registers reachable slash commands backed by database usage and cleans up slots", async () => {
  const fixture = new Fixture();
  fixture.message({ timeCreated: Date.now(), data: assistantData({ input: 123 }) });
  let layer: KeymapLayer | undefined;
  let message = "";
  let disposed = 0;
  const context = {
    options: { dbPath: fixture.path, limitTokens: 1000, metric: "tokens", window: "month", timezone: "UTC", motion: false },
    theme: resolveThemeDocument(nativeThemes.aurora, "dark"),
    keymap: { layer: (factory: () => KeymapLayer) => { layer = factory(); } },
    ui: { slot: () => () => { disposed++; }, dialog: { alert: async (value: { message: string }) => { message = value.message; } } },
  } as unknown as Context;
  const cleanup = await nativePlugin.setup(context);
  try {
    expect(layer?.mode).toBe("global");
    const command = layer?.commands?.find((item) => item.slash?.name === "ocquota");
    expect(command).toBeDefined();
    for (const name of ["motion", "motion-next", "motion-faster", "motion-slower"]) {
      const control = layer?.commands?.find((item) => item.slash?.name === name);
      expect(control).toBeDefined();
      await control!.run();
    }
    await command!.run();
    expect(message).toContain("123 tokens");
    expect(message).toContain("877 remaining");
  } finally {
    if (cleanup) await cleanup();
    fixture.close();
  }
  expect(disposed).toBe(3);
});

test("native ambient strip responds to live pause and scene changes", async () => {
  const { NativeScene } = await import("../src/opencode/tui.tsx");
  const context = { theme: resolveThemeDocument(nativeThemes.sakura, "dark"), data: { session: { cost: () => 0 } } };
  const [enabled, setEnabled] = createSignal(true);
  const [style, setStyle] = createSignal<"sakura" | "rain">("sakura");
  const view = await testRender(() => <NativeScene context={context} snapshot={() => undefined} error={() => ""} motion={enabled()} animation={style()} speed={0.75} />, { width: 24, height: 5 });
  try {
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("sakura · 0.75x");
    setStyle("rain");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("rain · 0.75x");
    setEnabled(false);
    await view.renderOnce();
    expect(view.captureCharFrame().trim()).toBe("");
  } finally { await view.dispose(); }
});

test("selected-model changes discard slow quota responses from the previous selection", async () => {
  const fixture = new Fixture();
  const [selection, setSelection] = createSignal({ providerID: "openai", modelID: "model-a" });
  const pending = new Map<string, (value: unknown) => void>();
  let sidebar!: (input: { sessionID: string }) => JSX.Element;
  const context = {
    options: { dbPath: fixture.path, motion: false }, theme: resolveThemeDocument(nativeThemes.sakura, "dark"),
    data: { session: { cost: () => 0 }, location: { provider: { list: () => [] } }, on: () => () => {} },
    client: { rpc: () => ({ read: (input: { modelID: string }) => new Promise((resolve) => pending.set(input.modelID, resolve)) }) },
    keymap: { layer: () => {} },
    ui: { model: { current: selection }, slot: (claim: { append: string; render: typeof sidebar }) => { if (claim.append === "sidebar.content") sidebar = claim.render; return () => {}; } },
  } as unknown as Context;
  const cleanup = await nativePlugin.setup(context);
  const view = await testRender(() => sidebar({ sessionID: "s" }), { width: 42, height: 26 });
  const quota = (remaining: number) => ({ provider: "openai", status: "live", source: "OpenAI", note: "account", fetchedAt: Date.now(), plan: "plus", meters: [{ label: "5h window", unit: "percent", scope: "account", remaining, limit: 100 }] });
  try {
    await view.renderOnce();
    setSelection({ providerID: "openai", modelID: "model-b" });
    await view.renderOnce();
    pending.get("model-a")!(quota(99)); await Promise.resolve(); await view.renderOnce();
    expect(view.captureCharFrame()).not.toContain("99% left");
    pending.get("model-b")!(quota(10)); await Promise.resolve(); await view.renderOnce();
    expect(view.captureCharFrame()).toContain("model-b"); expect(view.captureCharFrame()).toContain("10% left");
    expect(view.captureCharFrame()).not.toContain("5M");
  } finally { await view.dispose(); if (cleanup) await cleanup(); fixture.close(); }
});
