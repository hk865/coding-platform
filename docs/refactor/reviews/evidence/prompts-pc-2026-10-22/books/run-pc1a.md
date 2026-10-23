# PC-1, run PC-1a: groups K and C (lead, 2026-10-22)

You are run **PC-1a**. Do groups **K** (the Kernel patch) and **C** (contracts and pack pieces) of the book
`./.dsh-ref/pc1-book.md`:
- its §1, §2 and §3.1–§3.2;
- the PC-1a lines of §4 and §5;
- §6.

Read §3.3–§3.5 only to know what C freezes for the next night (PC-1b). Do not implement them. A new Session, headless:
**when your turn ends, the whole run ends.**

| | |
| --- | --- |
| Groups | K: rulings 2–10 (ruling 1 is done), rows PC-11, PC-12, PC-13, PC-14, PC-16, PC-17, PC-15's Kernel case. C: rulings 12–13 and their tests (ruling 11 and `origins` are done) |
| Size | K about 1,100, C about 800 (added + deleted, tests included; generated files not counted) |
| Time limit | @MINUTES@ min |
| Base | tag `pc1a-am`: lead `dc462a95`, one commit with the frozen fixture `tests/helpers/PC-kernel-fixture.ts` (tag `pc1a-base`), and this morning's two short runs: **k1** `fdfc302` (ruling 1) and **c1** `493353f` (ruling 11, `origins`, test `tests/contracts/PC-platform-pack-v2.test.ts`). Scope and size are measured from `pc1a-base`. It does not typecheck until K adds the new Kernel inputs (17 errors, all in the fixture); that is expected |
| Commit | `PC-1a K: <what>` and `PC-1a C: <what>`, several commits are fine |
| Reply | `./.dsh-ref/pc1a-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`, then the book's parts named above.
- **K:** the Kernel part of `./.dsh-ref/inv-pc1.out.md` (Chinese, §1–§3) and of `./.dsh-ref/pc1-preread-final.md`.
- **C:** its §5–§6 parts.
- Codex's three checks of the book: `./.dsh-ref/pc1-chk1.out.md`, `pc1-chk2.out.md` and `pc1-chk3.out.md`. The book v3 answers
  them; read them only when a ruling's reason is unclear.
- TDD: `./.dsh-ref/tdd/`.
- There is no `rg` here; use `grep -n`. You coordinate; subagents read the code and do the work. Hand each subagent
  only its part of the book and of the inventory.

**Questions.** Nobody answers during the run. Write what you cannot understand into the first section of your reply.
Where a point blocks a step, skip that step, say so, and go on with the rest.

## A split with no overlapping files

This is a suggestion. Any split where two running subagents never edit one file is fine.

- **k1 is done** (`fdfc302`): the selection policy source is restored and managed; `--check` passes.
- **k2 from the start:** the selection policy and `runtime-runner.ts` (rulings 3–10), with the Kernel rows. It owns
  those two files and the new `tests/kernel/PC-*` files for PC-11…PC-14, PC-16, PC-17.
- **k3 from the start, beside k2:** `composition-root.ts`, `resume-composition.ts`, `composition-contracts.ts`,
  `public-api.ts` (ruling 2), with the tests of ruling 2's inputs, the `onConfiguration` report and resume. k2 and k3
  agree the runner's new constructor options first; ruling 2 names them.
- **Then:** `--write` and `--check` once, by one subagent, after both report.
- **c1 is done** (`493353f`): `base` and the five Skill templates are in the pack, `origins` exists and is generated,
  `runtime-assets.json` is updated, and `tests/contracts/PC-platform-pack-v2.test.ts` pins the six digests.
- **c2 from the start:**
  - `src/contracts/prompts/prompt-set.ts`, `platform-skills.ts`, the default pack source with its pure tests;
  - `tests/architecture/production-reach-allowlist.json`.
- **c3 from the start:**
  - `src/core/agent-runtime/source-tool-ports.ts`, new `platform-skill-root.ts`, `src/app/runtime-configuration.ts`
    and `src/app/host.ts`, with the full-Host-start test of ruling 13.
  - c3 imports c2's types once c2 reports its interface table.

## Rules for this night

1. **Scope.** Change only files matching `./.dsh-ref/pc1a-whitelist.txt` (anchored patterns). A step that needs
   another file is skipped and reported.
   - `tests/helpers/PC-kernel-fixture.ts` is frozen. It was written against the names of book ruling 3 before they
     existed.
   - Only if it fails to typecheck for a reason inside the fixture (a wrong import path or type spelling), you may
     fix that type-level error. Change nothing it does at run time, and list every changed line in the reply.
   - Never change it to make a test pass.
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
4. **Old tests.** Change only what book §5.3 names for K or C (PC-1a names none). Any other failure is your
   regression or an environment failure. Never `skip`, `todo`, `only`, or a raised timeout.

## Time

The runner stops this run at @MINUTES@ minutes. It then asks you, in the same Session, for the reply with a HANDOFF
section. Commit what is done and green before that. Do not leave a file half changed if you can avoid it: finish it
or undo it.

## Checks before you finish (book §6)

1. One at a time:
   - `node scripts/build-kernel-patch.mjs --check`;
   - `node scripts/build-platform-prompts.mjs --check`;
   - `flock … npm run typecheck`;
   - `npm run check:architecture`;
   - `flock … npm run build`.
   All green.
2. Tests: every new and changed test file, `tests/kernel`, `tests/architecture`, `tests/app`. Use batches of at most
   10 files under `timeout 900`; two subagents may run disjoint halves at the same time.
3. **Commit** without `.dsh-ref/`:
   `git add -A -- src scripts resources runtime-assets.json vendor/coding-agent tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`.
   A later fix is a new commit; never amend or reset.
4. **Scope:**
   - `git diff --name-only pc1a-base HEAD | grep -vE -f ./.dsh-ref/pc1a-whitelist.txt` prints nothing;
   - `git status --porcelain` prints nothing.
5. **Size:** `git diff --numstat pc1a-base HEAD -- . ':!vendor/coding-agent/dist' ':!src/contracts/prompts/platform-pack.generated.ts'`,
   per group.

## Reply (plain Chinese): `./.dsh-ref/pc1a-reply.md`

In this order:
1. Questions, if any.
2. A summary, under 300 words.
3. Per ruling and per row: RED → GREEN, with the test name.
4. **The interface table of everything C and K freeze for PC-1b:** path, export, exact signature, and who will use
   it. PC-1b codes against this table, so make it exact.
5. The tests run: files, pass and fail counts, failing test names. Environment failures go separately, with their
   error text.
6. The checks, with numbers.
7. The changed lines per group, and the allowlist entries added.
8. Suspected errors in the book, the inventory or this sheet.
9. A **HANDOFF** section, only if you stop before the end: the steps done, the files half done, the steps not
   started, and the shortest path to finish.
