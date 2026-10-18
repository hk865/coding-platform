# Task: K3 group 4 session B3, rework 4 — Runs end only through the Runtime; the shared fixture takes no facts; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`; **read its sections "How tests reach their state: no hand-written facts" (it has a
new bullet, "A name does not change what it is") and "Before you build: what the reworks were about" first; both bind
every brief**, and the close-out runs one vitest command at a time). Files disjoint between subagents, every vitest
command `--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 180
minutes** (the run stops at 190). Finish whole items; an unfinished item is reported, not half-done. Delete
`./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is

Tag `k3-g4b3-r3` (HEAD) = B3 rework 3 (book `./.dsh-ref/k3-g4b3-rework-3.md`, your reply
`./.dsh-ref/k3-g4b3-rework3-final.md`). Codex's quick check of it: `./.dsh-ref/k3g4b3-review4.out.md` (Chinese,
file:line and the fix approach). The lead checked its items 2 and 3 in the code; they hold: `tests/helpers/real-run-end.ts`
~172–182 builds the terminal event and calls `entry.recordRunResult` itself, and `injectDeclaredToolStarts`
(`tests/helpers/K-boundary-facts-support.ts` ~154–180) opens the Kernel store and appends `tool.started` events. Both
are hand-written facts. Production code is done (items 1, 4, 5 of rework 3 hold); this round is the tests.

**The rule for the shared fixture (`openRealRunHarness`, `tests/helpers/K3-35-continuation-fixture.ts`).** It exposes
only steps a product actor takes: public claim, production prepare, `runtime.port.startRun`, `decisions/answer`, the
public plan change, the public cancel, the public requeue. Its inputs are injected dependencies only: clock, id
generator, scripted model replies and faults, blocking seams and latches around real dependencies. It never calls an
owner's write that the Runtime or Host calls, never opens a store, never takes or builds a draft, item, event,
position, cursor, prepared value or digest.

## 2. Items (binding; Codex's numbering in brackets)

1. **A Run ends only through the Runtime** [2]. Delete `recordRealRunEnd` and `tests/helpers/real-run-end.ts`. A
   completed end is the scripted model's final text reply; a crashed end is a fault the scripted model throws in its
   `beforeReply` on the named round (`tests/helpers/B2-runtime-fixture.ts` ~69, `createScriptedModel(replies,
   beforeReply)`), which the Runtime turns into `run_crashed` (`terminalEventOf`, `src/core/agent-runtime/
   execution-observation.ts` ~130–137) and records through its own `recordRunResult` (~787); the test awaits
   `startRun`'s promise and then reads the result through public reads. The anomaly anchors of K3-35 come from such a
   real crash. `createRecordFromDraft` (~553) takes no draft: the record comes from the production recognition path
   that reads the draft itself (`create-platform.ts` ~2070, the real classifier). The source digest comes from the real
   source capture the claim or prepare already uses, not a hashed counter (~432); name which in the reply.
2. **No appended Kernel events** [3]. K3-35 stops using `injectDeclaredToolStarts`. A mixed tool batch runs one call at
   a time (`vendor/coding-agent/dist/tools/registry/tool-registry.js` ~135–142), so the real scenario keeps what that order
   reaches (the blocked call and the calls that start before it). The 32-item extreme stays only in the pure renderer
   boundary test (`K3-35-renderer-boundary.test.ts`). Re-derive the scenario totals on what the real path produces and
   show the arithmetic. Delete `injectDeclaredToolStarts` if nothing else uses it (the K tests' other
   `K-boundary-facts-support.ts` functions are not this round's).
3. **The closed branch is reachable; restore its test** [4]. Prepare checks a snapshot (`execution-preparation.ts`
   ~334, ~350) before it reads the closure (~461). Test: wrap the real closure reader with a latch (a blocking seam
   around a real dependency); while prepare waits on it, cancel the not-yet-entered Run through the public cancel
   (`run-machine.ts` ~1927, ~1959) and close the Task through the public plan change (`K3-review-card-fixture.ts` ~342,
   ~350); release; assert prepare's refusal as the spec says. Restore the deleted assertion and correct the
   "unreachable" comment (`K3-review-preparation.test.ts` ~514).
4. **Move the second copies onto the shared fixture, then delete them** [5, 6]. Each of these still builds a prior
   state the shared path produces: the fake follow-up Run (`B2-blocked-runtime.ts` ~131), the hand-made process item
   (`B2-crr-world.ts` ~24), the boolean closure (`K3-crr-fixture.ts` ~141), the proposal item builders and the second
   start-up assembly (`K3-proposal-round.ts` ~112, ~127, ~594), the auto-settled item and the constant fallback when the
   command is missing (`K3-review-card-fixture.ts` ~366, ~137), the K3 chain's use of the hand-made prepared value
   (`B2-execution-fixture.ts` ~200), and the proposal half of `K3-48-2-unknown-call-review-model-text-budget.test.ts`
   (~167, ~184). Delete `setTaskActive` (`K3-crr-fixture.ts` ~208, unused). Keep the scripted model and Host
   dependencies of `B2-runtime-fixture.ts` (~69, ~140). Report helper lines before and after (5,687 now); the count
   should fall.
5. **One 401-Run world for B2-18 and B2-16** [7, the lead makes it binding]. Build the 401 real Runs once (shared
   setup or one file): first the read-only hook proof, then the 402nd request; reset the read counters between them.
   Each continuation ends by the model's natural final reply (no crash, no extra history read). R stays 401. Report the
   time (before: 208 s + 230 s).
6. **Close what you open** [7]. The harness's own SQLite (`K3-35-continuation-fixture.ts` ~404) is closed by every
   caller in `finally`: release the gate, await the Run, close the union (`B2-18-request-reads.test.ts` ~63, ~206;
   `B2-16-hook-reads.test.ts` ~60, ~250, or their replacement after item 5).

**Not this round** (Codex's item 6, kept on the lead's T-round list): `K3-11-review-reasons.test.ts` ~162,
`K3-14-unknown-call-review-tool.test.ts` ~125, `K3-45-review-incomplete.test.ts` ~142,
`K3-48-2-unknown-call-review-model-text-budget.test.ts` ~132, `K-R-close-open-turn.test.ts` ~68,
`B2-execution-entry.test.ts` ~237. Leave them.

## 3. Checks

`--maxWorkers=2`, **one vitest command at a time**, exact file lists (vitest treats positional globs as substring
filters): every `K3-*`, `B2-*` and `K-*` test, `S5*`, `S4C2-*`, `tests/business/`, `tests/scenarios/WP1-*`,
`tests/scenarios/A8-host-restart*`, `tests/state/`, `tests/composition/`, `tests/app/S4C*`, `tests/architecture/`,
`tests/runtime/`, `*brief*` tests, the changed files; `npm run typecheck`, `npm run check:architecture`, `npm run
build`. Failures listed in `DSH-BASELINE.md` are expected (no bwrap). The close-out greps every K3/B2 test and helper
for `recordRunResult`, store `append`/`commit`, `SqliteStores.open`, and constructed drafts, items, events, positions,
cursors or prepared values, and lists each hit with why it is allowed. No real model calls, no git writes, never ports
3080/3099/44797.

## 4. Reply

Under 900 words: per item RED → GREEN or how it was checked, helper lines before and after, which helpers were
deleted, the K3-35 scenario totals with their arithmetic, the 401-Run world's time, the grep list, checks with
numbers, UNSPECIFIED.
