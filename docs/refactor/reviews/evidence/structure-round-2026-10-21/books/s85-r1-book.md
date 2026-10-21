# Task: structure round, rework 1 of night 1 (decision 80; lead, 2026-10-21)

You are working in a copy of the repository (the current directory). This is a NEW session. Read this book in full,
then the frozen findings table `./.dsh-ref/n1-findings.md` and the structure round's book `./.dsh-ref/s85-book.md`
(§2 rules, §5.0 byte proofs, and only the sections a finding names). **This run is headless: when your turn ends, the
whole run ends. Do not end your turn while a subagent has not reported back** (`sleep 300`, then `list_agents`).
Time limit: 90 minutes. Work alone or with at most two subagents; never two subagents on one file.

## 1. What this is

Last night three runs restructured the code with behaviour byte-identical (book `s85-book.md`): S1 (D2), S2 (C2, C1,
A6, B1), S3 (D3a, the prompt pack). The lead merged them (tag `n1-merged`, this copy's HEAD); the daily full suite
passes on it. Codex audited it; the lead froze the table `./.dsh-ref/n1-findings.md`. Fix exactly the rows whose
last column asks for work: **P1-01, P2-01, P2-02, P3-01, P3-03, P4-01**. Rows marked rejected or closed need nothing.
Every rule of the book's §2 still binds: behaviour byte-identical to `s85-base`, no test or allowlist edit, exports
kept, nothing new, comments keep rules and "why" without history.

## 2. The fixes

1. **P1-01** (`src/core/agent-runtime/observed-model-run.ts`): `hasMaterialTools: hasRead && reviewSource &&
   !!o.materialTools` at the `kernelEnabledToolNames` call. Nothing else in the file.
2. **P3-01** (`src/contracts/prompts/render-template.ts`): the required check walks every slot of the template's
   table whose `required` is true (not only the slots the template uses), with the existing empty test (`undefined`
   or `''`) and the existing error text.
3. **P3-03** (`scripts/build-platform-prompts.mjs`, then the regenerated `src/contracts/prompts/platform-pack.generated.ts`):
   emit each `mentionsTools` with a literal tuple type assertion (`as ["propose_safer_method"]`, `as []`) instead of
   `as string[]`, so the value keeps its literal types and still satisfies the manifest type. Regenerate with the
   script; never edit the generated module by hand.
4. **P4-01** (`resources/prompts/platform/templates/unknown-call-review.txt`, `src/contracts/core/prepared-execution.ts`,
   then the regenerated module and `runtime-assets.json`): the template line becomes `### 要核对的调用{{items}}` (the
   separate `{{items}}` line goes away), and the caller passes `items: itemLines.length === 0 ? '' : '\n' +
   itemLines.join('\n')` (the same pattern as the proposal path's `slotLines`). Update the template's raw-byte SHA-256
   in `runtime-assets.json` the way S3 made the entries. Keep the template's `version` at 1 in `pack.json` (lead's
   ruling: platform pack v1 has not been released and nothing records a template version yet; the spec's "改一个字也加
   1" counts edits of a released template, and this fix makes the rendered text equal to the base again).
5. **P2-01, P2-02** (evidence only, no production file): S2's C2 probe is in `./.dsh-ref/s85-probes-S2/c2/`. Copy it to
   your scratch place, then (a) record, for each wrapped store call, its result or the thrown error, and for each of
   the four loops (calendar, Run activity list, track, task timeline) the result the read returns, serialised with
   key order kept and `undefined` marked (book §5.0 rule 4; never sort, never canonicalise); (b) make the compare step
   fail when any required probe captured nothing on either side (per probe count). Run it on a fresh `s85-base` copy
   twice (determinism) and on a copy of your final commit once, on the same seven test files S2 used; report the
   per-probe counts and the differences (zero is the bar).

## 3. Scratch place (inside this copy, ignored by git)

`.dsh-scratch/R1/` in this copy (it is in `.git/info/exclude`; nothing in it is committed). Base copy:

```
S=.dsh-scratch/R1; mkdir -p $S/base $S/probes
git archive s85-base | tar -x -C $S/base
cp -al node_modules $S/base/node_modules
cp -al vendor/coding-agent/node_modules $S/base/vendor/coding-agent/node_modules
```

A result copy from a commit of yours the same way (`git archive HEAD | tar -x -C $S/result-1`, then the two `cp -al`
lines), in a new directory each time. Keep every probe, its command and its report under `$S/probes/`; the lead and
Codex re-run them. Do not use `/tmp` or any path outside this copy: they are lost when the run ends.

## 4. Byte proofs

- **P4-01:** with the base copy and the result copy, call `renderUnknownCallReviewZh` (from each copy's own source,
  e.g. a probe-only test file in the scratch copies) on at least: review phase with `items: []`; review with one
  expanded, one truncated and one unexpanded item; proposal phase (unchanged path) with and without targets. Compare
  the outputs as UTF-8 buffers per book §5.0 rule 4; zero differences.
- **P3-01:** in the result copy only, show that `renderTemplate` now throws for a template whose table has a required
  slot the template text does not use, when that slot is `undefined`; and that every v1 template still renders with
  the slots its callers pass (the tests below cover the callers).
- **P3-03:** `git diff` of the generated module shows only the `mentionsTools` assertions changed (plus whatever
  P4-01's template change regenerates).
- **P1-01:** the diff of the one line, beside the base's lines (`s85-base:src/core/agent-runtime/observed-model-run.ts:301–303`).
- **P2-01/02:** as §2 item 5.

## 5. Checks before you finish

One at a time: `npm run typecheck`; `npm run check:architecture`; `npm run build` (it runs the pack `--check` first).
Tests, only as `timeout 900 npx vitest run --maxWorkers=2 <at most 10 files>`: every file in `./.dsh-ref/r1-tests.txt`
plus `tests/architecture`. Never a `*.scale.test.ts`, `npm test`, `npm run test:scale` or a bare `npx vitest run`.
There is no bubblewrap here: a test that fails only on `ENOENT … bwrap` is an environment failure; list it with its
error text (it fails the same way on the base copy).

Commits (never amend, never reset; `.dsh-ref/` and `.dsh-scratch/` never committed):
- `git add -- src/core/agent-runtime/observed-model-run.ts && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "S85 S1 fix: P1-01"`
- `git add -- src/contracts scripts resources runtime-assets.json && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "S85 S3 fix: P3-01 P3-03 P4-01"`

Scope: `git diff --name-only n1-merged HEAD` lists only the files of §2; `git diff --name-only n1-merged HEAD --
tests` prints nothing; `git status --porcelain` prints nothing.

## 6. Reply (plain Chinese): `./.dsh-ref/s85-reply-R1.md`

Questions (if any); a summary under 200 words; one row per finding (fixed / not fixed, the file:line, the proof);
the byte proofs with their probe tables and paths; the tests run with pass/fail counts (environment failures
separately); the scope checks; the changed lines.
