import { WORKSPACE_THEMES, palettes } from "../core/themes.ts";
export const CODEX_THEMES = WORKSPACE_THEMES;
export type CodexTheme = (typeof CODEX_THEMES)[number];

const statusPresets = {
  aurora: ["model-with-reasoning", "context-remaining", "used-tokens", "five-hour-limit", "weekly-limit"],
  ember: ["model-with-reasoning", "five-hour-limit", "weekly-limit", "total-input-tokens", "total-output-tokens"],
  mono: ["model-with-reasoning", "context-remaining", "used-tokens"],
};

const fullStatus = ["model-with-reasoning", "context-remaining", "used-tokens", "total-input-tokens", "total-output-tokens", "five-hour-limit", "weekly-limit"];
export const codexStatusLines = Object.fromEntries(CODEX_THEMES.map((name) => [name, [...new Set([...(name in statusPresets ? statusPresets[name as keyof typeof statusPresets] : []), ...fullStatus])]])) as Record<CodexTheme, string[]>;

export function codexTheme(name: CodexTheme): string {
  const mono = name === "mono";
  const accent = palettes[name].accent;
  const background = palettes[name].background;
  const scopes: Array<[string, string, string?]> = [
    ["comment, punctuation.definition.comment", "#98a4b7", "italic"],
    ["keyword, storage", mono ? "#d5dbe5" : palettes[name].secondary],
    ["entity.name.function, support.function", mono ? "#edf2fa" : "#8eafe9"],
    ["string", mono ? "#d5dbe5" : "#9ccfa4"],
    ["constant.numeric, constant.language", mono ? "#edf2fa" : "#eeb477"],
    ["entity.name.type, support.type, support.class", accent],
    ["variable, punctuation, keyword.operator", "#d5dbe5"],
    ["markup.heading", accent, "bold"],
    ["markup.bold", "#edf2fa", "bold"],
    ["markup.italic", "#d5dbe5", "italic"],
    ["markup.inserted", mono ? "#edf2fa" : "#9ccfa4"],
    ["markup.deleted, invalid", mono ? "#d5dbe5" : "#ef858e"],
    ["markup.changed", accent],
    ["markup.underline.link, string.other.link", accent, "underline"],
  ];
  const settings = (values: Record<string, string>) => `<dict>${Object.entries(values).map(([key, value]) => `<key>${key}</key><string>${value}</string>`).join("")}</dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>name</key><string>ocquota-${name}</string>
<key>settings</key><array>
<dict><key>settings</key>${settings({ foreground: "#edf2fa", background, caret: accent, selection: "#303d53", lineHighlight: "#1c2635" })}</dict>
${scopes.map(([scope, foreground, fontStyle]) => `<dict><key>scope</key><string>${scope}</string><key>settings</key>${settings({ foreground, ...(fontStyle ? { fontStyle } : {}) })}</dict>`).join("\n")}
</array></dict></plist>\n`;
}
