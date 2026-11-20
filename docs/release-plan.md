# 0.4.0 implementation and verification

User scope: publish/push a polished release with ten additional themes, ten controllable ambient scenes, live statistics, SVG branding and a refreshed README.

- Shared theme catalog: preserve Aurora/Ember/Mono/Raw; add ten palettes consistently to CLI, OpenCode and Codex. Verify native light/dark contrast and Codex theme installation.
- Motion engine: ten pure bounded scenes, independent from reads, 0.25–3× speed; reduced motion, pause/style/speed controls and timer cleanup. Verify geometry, determinism, controls and native rendering.
- Integrations: OpenCode sidebar/footer and commands; Codex supported native themes/footer plus a separate animated companion pane. No unsupported Codex overlay injection.
- Branding: original SVG logo and animated banner; stable sample stats, reduced-motion CSS and visual review. Rewrite README around exact capabilities and install/update paths.
- Release: typecheck, full tests, package smoke, Windows standalone build, review, push, three-platform CI, npm 0.4.0/latest, GitHub release with Windows ZIP; verify registry version and package hash.
