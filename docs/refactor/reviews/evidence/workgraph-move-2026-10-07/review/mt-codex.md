Reviewed both requested `git show` outputs, the checker, and the current tree. No files modified; no Node checks run. **One low-severity documentation finding; no high or medium findings.**

1. **Q1 — No findings.** All 13 submodule IDs, paths, and all 41 dependency edges match the proposal’s `submodules`. Missing: none. Extra: none. Changed: none.

   Read-only comparison output:
   ```text
   id/path/dependency differences: 0
   submodules=13; allowedEdges=41
   ```

2. **Q2 — No findings for these declarations.** The checker enforces them:
   - Path existence/type and overlapping ownership: `scripts/check-boundaries.mjs:168–205`.
   - Declared dependency cycles: `:206–208`.
   - Source ownership: `:409–417`; valid nonoverlapping declarations plus rejection of unowned files ensure one owner.
   - Cross-submodule imports, including type imports, and unowned targets: `:517–526`.
   - `note` is discarded when constructing module/submodule records (`:129`, `:199`); it cannot affect enforcement. `scripts/check-boundaries.d.mts:2–14` agrees with those records.
   - `pureDirectories` still contains `src/core/work-graph/state/`; its import restriction runs before generic exemptions (`:474–479`).

   Read-only tree/import results:
   ```text
   sourceFiles=101; unowned=0; multipleOwners=0
   DAG elimination removed=13; remaining=0
   cross-submodule import occurrences=241; distinct observed edges=40; violations=0
   state import occurrences=138; outside own files/contracts=0
   ```
   All declared paths exist, including both single files. The only unused allowed edge is `tasks → architecture`.

3. **Q3 — No findings.** Using the proposal’s levels, the sole non-downward edge is:
   ```text
   non-downward: model(L0) -> state(L0)
   ```
   The JSON explicitly says at `docs/refactor/module-target.json:37`:
   > “model 可以依赖 state（L0 内部的例外，决定 40 修法 B）；state 不依赖 WorkGraph 里的任何东西”

   The same exception appears in `module-dag.md:122`, `modules/core/work-graph.md:27`, `ARCHITECTURE.md:90`, and the evidence README at `:5`.

4. **Q4 — One finding: low severity — an accepted migration is described as optional.**

   **Location:** [docs/refactor/STATUS.md:132](/D:/cxt/mt/docs/refactor/STATUS.md:132).

   **Evidence:** The new wrap-up item ends:
   > “要换，先改 `check-boundaries.mjs` 和它的测试，换不换由 lead 定”

   This makes the migration discretionary. However, `docs/refactor/STATE-MACHINES-SPEC.md:4685` says:
   > “先用 `pureDirectories`、任务 D 后改为 `pure: true` 的做法已由 lead 采纳（L-8）”

   And `:4687` explicitly says:
   > “任务 D 落地时删除该字段，改用子模块条目。”

   **Impact:** The docs disagree about whether this accepted requirement remains mandatory. Current purity enforcement remains intact through `pureDirectories`.

   **Suggested fix:** Describe checker support and migration as explicitly deferred work, removing “换不换由 lead 定”; alternatively, append a dated, authorized decision changing the specification.

   **No other Q4 findings.** All table IDs, layers, paths and dependencies agree. File counts match exactly: model 12, state 13, persistence 9, configuration 5, materials 5, architecture 8, sessions 9, ports 1, queries 4, tasks 31, reader 1, evidence 2, communication 1—101 total. Forbidden directions, reserved notes/views, and current purity enforcement are described accurately. Added relative links and anchors resolve. The done row and remaining-list numbering are consistent. Historical dated text retains its meaning; STATUS updates current status.

5. **Q5 — No additional findings.** The commits change only declarations and documentation, and do not claim the reliability batch or MVP is complete.