# Task: structure round, rework 2 = S4's first rework (decision 80; lead, 2026-10-22)

You are working in a copy of the repository (the current directory). This is a NEW session. Read this book in full,
then the frozen findings table `./.dsh-ref/s4-findings.md`, the structure round's book `./.dsh-ref/s85-book.md` (§2
rules, §5.0 byte proofs, §5.1 "Byte proof, S4") and S4's reply `./.dsh-ref/s85-reply-S4.md` (§5). **This run is
headless: when your turn ends, the whole run ends. Do not end your turn while a subagent has not reported back**
(`sleep 300`, then `list_agents`). Time limit: 120 minutes. Work alone or with at most two subagents; never two
subagents on one file.

## 1. What this is

Run S4 split the context assembler (`39fee06`, this copy's HEAD; its base is the tag `s85-n2-base`). The full suite
passes on it. Codex audited it and found no behaviour difference; the lead froze the table `./.dsh-ref/s4-findings.md`.
Do exactly the rows whose ruling is **Fix**: three comment fixes in production code (items 1–3) and the proof
material (items 4–8). Rows Q1-03 and Q4-02 are rejected and need nothing. Every rule of the book's §2 binds:
behaviour byte-identical to `s85-n2-base`, no test or allowlist edit, exports kept, nothing new.

S4's probe kits are in `./.dsh-ref/s85-probes-S4/` (`e-assembler/`, `e-render/`, with their `REPORT.md`,
`COMMANDS.md` and S4's recordings). Reuse them; change only what an item asks.

## 2. Production fixes (comments only; no code change)

1. **Q1-04** (`src/core/agent-runtime/context-history-facts.ts`): put the base comment back above
   `KERNEL_TERMINAL_EVENTS`, exactly as the base has it (`git show s85-n2-base:src/core/agent-runtime/context-assembler.ts`,
   line 958): ``/** The Kernel `agent.event` types that end a Turn: a completed history boundary (LA-1). */``
2. **Q3-02** (`src/core/agent-runtime/context-rendering.ts`):
   - at the omission block, the comment becomes:
     ```
     // §4.3/G5.5: the mandatory omission metadata is appended at the end of the
     // required task section (or the goal section when no task exists, or the role
     // section when neither exists). The block is part of that slot's value, so the
     // section's interval, derived from the slot's range, covers those lines and
     // they are not outside every interval.
     ```
   - above `if (input.templateId === 'work-input' && input.reviewSuffix !== null) {`:
     ```
     // R1/D1: the review instruction is the LAST section and is emitted only for a
     // review-purpose Work Run (`reviewSuffix` is null on every other call).
     ```
3. **Q3-03** (`src/core/agent-runtime/context-rendering.ts`): the file header becomes exactly:
   ```
   /**
    * The pure context renderer. It owns the frozen section order, the byte
    * budget of the four optional sections and the exact `\n\n` separators (no
    * trailing LF); every literal comes from the platform pack.
    *
    * The budget keeps the longest global prefix of optional rows (per-section
    * sort, full `k = 0..totalRows` scan); the text is rendered from one frozen
    * template exactly once, and the section intervals the binding records are
    * derived from the template's slot ranges.
    */
   ```

Commit (never amend, never reset): `git add -- src/core/agent-runtime/context-history-facts.ts
src/core/agent-runtime/context-rendering.ts && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "S85 S4 fix:
Q1-04 Q3-02 Q3-03"`. The proofs below use a result copy of this commit (its behaviour equals `39fee06`).

## 3. Proof material (scratch only; nothing of it is committed)

Scratch place: `.dsh-scratch/R2/` in this copy (it is in `.git/info/exclude`). Copies, as S4 made them:

```
S=.dsh-scratch/R2; mkdir -p $S/base-a $S/probes
git -c core.autocrlf=false archive s85-n2-base | tar -x -C $S/base-a
cp -al node_modules $S/base-a/node_modules
cp -al vendor/coding-agent/node_modules $S/base-a/vendor/coding-agent/node_modules
```

and a result copy of your fix commit the same way (`git archive HEAD`), a new directory each time. Install the probes
with the kits' installers (`--check` first where the installer has it). Tests only as `timeout 900 npx vitest run
--maxWorkers=2 <at most 10 files>`, with the kits' fixed `GIT_*` environment (`run-capture.sh`). Do not use `/tmp`
or any path outside this copy.

4. **Q2-01, widened** (e-assembler): capture with the same probe these 11 test files, which reach the real
   `assembleTask`/`assembleQuery` through the helpers `WP1-units-fixture`, `WP1-entry-fixture`, `K3-35-prepare`,
   `task-claim-fixture` and were not captured:
   ```
   tests/business/WP1-start-refusal.test.ts
   tests/composition/WP1-session-duty.test.ts
   tests/runtime/K3-35-T-by-hand.test.ts
   tests/runtime/K3-35-approved-methods-brief.test.ts
   tests/runtime/K3-B3-newest-request-order.test.ts
   tests/work-graph/K3-47-continuation-gate.test.ts
   tests/work-graph/R3c-plan-adoption.test.ts
   tests/work-graph/S3-prepared-context-admission.test.ts
   tests/work-graph/S5-goal-settings.test.ts
   tests/work-graph/WP1-context-anomalies.test.ts
   tests/work-graph/WP1-goal-content-entry.test.ts
   ```
   Add them to the capture script (as two more batches), then capture the whole list (S4's 25 files and these 11) on
   the base copy twice and on the result copy once, and compare with `compare.mjs` (base1/base2, base1/result,
   base1/result `--result-only`). Report captures per file (a file that captures nothing is listed as such) and per
   probe. Then run `node ./.dsh-ref/inner-diff.mjs <left> <right>` on base1/base2 and base1/result: it parses the
   JSON inside every differing string and lists the differing leaves inside it. The bar: assembler results and stored
   bytes 0 differences; dependency return values differ only in the inner leaves `.checksum` and
   `.payload.workspace.revision` of `entries[].body.text` and the digests over them (the six paths of S4's report),
   in both comparisons. Anything else is a finding to report (do not fix production code for it; report it).
5. **Q1-01** (e-assembler): extend the probe, in both copies, so that the Kernel history reads made inside a
   `kernelStores.withStore` callback are logged too: wrap the store object the callback receives (and the reader
   objects it hands out) in the same recording proxy, one line per call with the method name, the arguments, the
   order and the result or error, nested under the `withStore` call that opened it. Also log calls of the functions
   tests import from `context-assembler.ts` and call directly without the factory (at least `readKernelCommandFacts`,
   `briefWorkspaceFactsFor`, `readTaskBlockedCommands`, `archiveOriginSkipsHistorySeed`, `runEnteredKernel`): wrap
   them at their definition in each copy (the base in `context-assembler.ts`, the result in its new module), with
   their dependency arguments proxied the same way. Avoid wrapping one call twice. These lines join item 4's
   captures and comparisons (same bar).
6. **Q2-02 and Q1-02** (e-assembler): rebuild the read-point list **per call site**, not per method: for each place in
   the base `context-assembler.ts` that calls a `deps` member (directly or through `createSessionHistoryCursorOwner`,
   `continuation-brief-assembly.ts`, `workspace-baseline-artifact.ts`), give the base line, the new file:line, and the
   number of calls item 4/5's captures saw there (tell call sites apart by a stack line or by an argument that only
   that site passes; say which). For every call site with zero calls, give a side-by-side reading of the old and new
   code (as S4's reply §5.3 table does), including at least `unknownCallReviews.listReviews` (base `:1503`),
   `kernel.readTurnBounds` (base `:1598`, `:1607`), the baseline bundle and baseline artifact `bodies.read` (base
   `:1053`, `:1092`), and the rows of S4's table that are still unreached. In the report, state the results and stored
   bytes separately from the dependency return values (`compare.mjs` prints `RESULT: different` because of the six
   paths; say that, do not write "0 differences" for the whole payload).
7. **Q3-01** (e-render edge matrix): add cases, keeping the 140: (a) `goal: null`, `task: null`, optional rows
   present, budget 0 (the omission block lands on the role section), and the same with budget −1; (b) budget −1
   with `optional: {}` and with every optional section an empty array (fallback, no block), with and without goal
   and task; (c) the two Query templates (`renderQueryContext` with `query-planning-input` and `query-copy-input` in
   the result; in the base, `renderContext` with the same inputs, as the base Query path called it) with `prelude:
   ''`, with `goal: null`, with `task: null`, and planning with and without footprint rows, including budget 0 for
   planning. Compare the complete return objects (`input` as UTF-8 bytes, `sections` with every range and count,
   `residentBytes`, `totalBytes`, key order kept). The base edge file twice must be byte-identical; base vs result
   0 differences. If a case throws on one side, record the error text; equal errors are equal.
8. **Q4-01** (e-render replay): replace the reviver in the replay harness: parse each line normally, then walk the
   parsed value and replace every `{"$probe":"undefined"}` marker in place with `undefined` (an object key stays,
   with the value `undefined`; an array index stays, holding `undefined`), keeping key order. Show on a three-line
   sample that missing, `undefined` and `null` come back distinct (`'k' in o`, `o.k === undefined`, `o.k === null`;
   array length and `i in a`). Then redo the replay of S4's recorded arguments (`./.dsh-ref/s85-probes-S4/e-render/base-run1.jsonl`) on your
   base copy and on your result copy, with the e-render probe installed as S4 did; 0 differences of 0 is a failure (report counts per probe). In the report, keep S4's statement that
   two recordings differ only through their arguments, and add: replaying one recording's arguments through both
   copies is how this proof meets rule 3 (the lead's ruling on Q4-02).

## 4. Checks before you finish

One at a time (never two `tsc` at once): `npm run typecheck`; `npm run check:architecture`; `npm run build`. Tests,
only as `timeout 900 npx vitest run --maxWorkers=2 <at most 10 files>`: `tests/runtime/S3-context-assembler.test.ts`,
`tests/runtime/K3-review-preparation.test.ts`, `tests/runtime/K3-merge-cancel-propagation.test.ts`,
`tests/runtime/S4C2-assembly.test.ts`, and `tests/architecture`. Never a `*.scale.test.ts`, `npm test`, `npm run
test:scale` or a bare `npx vitest run`. There is no bubblewrap here: a test that fails only on `ENOENT … bwrap` is an
environment failure; list it with its error text.

Scope: `git diff --name-only 39fee06 HEAD` lists only the two files of §2; `git diff 39fee06 HEAD` changes comment
lines only; `git status --porcelain` prints nothing.

## 5. Reply (plain Chinese): `./.dsh-ref/s85-reply-R2.md`

Questions (if any); a summary under 200 words; one row per Fix row (done / not done, file:line, the proof); the
probe tables of items 4–8 with counts and differences, and the paths of the kits and logs under `.dsh-scratch/R2/`
(keep them; the lead and Codex re-run them), including each command; the tests run with pass/fail counts
(environment failures separately); the scope checks.
