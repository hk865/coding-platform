# PC-2, run PC-2: groups A, H, W, T, G, Q and the joint step (lead, 2026-10-22, night)

You are run **PC-2**. Do every group of the book `./.dsh-ref/pc2-book.md` (v4, frozen) and then its joint rows: packs
on disk, their resolution and editing routes, selection, section order, the stale-files reminder, tool declarations
and the platform tools' texts from a person's pack. A new Session, headless: **when your turn ends, the whole run
ends.**

| | |
| --- | --- |
| Groups | A (pack, pure), H (Host), W (tool texts as input, a rework of W's commit), T (texts and rendering), G (guard and entry), Q (preparation to request); then the joint rows of book §4 |
| Size | 7,139 added + deleted, per group in book §6 |
| Time limit | @MINUTES@ min |
| Base | tag `pc2-base`: PC-1 as accepted (PC-1a, PC-1b and its two reworks, `68dfb10`), W's commit `PC-2 W: tool factories take platform tool texts`, and one commit with the two frozen fixtures `tests/helpers/PC2-pack-fixture.ts` and `PC2-host-fixture.ts`. The tree does not typecheck until A adds `resolve-pack.ts` and `PromptPackChainEntryV1` and H adds the six `prompts/*` settings routes (the fixtures use the book's names); that is expected |
| Commit | `PC-2 A: <what>`, `PC-2 H: <what>`, … `PC-2 joint: <what>`; several commits are fine |
| Reply | `./.dsh-ref/pc2-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`, then the book whole: §1, §2 and §4–§6 for everyone, each group its part of §3.
- **The book's line numbers are against `dc462a95` plus W.** PC-1 has moved code since; find a place by its name,
  not its line. What PC-1 built differently from its book is in the "Book corrections" sections of
  `./.dsh-ref/pc1b-findings.md` and `./.dsh-ref/pc1b-r2-findings.md` (PC-1's evidence README is not written yet;
  these stand in for it). The ones that touch PC-2:
  - a start compares the five prompt-selection fields exactly, `selection` or not (S-01); a helper that prepares
    and starts uses **one** model binding for both (the scenario double `ag2bWorkRuntime` takes `workModelId`);
  - preview and send share one final-request transform (`observed-model-run.ts`, S-02);
  - `CONTEXT_SECTION_HEADERS` and the other test-only constants of `context-rendering.ts`,
    `continuation-brief.ts` and `query-preparation.ts` are deleted (J-07); old tests use literals;
  - `prompt-set-texts.ts` defaults to the public `FileSkillLoader`.
- PC-1's book `./.dsh-ref/pc1-book.md` §3.2 and PC-1a's interface table `./.dsh-ref/pc1a-interfaces.md` (§4) for the
  contracts PC-2 builds on; code against them and the code, not against a guess.
- Codex's inventory `./.dsh-ref/inv-pc2.out.md` (Chinese) and its book checks `./.dsh-ref/pc2chk1.out.md`,
  `pc2chk2.out.md`; the book answers them; read them only when a ruling's reason is unclear.
- W's reply `./.dsh-ref/pc2w-reply.md` for what W's commit did. TDD: `./.dsh-ref/tdd/`.
- There is no `rg` here; use `grep -n`. You coordinate; subagents read the code and do the work. Hand each subagent
  its group's part of the book whole, §2 and §4 whole, and the frozen interfaces it codes against.

**Questions.** Nobody answers during the run. Write what you cannot understand into the first section of your reply.
Where a point blocks a step, skip that step, say so, and go on with the rest.

## A split with no overlapping files

The book §4 owns every production file and every old test to one group; keep it. Order (book §4):

- **a, first:** A's resolver interface (`prompt-pack.ts` extended, new `resolve-pack.ts`), then the rest of A.
- **t after a's interface:** T freezes platform pack v2, `ContextTemplateId`, the rendering material, the
  assembler's input additions, `AssembledContextV1`'s new required fields and the role-reminder slot, commits that
  freeze point, then finishes T.
- **h after a's interface, beside t:** H. **w from the start, beside a:** W (needs nothing from A or H).
- **g and q after t's freeze point:** G and Q, beside each other.
- **The joint step, by one subagent, after every group has reported and the typecheck is green:** the joint rows of
  book §4 (PC-03, PC-04 prepared vs new, PC-05, PC-06 and PC-08 PC-2 variants, PC-18, PC-20, PC-21, PC-26), then
  Q's single edit of `tests/architecture/production-reach-allowlist.json`.

A seam that turns out wrong is a question in the reply; the group codes the nearest version that compiles and says so.

## Rules for this night

1. **Scope.** Change only files matching `./.dsh-ref/pc2-whitelist.txt` (anchored patterns). A step that needs
   another file is skipped and reported.
   - Frozen, unchanged: `tests/helpers/PC-platform-fixture.ts`, `PC-kernel-fixture.ts`, `PC2-pack-fixture.ts`,
     `PC2-host-fixture.ts`. If a PC2 fixture fails to typecheck for a reason inside the fixture (not a PC-2 name it
     waits for), report it with the error; never change a fixture to make a test pass.
   - A K3 test that opens the review world installs the existing `shellSeam` module mock first, as the K3 tests do;
     open the platform fixtures one at a time (they spy on factories).
2. **Tests (decision 80 bar, as the PC-1 audits applied it).**
   - Expected values are literals or hand-computed: hand-written texts and JSON, `sha256` of literal strings,
     `Buffer.byteLength` of hand-written JSON. Never from production code, the generated pack, `preparedTexts()`,
     a manifest or a captured request.
   - Through public steps; no database reads; no hand-written facts. Fault injection and the frozen fixtures' seams
     are fine.
   - A whole text is compared whole, not by a prefix or a regular expression.
   - Each test row: write the case, see it fail for the right reason (RED), then make it pass (GREEN). For each row
     also name one mutation of the production rule that the case catches, and check it once.
   - **Per-test limits:** none unless the case measured above 10 s; never above `60_000`. No old test's limit rises.
3. **Memory (binding).**
   - `tsc` only as `flock ./.dsh-scratch/tsc.lock npm run typecheck` and the same with `npm run build`. Run it
     yourself, never from a subagent while another subagent runs one.
   - Tests only as **`npx vitest run --maxWorkers=2 <files>`**: never more workers, at most 10 files per command,
     each command under `timeout 900`. Put this line in every subagent's prompt.
   - Never run a `*.scale.test.ts` file, `npm run test:scale`, `npm test` or a bare `npx vitest run`.
   - At most **two subagents running tests at the same time.**
   - **Do not end your turn before every subagent has reported back** (`sleep 300`, then `list_agents`).
4. **No bubblewrap here.** A test that fails only on `ENOENT … bwrap`, `bwrap: command not found`, or a check that
   answers `unsupported` because the sandbox is missing, is an environment failure: list it with its error text. Most
   `tests/scenarios` files need bubblewrap; the lead reruns them.
5. **Old tests.** Change only what book §5.3 and §3.3's PC-2 bullets name, for the reason they give. Any other failure
   is your regression or an environment failure. Never `skip`, `todo`, `only`, or a raised limit.

## Time

The runner stops this run at @MINUTES@ minutes. It then asks you, in the same Session, for the reply with a HANDOFF
section. Commit what is done and green before that. Do not leave a file half changed if you can avoid it: finish it
or undo it. If time is short, finish A, T, H and W green before G and Q, and every group before the joint step.

## Checks before you finish (book §6)

1. One at a time:
   - `node scripts/build-kernel-patch.mjs --check`;
   - `node scripts/build-platform-prompts.mjs --check`;
   - `flock … npm run typecheck`;
   - `npm run check:architecture`;
   - `flock … npm run build`.
   All green.
2. Tests: every new and changed test file; `tests/app`; `tests/architecture`; the ten `tests/runtime/PC2-W-*` files;
   then the importers of the changed production files outside `tests/scenarios`
   (`grep -rlE "<file stem>" tests | grep -v '^tests/scenarios/'`), in batches of at most 10 under `timeout 900`;
   two subagents may run disjoint halves at the same time. List the `tests/scenarios` importers you did not run.
3. **Commit** without `.dsh-ref/`:
   `git add -A -- src scripts resources runtime-assets.json tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`.
   A later fix is a new commit; never amend or reset.
4. **Scope:**
   - `git diff --name-only pc2-base HEAD | grep -vE -f ./.dsh-ref/pc2-whitelist.txt` prints nothing;
   - `git diff --name-only pc2-base HEAD -- tests/helpers/PC-platform-fixture.ts tests/helpers/PC-kernel-fixture.ts tests/helpers/PC2-pack-fixture.ts tests/helpers/PC2-host-fixture.ts` prints nothing;
   - `git status --porcelain` prints nothing.
5. **Size:** `git diff --numstat pc2-base HEAD`, per group.

## Reply (plain Chinese): `./.dsh-ref/pc2-reply.md`

Under 1,200 words, in this order:
1. Questions, if any.
2. A summary, under 300 words.
3. Per ruling and per row: RED → GREEN, with the test name and the mutation it catches.
4. The files with lines added, removed and total per group; each old test changed and why.
5. The inputs of ruling 16's tool-list function.
6. The checks with numbers; the tests run (files, passed, failed, environment failures with their text, the
   scenario importers not run).
7. Any allowlist entry left, with the later consumer that will remove it.
8. Every seam coded differently from the book, and UNSPECIFIED.
9. A **HANDOFF** section, only if you stop before the end: the steps done, the files half done, the steps not
   started, and the shortest path to finish.
