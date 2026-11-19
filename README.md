# Unity Plugin for Cursor

Unity plugin for Cursor (`v0.1.10-beta`), hosted at [`skrohn/unity-cursor-plugin`](https://github.com/skrohn/unity-cursor-plugin) and packaged from upstream [`Unity-Technologies/unity-agent-plugin`](https://github.com/Unity-Technologies/unity-agent-plugin) (`v0.1.10-beta`), providing Unity CLI Editor control and curated domain skills for Unity development.

## What This Plugin Provides

The plugin installs the `using-unity` index skill (`skills/using-unity/SKILL.md`), which routes requests to 35 specialized Unity skills under `skills/using-unity/references/` without cluttering the top-level skill list. Included skills cover:

- **Live Unity Editor & CLI control**: `unity-cli` and `unity-pipeline` for controlling running Unity Editors and projects through the `unity` CLI (recompiling scripts, running EditMode/PlayMode tests, inspecting console logs, running C# expressions, and managing Editors, packages, and builds) without requiring Unity MCP.
- **UI & rendering**: `ui`, `ui-uitk`, `ui-ugui`, `ui-imgui`, `urp-postprocessing`, `migrate-birp-to-urp`, `shader-graph-create-custom-node`, `validate-urp-render-graph-renderer-feature`.
- **2D, physics, audio & gameplay**: `2d-pixel-perfect`, `create-tile-palette-or-rule-tiles`, `manage-sprite-atlas`, `sprite-editor`, `sprite-segment-3x3grid`, `create-2d-physics`, `fix-3d-physics-collisions`, `audio-setup-mixers`, `optimize-audio`, `initialize-ai-navigation`, `craft-game-floors`, `build-gtk`, `create-xr`.
- **Live services, monetization & optimization**: `implement-in-app-purchases`, `levelplay-unity-integration`, `build-live-game`, `build-multiplayer-game`, `setup-vivox-voice-chat`, `localize-unity-project`, `optimize-text-mesh-pro`, `optimize-web`, `unity-package-management`, `new-unity-project`, `generate-editor-search-query`, `asset-transformer-toolkit`.

## Installation & Verification in Cursor

### Local Plugin Directory

This plugin is installed locally at:

```text
~/.cursor/plugins/local/unity/
```

To load it in Cursor IDE:

1. Run **Developer: Reload Window** from the Command Palette.
2. Open **Cursor Settings / Customize → Plugins** and verify **Unity** (`0.1.10-beta`) appears as enabled.
3. On Cursor Enterprise teams, make sure **Allow Local Plugin Imports** is enabled in your organization settings; otherwise Cursor skips local plugins under `~/.cursor/plugins/local/`.

### Cursor Agent CLI

To load the plugin explicitly in the Cursor Agent CLI:

```bash
agent --plugin-dir ~/.cursor/plugins/local/unity
```

### Team / Git Marketplace

Because `.cursor-plugin/marketplace.json` is included at the repository root of [https://github.com/skrohn/unity-cursor-plugin](https://github.com/skrohn/unity-cursor-plugin), this plugin can also be registered directly as a Cursor marketplace:

```bash
agent plugin marketplace add https://github.com/skrohn/unity-cursor-plugin
```

### Avoiding Duplicate Skill Loading (`unity-cli`)

If you previously installed the standalone `unity-cli` skill in `~/.cursor/skills/unity-cli`, disable or remove the standalone copy once the plugin is active so Cursor does not load `unity-cli` twice:

```bash
unity skill disable unity-cli --client cursor
```

## Upstream Sync & Validation

This repository stays in sync with [`Unity-Technologies/unity-agent-plugin`](https://github.com/Unity-Technologies/unity-agent-plugin) via `.github/workflows/sync-upstream.yml` (runs daily and on manual `workflow_dispatch`, supporting both `direct` commits to `main` and `pr` mode), with PR/push validation in `.github/workflows/validate.yml`.

To run sync or validation locally:

```bash
node scripts/sync-upstream.mjs --dry-run
node scripts/sync-upstream.mjs

npm install --prefix /tmp/validator --no-save --no-audit --no-fund js-yaml@4
NODE_PATH=/tmp/validator/node_modules node scripts/validate.mjs
```
