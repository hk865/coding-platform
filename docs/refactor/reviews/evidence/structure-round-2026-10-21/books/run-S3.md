# Structure round, run S3: D3a (lead, 2026-10-21)

You are run **S3**. Do **D3a** only: book §5.1, the parts for S3 (rulings 1–11, "S3 = D3a", "Byte proof, S3"). Runs
S1 (D2) and S2 (C2, C1, A6, B1) work at the same time in other copies; S4 (D3b) follows on the next night on the
lead's merge of the three, and codes against your interface and key tables.

| | |
| --- | --- |
| Item | D3a — the pack format, the renderer, platform pack v1 and the text consumers outside the context assembler (book §5.1; inventory `inv-d3.out.md` §1 rows 9–23, 27, 29–45, the book's row 46, §2, §4, §5) |
| Size | about 2,150–2,950 added + deleted (pack and renderer 800–1,100, brief and K3 650–850, other consumers and 31 tool files 700–1,000) |
| Time limit | 300 min |
| Scratch | `/home/han001/dsh-work/s85-scratch/S3` |
| Commit | paths `src scripts resources runtime-assets.json package.json`, message `S85 S3: D3a prompt pack and renderer` |
| Tests | `./.dsh-ref/s85-tests.txt`: the test files that import a whitelisted file themselves (not through helpers: through the shared fixtures it would be about 530), plus the proof tests (about 170; split them between two subagents). The lead runs the rest with the daily suite after the merge |

**Whitelist** (`./.dsh-ref/s85-whitelist.txt`): the files of "S3 = D3a" in book §5.1 — new
`src/contracts/prompts/prompt-pack.ts`, `slot-tables.ts`, `render-template.ts`, `platform-pack.generated.ts`; new
`resources/prompts/platform/**`; new `scripts/build-platform-prompts.mjs`; `runtime-assets.json`,
`scripts/check-boundaries.mjs`, `package.json` (one step before `build`, nothing else); and the consumers
`src/contracts/continuation-brief.ts`, `src/contracts/core/prepared-execution.ts`, `src/contracts/note.ts`,
`src/core/agent-runtime/role-profiles.ts`, `query-preparation.ts` (the guide only), `execution-inputs.ts`,
`architecture-reminders.ts`, `whiteboard-tools.ts`, `note-tool.ts`, `project-source-tool.ts`, `exploration-tools.ts`,
`readonly-command-tool.ts`, `communication-tools.ts`, `graph-tools.ts`, `session-discovery-tools.ts`,
`unknown-call-review-tools.ts`, `command-rerun-tools.ts`, `src/core/work-graph/views/context-extensions.ts` (the three
texts only), `src/business/workflow/consultation.ts`, `src/app/host.ts` (the scribe reminder only).

Not yours tonight: `context-assembler.ts` and `note-read-model.ts` (S4's next night; S2 edits `note-read-model.ts`
tonight), and S1's `execution-driver.ts`, Runtime `query-execution.ts`, `observed-model-run.ts`.

**Order and split** (book §5.1 "Order inside the run" and ruling 11):
- (1) the pack owner — one subagent, the only one that ever edits `resources/prompts/platform/**`, `slot-tables.ts`,
  `runtime-assets.json` and the generated module: types, renderer, the ten slot tables, the build script, the checks
  and the `package.json` step; then the complete key table (template ids, slot tables, string keys, tool files),
  frozen in an interface table that you hand every consumer.
- (2) at the same time: the probes of "Byte proof, S3" on the base copy (record the renderer calls; the guide; the
  tools at the two points). Run them twice on the base and show the logs compare equal.
- (3) the consumers, split by file among subagents (for example: the brief and K3 — `continuation-brief.ts`,
  `prepared-execution.ts`; the 13 tool files in two halves; the rest — `role-profiles.ts`, `query-preparation.ts`,
  `execution-inputs.ts`, `architecture-reminders.ts`, `contracts/note.ts`, `context-extensions.ts`,
  `consultation.ts`, `host.ts`). They code against the key table and hand the owner each text (key, exact text, base
  location); they never write a resource file.
- (4) the owner writes the resources and generates the module once all texts are in.
- (5) the proofs on a result copy, then your checks.
- Your reply also has the tables S4 needs: the key table, the `tool name | resource key | base .describe location`
  table (ruling 6), and the interface table of the four new modules and the build script.

## Base

- Tag `s85-base` is this run's base: HEAD when you start, the lead branch after SC merged (lead commit `20f64821`,
  same tree). Every count and every byte proof is against `s85-base`.
- The frozen prompts spec the book names is in this copy at its `docs/` path; read only the parts the book names.

## Read first, and only this

- The book (`s85-book.md`, given to you as the task): §1–§4, **your item sections only** (named above), §5.0, §6,
  §7. Do not read the other items' sections.
- The inventory for your items, only the parts the book names: `./.dsh-ref/inv-d3.out.md` (D3),
  `./.dsh-ref/inv-rest.out.md` (D2, C2, C1, A6), `./.dsh-ref/inv-b1.out.md` (B1). Hand a subagent only its part.
- `./.dsh-ref/coordinator-mode.md`.
- There is no `rg` here; use `grep -n`. A coordinator that reads large files fills its context in minutes: you
  coordinate, subagents read the code and do the work.

**Questions.** This run is headless and nobody answers during it. Write what you cannot understand into the first
section of your reply. Where a point blocks a step, skip that step (book §2 rule 4), say so, and go on with the rest.

## Scratch place for the byte proofs (book §5.0)

`$S85_SCRATCH` is `/home/han001/dsh-work/s85-scratch`; your directory is `/home/han001/dsh-work/s85-scratch/S3`
(called `$S` below; write the path out in each command, the variable is not set for you). It is outside this
repository copy. Nothing in it enters your working tree.

```
S=/home/han001/dsh-work/s85-scratch/S3; mkdir -p $S/base $S/probes
git archive s85-base | tar -x -C $S/base
cp -al node_modules $S/base/node_modules
cp -al vendor/coding-agent/node_modules $S/base/vendor/coding-agent/node_modules
```

A result copy is made the same way from a commit of yours, in a new directory each time (`$S/result-1`,
`$S/result-2`, …; do not delete old ones): `git archive HEAD | tar -x -C $S/result-1`, then the two `cp -al` lines.
Probes are edited into the copies only, the same edit in both (book §5.0 rule 2). Keep every probe, its run command
and its report under `$S/probes/`; the lead and Codex re-run them.

## Rules for this night

1. **Scope.** Change only the files of your whitelist (`./.dsh-ref/s85-whitelist.txt`, anchored patterns; listed
   above too). A step that needs another file is skipped and reported (book §2 rules 4–5). Two runs edit other files
   in other copies at the same time; their files are not yours even where the import graph touches them.
2. **Memory (binding).** Three DSH runs share this machine.
   - `tsc` only as `flock /home/han001/dsh-work/s85-scratch/tsc.lock npm run typecheck` and
     `flock /home/han001/dsh-work/s85-scratch/tsc.lock npm run build`, by you, never by a subagent while another
     subagent runs one. The lock is shared by the three runs; waiting on it is normal.
   - Tests only as **`npx vitest run --maxWorkers=2 <files>`, never more workers**, at most 10 files per command,
     each command under `timeout 900`. Put this line in every subagent's prompt. This holds in the scratch copies too.
     Never run a `*.scale.test.ts` file, `npm run test:scale`, `npm test` or a bare `npx vitest run` (the scale batch
     takes about an hour; the lead runs it with the full suite).
   - At most **two subagents running tests at the same time** in your run; subagents that only read or edit may run
     beside them, on files that do not overlap.
   - **Do not end your turn before every subagent has reported back** (`sleep 300`, then `list_agents`).
3. **The process sandbox.** There is no bubblewrap here: a test that fails only on `ENOENT … bwrap` (or the sandbox
   reported unavailable) is an environment failure. List it with its error text; it fails the same way in the base
   copy. The lead runs it with the sandbox.
4. **Tests are not edited** (book §2 rule 2). A failing test is your regression (undo or fix your change) or an
   environment failure (rule 3). Never `skip`, `todo`, `only`, or a raised timeout.

## Interfaces frozen by earlier runs

None: S1, S2 and S3 are the first night and start from the same base. Your reply's interface table is what S4 codes against on the second night.

## Time

The runner stops this run at 300 minutes and then asks you, in the same Session, for the reply with a HANDOFF
section. Commit what is done and green before that; do not leave a file half moved if you can avoid it (finish the
file or undo it).

## Checks before you finish (book §3)

1. `flock /home/han001/dsh-work/s85-scratch/tsc.lock npm run typecheck`, `npm run check:architecture`,
   `flock /home/han001/dsh-work/s85-scratch/tsc.lock npm run build`: all green, one at a time.
2. The tests: every file in `./.dsh-ref/s85-tests.txt` (computed by the lead on the base as the table above says,
   plus the test files your byte proofs name) plus `tests/architecture`, in batches of at most 10 files under
   `timeout 900`; two subagents may run disjoint
   halves of the list at the same time. A new module is covered by the files that import its old home. The lead runs
   the daily suite after the merge.
3. Commit without `.dsh-ref/`:
   `git add -A -- src scripts resources runtime-assets.json package.json && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "S85 S3: D3a prompt pack and renderer"`.
   A later fix is a new commit (`S85 S3: D3a prompt pack and renderer fix`); never amend or reset.
4. Scope: `git diff --name-only s85-base HEAD | grep -vE -f ./.dsh-ref/s85-whitelist.txt` prints nothing;
   `git diff --name-only s85-base HEAD -- tests` prints nothing; `git status --porcelain` prints nothing.
5. Size: `git diff --numstat s85-base HEAD` (a new file counts all its lines as added); give added + deleted and the
   net, against the size in the table above.
6. The byte proofs of your items (book §5), each run on the final commit's result copy.

## Reply (plain Chinese): `./.dsh-ref/s85-reply-S3.md`

Book §7, in this order: questions (if any); the summary (under 300 words); the per-step table; the interface table
of every new module (path, export, signature, where it came from, who uses it) — this table is what the next night's
run codes against, so make it exact; the byte proofs with their probe tables (book §5.0 rule 6) and the probe paths;
the test files run, with pass/fail counts and failing test names (environment failures separately, with the error
text); the checks of step 4; the changed lines; suspected errors in the book, the inventories or this sheet; and a
**HANDOFF** section only if you stop before the end (done steps, half-done files, steps not started, the shortest
path to finish).
