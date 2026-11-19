import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { testRender } from "@opentui/solid";
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
  const view = await testRender(() => <NativeSidebar context={context} snapshot={snapshot} error={error} motion={false} sessionID="test" />, { width: 34, height: 18 });
  try {
    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("ocquota");
    expect(frame).toContain("37.2%");
    expect(frame).toContain("1.9M / 5M");
    expect(frame).toContain("This session $1.25");
    setSnapshot({ ...DEMO_SNAPSHOT, used: 6_000_000, percent: 1.2 });
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("1M over budget");
    setError("database locked");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Usage unavailable");
  } finally { await view.dispose(); }
});

test("native footer remains compact and marks cached statistics stale on error", async () => {
  const context = { theme: resolveThemeDocument(nativeThemes.ember, "light"), data: { session: { cost: () => 0 } } };
  const [error, setError] = createSignal("");
  const view = await testRender(() => <NativeFooter context={context} snapshot={() => DEMO_SNAPSHOT} error={error} motion={false} />, { width: 42, height: 2 });
  try {
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("37.2% · 1.9M tokens");
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
    await command!.run();
    expect(message).toContain("123 tokens");
    expect(message).toContain("877 remaining");
  } finally {
    if (cleanup) await cleanup();
    fixture.close();
  }
  expect(disposed).toBe(3);
});
