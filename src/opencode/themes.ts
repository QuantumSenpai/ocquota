import type { ThemeDocument } from "@opencode/theme/tui";

import { WORKSPACE_THEMES, palettes, type WorkspaceTheme } from "../core/themes.ts";
export type NativeTheme = WorkspaceTheme;

function mix(a: string, b: string, weight: number): string {
  const rgb = [0, 2, 4].map((offset) => Math.round(
    parseInt(a.slice(1 + offset, 3 + offset), 16) * (1 - weight) + parseInt(b.slice(1 + offset, 3 + offset), 16) * weight,
  ).toString(16).padStart(2, "0"));
  return `#${rgb.join("")}`;
}

function scale(color: string, background: string, light: boolean): Record<number, string> {
  const contrast = light ? "#10151e" : "#edf2fa";
  const anchor = light ? mix(color, contrast, 0.45) : color;
  return Object.fromEntries([100, 200, 300, 400, 500, 600, 700, 800, 900].map((step, index) => [step,
    index < 3 ? mix(anchor, contrast, (3 - index) * 0.23) : mix(anchor, background, (index - 3) / 5),
  ]));
}

const feedback = { error: { base: "$hue.red.300" }, warning: { base: "$hue.yellow.300" },
  success: { base: "$hue.green.300" }, info: { base: "$hue.blue.300" } };
const actions = { primary: { base: "$hue.interactive.300", $hovered: "$hue.interactive.200" },
  secondary: { base: "$hue.neutral.200" }, destructive: { base: "$hue.red.300" } };
const base: ThemeDocument["base"] = {
  categorical: ["accent", "purple", "green", "blue"],
  text: { base: "$hue.neutral.100", muted: "$hue.neutral.400", faint: "$hue.neutral.400", action: actions,
    formfield: { base: "$hue.neutral.100" }, feedback },
  background: { base: "$hue.neutral.900", raised: { base: "$hue.neutral.800", high: "$hue.neutral.700", max: "$hue.neutral.600" },
    action: { primary: { base: "$hue.interactive.800", $hovered: "$hue.interactive.700" },
      secondary: { base: "$hue.neutral.800" }, destructive: { base: "$hue.red.800" } },
    formfield: { base: "$hue.neutral.800", $focused: "$hue.neutral.700" },
    feedback: { error: { base: "$hue.red.800" }, warning: { base: "$hue.yellow.800" }, success: { base: "$hue.green.800" }, info: { base: "$hue.blue.800" } } },
  border: { base: "$hue.neutral.700" }, scrollbar: { base: "$hue.neutral.600" },
  diff: { text: { added: "$hue.green.200", removed: "$hue.red.200", context: "$hue.neutral.200", hunkHeader: "$hue.purple.300" },
    background: { added: "$hue.green.800", removed: "$hue.red.800", context: "transparent" },
    highlight: { added: "$hue.green.700", removed: "$hue.red.700" },
    lineNumber: { text: "$hue.neutral.500", background: { added: "$hue.green.800", removed: "$hue.red.800" } } },
  syntax: { comment: "$hue.neutral.400", keyword: "$hue.purple.300", function: "$hue.blue.300", variable: "$hue.neutral.200",
    string: "$hue.green.300", number: "$hue.orange.300", type: "$hue.cyan.300", operator: "$hue.neutral.300", punctuation: "$hue.neutral.400" },
  markdown: { text: "$hue.neutral.200", heading: "$hue.accent.300", link: "$hue.blue.300", linkText: "$hue.cyan.300", code: "$hue.green.300",
    blockQuote: "$hue.neutral.400", emphasis: "$hue.purple.300", strong: "$hue.neutral.100", horizontalRule: "$hue.neutral.600",
    listItem: "$hue.accent.300", listEnumeration: "$hue.orange.300", image: "$hue.blue.300", imageText: "$hue.cyan.300", codeBlock: "$hue.neutral.200" },
};

function theme(name: NativeTheme): ThemeDocument {
  const accent = "custom";
  const palette = palettes[name];
  const colors = { custom: palette.accent, gray: "#8391a7", red: "#ef858e", orange: "#eeb477", yellow: "#e5ce8d", green: "#9ccfa4", cyan: "#76d8cd", blue: "#8eafe9", purple: "#b6a3e9" };
  const mode = (light: boolean) => {
    const background = light ? (name === "ember" ? "#faf5ee" : "#f5f7fa") : palette.background;
    const hue = Object.fromEntries(Object.entries(colors).map(([key, color]) => [key, scale(color, background, light)]));
    return { hue: { ...hue, accent: `$hue.${accent}`, interactive: `$hue.${accent}`, neutral: "$hue.gray" } };
  };
  let tokens = base;
  if (name === "mono") {
    const syntax = { ...base.syntax };
    for (const key of Object.keys(syntax) as (keyof typeof syntax)[]) syntax[key] = "$hue.neutral.200";
    syntax.comment = "$hue.neutral.400";
    tokens = { ...base, syntax };
  }
  return { $schema: "https://opencode.ai/theme.json", base: tokens, light: mode(true), dark: mode(false) };
}

export const nativeThemes = Object.fromEntries(WORKSPACE_THEMES.map((name) => [name, theme(name)])) as Record<NativeTheme, ThemeDocument>;
