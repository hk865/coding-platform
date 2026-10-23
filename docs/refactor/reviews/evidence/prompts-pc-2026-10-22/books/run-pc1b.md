# PC-1, run PC-1b: groups P, S, R and the joint step (lead, 2026-10-22)

You are run **PC-1b**. Do groups **P** (preparation and entry), **S** (the send path), **R** (records and the read)
and then the **joint step** of the book `./.dsh-ref/pc1-book.md`:
- its §1, §2 and §3.3–§3.5;
- the PC-1b lines of §4 and §5;
- §6.

§3.1–§3.2 (K and C) are merged; read them only for the names you use. A new Session, headless: **when your turn
ends, the whole run ends.**

| | |
| --- | --- |
| Groups | P: rulings 14, 15, 17, 18, 19. S: rulings 16, 20–25. R: rulings 26–30. Joint: PC-06, PC-07, PC-08, PC-09, PC-10, PC-15's platform cases, the allowlist cleanup |
| Size | P about 1,200, S about 1,100, R about 1,200 (added + deleted, tests included) |
| Time limit | @MINUTES@ min |
| Base | tag `pc1b-base`: PC-1a with its rework 1, plus one commit with the frozen fixture `tests/helpers/PC-platform-fixture.ts`. It does not typecheck until P, S and R meet the §4 seams (the fixture uses their names); that is expected |
| Commit | `PC-1b P: <what>`, `PC-1b S: <what>`, `PC-1b R: <what>`, `PC-1b joint: <what>`; several commits are fine |
| Reply | `./.dsh-ref/pc1b-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`, then the book's parts named above.
- **PC-1a's interface table:** `./.dsh-ref/pc1a-interfaces.md` (§4 of PC-1a's reply; rework 1 removed `LocalWorkbenchHost.runtime`, see `./.dsh-ref/pc1a-r1-reply.md`). Code against it and the code, not against your guess of C's or K's
  names.
- **P, S, R:** their parts of `./.dsh-ref/inv-pc1.out.md` (Chinese, §4–§9) and of `./.dsh-ref/pc1-preread-final.md`.
- Codex's checks of the book: `./.dsh-ref/pc1-chk1.out.md`, `pc1-chk2.out.md`, `pc1-chk3.out.md`. The book v3
  answers them; read them only when a ruling's reason is unclear.
- TDD: `./.dsh-ref/tdd/`.
- There is no `rg` here; use `grep -n`. You coordinate; subagents read the code and do the work. Hand each subagent
  only its part of the book and of the inventory, plus the §4 seams block whole.

**Questions.** Nobody answers during the run. Write what you cannot understand into the first section of your reply.
Where a point blocks a step, skip that step, say so, and go on with the rest.

## A split with no overlapping files

This is a suggestion. Any split where two running subagents never edit one file is fine. The §4 seams block is the
contract between them; nobody changes a seam alone. A seam that turns out wrong is a question in the reply, and the
group codes the nearest version that compiles and says so.

- **p0, first and short:** `src/contracts/prompts/prompt-set.ts` gets `PromptTextsV1` and `checkPromptBody`;
  `render-template.ts` accepts `PromptTextsV1`. Pure tests. Commit. Then p1 and p2 start.
- **p1 after p0:** rulings 14, 15, 18, 19. `execution-preparation.ts`, `query-preparation.ts`, the `context-*.ts`
  files, `role-profiles.ts`, new `prompt-set-texts.ts`, `src/contracts/continuation-brief.ts`,
  `src/contracts/core/prepared-execution.ts`, and P's old tests of §5.3 (W2, AG6, C2, the hand-written manifests,
  the K3-35 size tests).
- **p2 after p0, beside p1:** ruling 17, `src/core/work-graph/tasks/execution-entry-service.ts` only.
- **s1 from the start:** rulings 20, 21, 24, 25: `model-budget.ts`, `observed-model-run.ts`.
- **s2 after s1:** rulings 16, 22, 23: `execution-driver.ts`, the Runtime `query-execution.ts`, the deletion of
  `resources/skills/platform-*` and its `runtime-assets.json` entries, and the direct `runObservedModel` tests of
  §5.3 (with `frozenPromptInputs(...)` from the fixture).
- **r1 from the start:** rulings 26, 28: `src/core/work-graph/tasks/model-call-*.ts`, `model-request-codecs.ts`,
  `src/core/agent-runtime/model-call-access.ts`, `src/contracts/dispatch.ts`, and R's old tests of §5.3.
- **r2 from the start, beside r1:** ruling 27: `src/core/work-graph/queries/**`, `src/contracts/query-job.ts`.
- **r3 after r1 and r2:** rulings 29, 30: `runtime.ts`, `ports.ts`, `execution-contracts.ts`,
  `src/composition/create-platform.ts`.
- **Then the joint step, by one subagent, after every group has reported and the typecheck is green:**
  - the joint rows (book §4, §5.2), in new `tests/runtime/PC-joint-*.test.ts` files;
  - `tests/architecture/production-reach-allowlist.json`: remove the PC-1b entries the groups report as wired;
    every entry PC-1a added must be gone at the end, or the reply says which consumer is still missing.

## Rules for this night

1. **Scope.** Change only files matching `./.dsh-ref/pc1b-whitelist.txt` (anchored patterns). A step that needs
   another file is skipped and reported.
   - `tests/helpers/PC-platform-fixture.ts` is frozen. Only if it fails to typecheck for a reason inside the fixture
     (a wrong import path or type spelling) may you fix that type-level error. Change nothing it does at run time,
     and list every changed line in the reply. Never change it to make a test pass.
   - `tests/helpers/PC-kernel-fixture.ts` is frozen as merged.
   - Notes on the platform fixture: the book's `RuntimeDeps` is `RuntimeExecutionDependencies` in the code; a test
     that opens the K3 review world installs the existing `shellSeam` module mock first, as the K3 tests do; the
     fixture wires its dependencies by spying on `createAgentRuntime`, as `tests/helpers/S4A-note-fault-fixture.ts`
     ~96 does for other factories, so open fixtures one at a time.
2. **Memory (binding).**
   - `tsc` only as `flock ./.dsh-scratch/tsc.lock npm run typecheck` and the same with
     `npm run build`. Run it yourself, never from a subagent while another subagent runs one.
   - Tests only as **`npx vitest run --maxWorkers=2 <files>`**: never more workers, at most 10 files per command,
     each command under `timeout 900`. Put this line in every subagent's prompt.
   - Never run a `*.scale.test.ts` file, `npm run test:scale`, `npm test` or a bare `npx vitest run`.
   - At most **two subagents running tests at the same time.**
   - **Do not end your turn before every subagent has reported back** (`sleep 300`, then `list_agents`).
3. **The process sandbox.** There is no bubblewrap here. A test that fails only on `ENOENT … bwrap`, or reports the
   sandbox unavailable, is an environment failure: list it with its error text. It fails the same way on the base.
4. **Old tests.** Change only what book §5.3 names, for the reason it gives. Any other failure is your regression or
   an environment failure. Never `skip`, `todo`, `only`, or a raised timeout.

## Time

The runner stops this run at @MINUTES@ minutes. It then asks you, in the same Session, for the reply with a HANDOFF
section. Commit what is done and green before that. Do not leave a file half changed if you can avoid it: finish it
or undo it. If time is short, finish P, S and R green before the joint step.

## Checks before you finish (book §6)

1. One at a time:
   - `node scripts/build-kernel-patch.mjs --check`;
   - `node scripts/build-platform-prompts.mjs --check`;
   - `flock … npm run typecheck`;
   - `npm run check:architecture`;
   - `flock … npm run build`.
   All green.
2. Tests: every new and changed test file, plus the importers of every changed production file
   (`grep -rlE "<file stem>" tests`), plus `tests/architecture`. Use batches of at most 10 files under `timeout 900`;
   two subagents may run disjoint halves at the same time.
3. **Commit** without `.dsh-ref/`:
   `git add -A -- src scripts resources runtime-assets.json tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`.
   A later fix is a new commit; never amend or reset.
4. **Scope:**
   - `git diff --name-only pc1b-base HEAD | grep -vE -f ./.dsh-ref/pc1b-whitelist.txt` prints nothing;
   - `git status --porcelain` prints nothing.
5. **Size:** `git diff --numstat pc1b-base HEAD`, per group.

## Reply (plain Chinese): `./.dsh-ref/pc1b-reply.md`

In this order:
1. Questions, if any.
2. A summary, under 300 words.
3. Per ruling and per row: RED → GREEN, with the test name.
4. Every seam you coded differently from book §4, with the reason.
5. The tests run: files, pass and fail counts, failing test names. Environment failures go separately, with their
   error text.
6. The checks, with numbers.
7. The changed lines per group; each old test changed and why; the allowlist entries removed and any left.
8. What PC-15's platform case did on the base tree; the remaining generated-pack importers (ruling 14).
9. Suspected errors in the book, the inventory or this sheet.
10. A **HANDOFF** section, only if you stop before the end: the steps done, the files half done, the steps not
    started, and the shortest path to finish.
