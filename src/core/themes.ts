/** Shared palette catalog for CLI, OpenCode and Codex. */
export const WORKSPACE_THEMES = ["aurora", "ember", "mono", "sakura", "forest", "ocean", "midnight", "matcha", "lavender", "rose", "sand", "glacier", "neon"] as const;
export type WorkspaceTheme = (typeof WORKSPACE_THEMES)[number];
export const palettes: Record<WorkspaceTheme, { accent: string; secondary: string; background: string; motion: string; description: string }> = {
  aurora: { accent: "#76d8cd", secondary: "#b6a3e9", background: "#111722", motion: "stars", description: "Northern lights · cyan and violet" },
  ember: { accent: "#eeb477", secondary: "#ef858e", background: "#191512", motion: "embers", description: "Warm amber · quiet focus" },
  mono: { accent: "#d5dbe5", secondary: "#b8c2cf", background: "#14171c", motion: "snow", description: "Neutral ink · minimal contrast" },
  sakura: { accent: "#f2abc7", secondary: "#c2b4ef", background: "#211820", motion: "sakura", description: "Cherry blossom · soft pink" },
  forest: { accent: "#9bd8ad", secondary: "#c3dba4", background: "#121d18", motion: "leaves", description: "Deep woodland · fern green" },
  ocean: { accent: "#81d3e8", secondary: "#9caef1", background: "#101d29", motion: "waves", description: "Tidal blue · sea glass" },
  midnight: { accent: "#aab9f4", secondary: "#d2b5eb", background: "#15182a", motion: "stars", description: "Indigo sky · silver stars" },
  matcha: { accent: "#c1d79a", secondary: "#dfc7a0", background: "#1b2015", motion: "wind", description: "Tea garden · moss and oat" },
  lavender: { accent: "#cbb5ef", secondary: "#a8c5e5", background: "#1d1928", motion: "fireflies", description: "Lilac dusk · muted violet" },
  rose: { accent: "#edb0ab", secondary: "#e6c299", background: "#251a1c", motion: "sakura", description: "Rose clay · warm blush" },
  sand: { accent: "#e2c894", secondary: "#bdd0be", background: "#211f19", motion: "wind", description: "Desert linen · soft gold" },
  glacier: { accent: "#b0e0e5", secondary: "#b6c6ee", background: "#142025", motion: "snow", description: "Arctic air · pale cyan" },
  neon: { accent: "#b7eb8c", secondary: "#b9a5ef", background: "#151b20", motion: "rain", description: "Electric garden · lime and lilac" },
};
export function ansiRgb(hex: string): string { return [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16)).join(";"); }
