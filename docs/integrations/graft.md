# Graft setup

Latest refresh, September 23, 2026: the public source produced **68 map files plus INDEX.md**, covering the account-review register, Sunny, Unity, import/recovery tools and tests. The graph contains 444 nodes and 947 edges. Rebuild the local cache after updating. The setup-time counts below are historical.

Verified on 2026-09-19 (2026-09-20 UTC): Graft **0.18.0** is installed globally and wired into **Codex through AGENTS.md**. No Claude configuration was created.

The requested `npm install -g @nanonets/graft` failed because the Kotlin native grammar requires the unavailable Windows SDK 10.0.19041.0. `npm install -g @nanonets/graft --ignore-scripts` succeeded. The CLI eagerly imports that unavailable grammar even when no Kotlin is being indexed, so `scripts/tooling/Repair-GraftWindows.ps1` applies a version-checked, narrowly scoped lazy-loading repair. It preserves the original extractor beside the installed file. Kotlin still fails explicitly when requested; its parser is not qualified. Reinstalling Graft can overwrite the repair.

Commands executed successfully:

```powershell
& ./scripts/tooling/Repair-GraftWindows.ps1
./graft.cmd --version
./graft.cmd init --agents agents --no-global
./graft.cmd build
./graft.cmd map
```

`init` recognized the existing Codex instructions, left them intact, and skipped rebuilding the existing graph. The subsequent explicit build parsed all **52 source files**, producing **52 map files plus INDEX.md**, **353 nodes**, and **680 edges**. Coverage includes C#, JavaScript, and Python in apps, modules, services, scripts, and tests. This is source-navigation evidence, not proof that the whole application works.

Configuration remains scoped to the repository: no global Codex hooks or MCP configuration were written. The wrapper resolves the npm installation when it is absent from PATH and sets `DO_NOT_TRACK=1`. No LLM/deep graph generation or paid service was used.

The generated `graft/` graph and `.graft/` local settings remain git-ignored. Rebuild the graph on each checkout. Vendor snapshots, PowerShell, documentation, and assets are outside the verified coverage. Graph rankings and inferred edges are navigation aids; verify actual source behavior.
