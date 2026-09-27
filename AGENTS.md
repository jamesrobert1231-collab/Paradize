<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->

PARADIZE setup note: use `./graft.cmd` when the global `graft` command is not on PATH. The September 27 publication graph covers 96 C#, JavaScript, and Python source files across apps, packages, modules, services, scripts, and tests. Rebuild after source changes rather than treating this count as fixed. Vendor snapshots, PowerShell, SQL migrations, documentation, and other unindexed files require direct source inspection. Graph rankings and inferred edges are navigation aids; verify source behavior before drawing conclusions. See docs/integrations/graft.md for the local Kotlin compatibility patch and coverage limits.

## Efficient continuation — approved September 27, 2026

Apply these rules when the user next resumes PARADIZE. Saving tokens must not
reduce the agreed scope, evidence standards or release acceptance requirements.

- Use Graft first as above; read exact source spans and inspect unindexed files
  directly. Reuse verified context instead of repeating broad discovery.
- Finish one bounded integration milestone, including relevant tests and review,
  before expanding scope. Continue independent work when a dependency is blocked.
- Delegate only distinct work that benefits from parallelism. Supply minimal
  sufficient context and one owner per write surface; use independent review for
  consequential changes without duplicating the implementation investigation.
- Run affected checks during development and broader checks at integration or
  release milestones. Repeat checks for changed code, failures, stale environment
  evidence or unresolved risks; never omit required acceptance checks.
- Keep concise durable checkpoints in the existing project progress documents:
  decisions, changed files/revisions, validation results and limits, outstanding
  work, and exact resume steps. Keep private receipts and detailed logs in excluded
  local storage, without copying credentials or personal records into public docs.
- Batch independent reads, bound tool output and show relevant errors or concise
  summaries. Retain full logs locally; inspect omitted detail when necessary.
- Report briefly: what changed, what passed, what remains and the overall
  completion estimate. Label estimates and historical results; do not inflate
  progress based on source changes or passing synthetic tests alone.

On continuation, reconcile checkpoints with current files, diffs, receipts and
any still-running processes before acting. Resume valid transfers/builds instead
of duplicating them. Refresh only evidence affected by changes or elapsed time.
Do not assume interrupted work completed or restart it from an observation gap.

Preserve authentication, privacy, data reconciliation, recovery, sandbox isolation
and real Unity/device validation. Distinguish implemented source, synthetic
verification, activated runtime and release acceptance. These efficiency rules
authorize no new actions and do not themselves resume the goal.
