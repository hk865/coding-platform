# Task: K3 group 4 session B3, rework 9 — the frozen finding table (decision 80); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books, the test rule sheet and the lead's rulings are binding; do not make design decisions; report anything
undetermined under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`). **The test rule sheet `./.dsh-ref/test-rule-sheet.md` (v3) binds every brief and
replaces the judgment calls in coordinator-mode.md wherever they differ; put it, or a pointer to it, into every brief
that writes tests.** Files disjoint between subagents, every vitest command `--maxWorkers=2`, the close-out runs one
vitest command at a time. **Do not end your turn while a subagent has not reported back.** **Finish within 330
minutes** (the run stops at 345). Finish whole rows; an unfinished row is reported, not half-done. Delete
`./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is, and what this book is

Tag `k3-g4b3-r8` (HEAD) = B3 rework 8. The construction book `./.dsh-ref/k3-g4b3-impl.md`, the spec
`docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` and the rework books 6–8 still bind where this
book does not override them. The lead's rulings for this audit are `./.dsh-ref/k3-b3-rulings-v1.md`.

Codex then audited every file B3 changed, without a length limit, in nine groups (`./.dsh-ref/reports/k3-audit-*.out.md`),
and merged them (`./.dsh-ref/k3-merge.out.md`, Chinese). The merge is the finding table's text: rows `F-001`…`F-097`
with instances, one disposition and a done-check each (its §4), the consumer index `C-*` (§4.6), the T list
`T-001`…`T-091` (§2), the scope additions (§3), the ledger (§5), the work packages (§6), the spec conflicts (§7) and
the open questions `Q-01`…`Q-20` (§8). Below, `M§n` points into it. `./.dsh-ref/k3-line-scope.txt` classifies every
instance of every row by scope (§2 ruling 1). `./.dsh-ref/k3-arch.out.md` is background only (why the real shared
paths matter); it adds no rows. `./.dsh-ref/k3-book9.out.md` is Codex's check of this book's first draft; its call
chains and await tables (§2, §4, §5) are the reference for §2's rulings, whose wording here is final.

**This book is the frozen finding table.** Do every row named in §3, in the way the merge says, unless §2 overrides it.
Nothing else is must-fix in this round. If you find something outside the table, list it under FOUND and do not fix
it, unless it blocks a row (then say so).

## 2. Lead rulings (binding; they override the merge where they differ)

1. **Scope (Q-01).** A K3 file that B3 changed is in scope as a whole file (decision 80-5), even where a line is older
   than B3. The ten files that existed before K3 (`./.dsh-ref/pre-k3-files.txt`: the allowlist, `AG2b-collaboration-
   fixture.ts`, `K-boundary-facts-support.ts`, the four `S5*` helpers, `WP1-entry-fixture.ts`,
   `S3-context-assembler.test.ts`, `S4C2-assembly.test.ts`) are in scope only on the lines B3 changed. Therefore:
   - `F-093`, `F-094`, `F-095`, `F-096` and the eight `F-054` instances in `S3-context-assembler.test.ts` and
     `S4C2-assembly.test.ts` are **T**: do not change them. `F-090`, `F-091`, `F-092` are in scope (K3 files): do them.
   - Of `T-001`…`T-091`, only the instances that this rule or the named old T files exclude stay T. **In scope after
     all:** `T-020`, `T-022`, `T-023`…`T-035` (old lines of `K3-review-card-fixture.ts`, `K3-proposal-round.ts` and
     `K3-tool-seams.ts`, K3 helpers B3 changed), fixed together with `F-001`, `F-002`, `F-005`; `T-021`'s injection
     inside `K3-review-card-fixture.ts` (the old `executed-files-stub.ts` itself stays T); `T-043` (ruling 6). The
     other T rows and the T list of rework 7 §3 (`B2-execution-fixture.ts`, `B2-model-request.test.ts`,
     `B2-execution-result.test.ts`, `B2-runtime-fixture.ts`; K3-11, K3-14, K3-45, the non-proposal part of K3-48-2,
     K-R-close-open-turn, B2-execution-entry) stay T: do not change them, except a call site that a row's helper fix
     breaks (adapt the call, nothing more). `K3-mixed-seams.ts` (`T-040`) stays T.
   - The 33 calls of M§3 are in scope (those calls only), including the three `F-013` calls in
     `K-R-attested-facts-source.test.ts` that `k3-line-scope.txt` marks `nofile`. A consumer in M§4.6 is in scope where
     the helper fix changes or breaks it; a consumer that still passes unchanged and holds no instance of its own
     needs no edit.
2. **Ledger lines.** `D1:287` is an equivalent rewrite (the same `toContain` on the same subject): nothing to do.
   `D1:371` is a weakening: in `F-067`, restore the full assertion of the accepted proposal (`alias`, `command`, `cwd`
   and `rationale`, hand-written literals). `D1:486` (the deleted `K3-large-review-input.ts`): this book approves the
   deletion; it goes with rework 6's move of the built extremes out of the owner scenarios (`k3-g4b3-rework-6.md:37`),
   which did not name the file. Nothing to do. In `F-067`, the full proposal read back is the one accepted after the
   short-rationale retry.
3. **Q-03.** Rework 8's UNSPECIFIED 6 accepted only UR3's real pre-entry pause. UR5's missing probe comes from a real
   dependency failure (`F-003`); UR7b goes through the public path (`F-015`).
4. **Q-04, pure tests.** A pure test may import an exported pure function from any `src` module; what counts is what
   the test builds (no store, platform, Host, Workflow, Runtime or stub port), not the module's import closure. Do not
   add production exports or move production code only to make a test pure; D3 is the check.
5. **Q-05.** Rule sheet A1's accepted example names the continuation helper's public step shape, not the whole file;
   `F-003` fixes the rest of it.
6. **The process sandbox (rule sheet v3 A7 entry 1; `F-002`, `F-019`, `T-043`).**
   - The helper (`process-sandbox-standin.ts`) answers `available` to both the default probe (which decides whether
     the Kernel grants `isolated_process`/`network_isolated` and registers the shell) and the read-only probe, or
     `unavailable` only in a row about that refusal; no switch leaves the ordinary shell unavailable. It produces the
     complete execution result the real shell handler expects (exit status, signal, timed-out and cancelled flags,
     output, the full `effects` the executor port checks, timings) from a real child process and real snapshots,
     honours the abort signal (no `spawnSync`), and keeps the constructor and probe options observable (A3). The gate
     layer never builds a `ToolResult`.
   - It replaces the sandbox module mocks in the in-scope files only (the K3 and B2 files of M§3, C-TOOLS and the
     rows); `K-readonly-command.test.ts`, the `RL-*` files and their `RL-kernel-sandbox-double.ts` are not touched.
   - The shell, read and mailbox gates take and wrap the real definition (all metadata, schema, capabilities and the
     real handler's result kept); the gate holds a call at the handler's entry, after `tool.started` is committed.
     Release a gate only in rows whose spec behavior needs the completed result. A row about an unknown outcome ends
     the held call through the public cancel or stop, a Run deadline, or a controlled Host abandonment (ruling 7),
     never by waiting for a final model reply (it cannot pass a held tool); count the Runtime's drain wait after a
     cancellation (5,000 ms today) in the row's time. Clean up only after the recovery assertions, and so that the
     old handler adds no command side effect while cleaning up.
   - `K3-12-review-round-tools.test.ts:330` (a read-only command's write really fails) needs real read-only isolation:
     it stays on the real sandbox; run it once and quote the bubblewrap error; the lead runs it with bubblewrap. Never
     build the refusal.
7. **Crashes (rule sheet v3 A2).** `F-044` (K3-41 (三)): a commit wrapper on the old Host holds after the
   `releaseHold` commit is durable and before the human requeue continues; the Host is abandoned there; a new Host on
   the same SQLite replays the same request; the wrapper does not touch the new Host. The harness's commit observer
   is not a gate. Each other row keeps its own kind: a normal close and restart, a Run the Runtime ends `crashed`
   through a real model failure (the proposal fixture's unfinished rows), or a Host abandonment at the boundary the
   row names; none stands in for another. No row this round proves that an old process is gone.
8. **Capacity rows (Q-06, Q-19; `F-066`, `F-067`, `K3-48-3`).** The 16,384-byte brief budget (`F-066`), the
   158,720-byte optional-text budget B (`F-067`) and the 524,288-byte record limit (`K3-48-3`) are fixed production
   budgets; no Host or Runtime configuration sets them, and a pure function's parameters or the token budget do not
   stand in for them. Public inputs can reach them (`./.dsh-ref/k3-book9.out.md` §4, ruling 8: a long Plan `taskId` for the brief;
   a raw shell `cwd` such as `'./'.repeat(n)`, which the permission policy normalizes to `.`, for the record), so the
   service rows go through public steps to the boundary:
   - `F-067`: fix the public ids, clock, raw `cwd` and all steps; hand-compute the precondition's size `C` without the
     `cwd`, set `cwdBytes = 158,720 − 2,000 − C` so the precondition is exactly `B − 2,000`; then the long rationale
     gives `capacity` and the record reads back unchanged, the short rationale is accepted, and the full proposal reads
     back (ruling 2). Show the arithmetic.
   - `K3-48-3`: the required writes through a legal public precondition near the creation threshold; the absolute
     extremes stay in the existing pure tests.
   - `F-066`: tell the anchors the later prepare really picks up from the ones already picked up; reach the T600
     refusal through public inputs.
   - If a row still cannot reach its boundary, stop it and report BLOCKED with the arithmetic; the lead freezes a
     replacement. Never restore built owner state, never shrink to a small example, never raise a timeout.
   - Use the literals B = 158,720, R = 365,536 and the limit 524,288 as they are (they leave 32 bytes; B is not the
     difference of the other two); do not change the production constants.
9. **Timeouts (`F-055`).** The 18 timeouts added to tests that had none go back to the default (30,000 ms,
   `vitest.config.ts:8`); the seven raised ones go back to 120,000 ms. The K3-35 setup hook timeout rework 6 §2.8
   approved stays. If a row through the public path cannot finish within its limit, stop it and report BLOCKED with
   the measured time per step; never change the Runtime's drain, drop public steps or raise a timeout.
10. **Q-07, Q-16, ordering of equal times; new production row `F-098`.** The newest request is the first of
    (`createdAt` descending, `requestRef` descending); do not only flip the tie in an ascending sort and keep
    `.at(-1)`. The earlier requests stay those with `createdAt` strictly before the current one, ordered the same
    way, at most five. The declared forms keep their declaration order, the allowance keeps its earliest-created
    choice, the review-record sorts and the merge of one ref's versions are not touched. The two request choices are
    `RT/context-assembler.ts:1447–1448` and the card summary (`TG/command-rerun-request-card.ts`); check both. The new
    row uses equal `createdAt` from an A8 clock and two requests whose revision order and ref order disagree.
11. **Q-08.** Reading R requests costs `max(1, ceil(R / 200))` page reads of the requests in one public operation (R
    = 0, 1, 200, 201 → 1, 1, 1, 2); other reads (the Task closure) are not counted here.
12. **Q-09, Q-10, literal texts.** This book freezes the fixed self-check sentence `没有自查依据` and the approval
    labels `同意` and `不同意` (the spec gives the option ids in L18, `slice-K3-SPEC.md:432`, and approve's behavior in
    L20, `:555`; the lead adds the texts). Tests write these literals, never the production constants.
13. **Q-11; new production row `F-099`.** `proposal.cwd` is `null` or 1–512 UTF-8 bytes: the codec's
    `proposalProblem` (`TG/unknown-call-review-codecs.ts:273`) rejects `''` as the owner does
    (`unknown-call-review-service.ts:689`). The original command's `summary.cwd` and the approved methods are not part
    of this row. One A5 `rejects:` row on the codec: an otherwise valid body with only `proposal.cwd = ''`; it fails
    before the fix (an owner refusal row passes before the fix and does not count).
14. **Q-12.** The codec refusal sentences stay asserted as they are (they show which check fired). No change.
15. **Q-13.** The K3-46 UR7 extension rows stay; the lead registers them in the spec. Only `F-015`'s path applies.
16. **Q-14; new production row `F-100`.** CRR `applyAnswer` (`TG/command-rerun-request-service.ts`), after the receipt
    lookup and replay, reads the saved synthetic responded answer, checks that its source points at this CRR card and
    revision and that the selection matches the request, and takes the Goal basis from that answer's captured source.
    It compares the current Goal with `goalDecisionBasisMatches` (`src/core/work-graph/state/goal-settings-machine.ts:256`,
    the predicate UCR uses at `unknown-call-review-service.ts:1310`): not active → `busy`; basis missing or content
    changed → T02 `revision_conflict` with the existing T02 reason (so `workflow.ts:2274` maps it). The current Goal
    revision stays in the final commit guards. If you extract a shared guard, UCR uses it too (no copy). The new
    read's refusals, throws and cancellation follow `F-072` and `F-076`: the saved answer ① is not lost, a failed ②
    never records ③, and a replay of a commit that happened does not re-check the current Goal. Rows: answer saved,
    Goal content changed, ② retried → `revision_conflict`; a pause and resume that changes only the revision still
    applies.
17. **Q-15, Q-17.** Known limits: no change this round; the lead records them in the spec.
18. **Q-18; new production row `F-101`.** `readKernelCommandFacts` (`RT/context-assembler.ts:1195`, `:1217`) returns
    ready only when the requested window is read to its end; finishing exactly on page 64 is ready; anything left after
    page 64, a cursor that does not advance, or an early end before the window's end is `unavailable`, never the
    partial map. `cancelled` stays `cancelled`; a throw or rejection never becomes empty facts. Its consumers: the
    blocked-command write (`unknown-call-review-service.ts:196`), the CRR source facts (`decision-source-facts.ts:848`)
    and the CRR card reader (`decision-read-model.ts:638`) pass the failure on; the review prepare
    (`reviewCommandFacts`, `context-assembler.ts:1249–1255`) keeps its summary fallback for an ordinary unreadable read
    but never swallows `cancelled`. Before building, name the A1/A2 entry for the page-cap and stall branches; if
    none exists, report that verification BLOCKED; never build a ready window or owner state.
19. **Q-20.** The class column may name A5, A6 or "backend"; nothing to do.
20. **Spec conflicts (M§7).** The dispositions there are binding for the tests, except where this book overrides them:
    the sandbox follows ruling 6 and rule sheet v3 A7, the capacity rows follow ruling 8, and cancellation follows
    `F-076` (ruling 18's `unavailable` never covers it). Do not edit the spec; the lead writes its post-note.
21. **RUN-25 and the real mailbox** (M§8, last two paragraphs): RUN-25 runs on memory and SQLite through the shared
    harness; the harness gets a narrow exit to its real platform for the mailbox, as M§8 says.

## 3. The finding table (do every row)

| Package | Rows | Order |
| --- | --- | --- |
| A, tests, helpers and consumers | `F-001`–`F-068`, `F-090`–`F-092`, `F-097`, and the T rows ruling 1 brings in (`T-020`–`T-035`, part of `T-021`, `T-043`) | M§6 package A's internal order: the shared helpers first (`F-001`, `F-002`, `F-003`, `F-012`, `F-013`, `F-014`), then `F-004`–`F-011`, then the consumers and local set-ups, then the behavior rows, refusal rows and backends, last the pure rows, the restored ledger obligations and the timeouts. |
| B, production | `F-069`–`F-089`, `F-098`–`F-101` | M§6 package B's order. Its own verification goes into new files (M§6), and its service rows use package A's shared helpers once they exist. |

- The two packages own disjoint files (M§6); package B also owns the expectation change at
  `R/B2-02-recognition-unified.test.ts:192,196` (`F-070`), which package A leaves alone.
- `F-070`: the recognizer failing or answering not-ready fails closed; only a confirmed no-match continues, and the
  documented package-unavailable degradation stays.
- Production reach: a new helper is reached from production or deleted; never add to the allowlist.

## 4. How

- Test first, one row at a time: show it RED, then GREEN. A row that needs bubblewrap (after ruling 6, the read-only
  isolation row of `K3-12` and any row about isolation or resource caps): run once and quote the error; the lead runs
  it with bubblewrap. Never build its result.
- Detectors in the close-out, both:
  `python3 -I .dsh-ref/d1-ledger.py . k3-g4b3^ WORKTREE` (cumulative) and `python3 -I .dsh-ref/d1-ledger.py .
  k3-g4b3-r8 WORKTREE` (this round). Every D1 line must belong to a row that asks for it (a move to a pure file, a
  deletion `F-038` names, a restored timeout); list each line with its id. A line no row asks for is a weakening: undo
  it or report BLOCKED. D3 must show 0 hits.
- **BLOCKED:** if a row cannot be done as written (a public path refuses, a cited line is not what the table says),
  stop that row, report the exact refusal (file:line, message) and the smallest options. Never weaken a test, change a
  literal, add a timeout or pick another disposition to get past it.

## 5. Checks and reply

Checks: every changed and new test file (exact lists, one vitest command at a time, `--maxWorkers=2`), then typecheck,
check:architecture and build. No real model calls, no git writes, never ports 3080/3099/44797.

Reply under 1,200 words:
- per row: done (RED → GREEN) or BLOCKED with the refusal; group the ids, but name every id;
- the shared helpers as built (file, exported functions, what each takes);
- for `F-066`, `F-067` and `K3-48-3`: which case of ruling 8 applies, with the arithmetic;
- the production lines added and removed;
- both D1 outputs with an id per line, and D3;
- the checks, with numbers;
- FOUND (outside the table) and UNSPECIFIED.
