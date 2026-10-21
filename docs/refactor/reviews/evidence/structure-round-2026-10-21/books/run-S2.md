# Structure round, run S2: C2, C1, A6, B1 (lead, 2026-10-21)

You are run **S2**. Do items **C2, C1, A6 and B1** only: book §5.3–§5.6. Runs S1 (D2) and S3 (D3a) work at the same
time in other copies; S4 (D3b) follows on the next night on the lead's merge of the three.

| | |
| --- | --- |
| Items | C2 (book §5.3), C1 (§5.4), A6 (§5.5) — inventory `inv-rest.out.md`, their parts; B1 (§5.6) — `inv-b1.out.md` |
| Size | about 700–820 added + deleted (C2 about 190, C1 about 160, A6 about 85, B1 about 260–380) |
| Time limit | 180 min |
| Scratch | `/home/han001/dsh-work/s85-scratch/S2` |
| Commit | paths `src`, message `S85 S2: C2 C1 A6 B1` |
| Tests | `./.dsh-ref/s85-tests.txt`: the test files that import a whitelisted file, directly or through a test helper, plus the proof tests (about 190; split them between two subagents) |

**Whitelist** (`./.dsh-ref/s85-whitelist.txt`):
- C2: `src/core/work-graph/views/activity-read-model.ts`, `views/track-read-model.ts`, `views/task-state-timeline.ts`,
  new `views/activity-stable-window.ts`.
- C1: `src/core/work-graph/notes/note-read-model.ts`, `notes/note-service.ts`, `notes/scribe-scope.ts`,
  `notes/note-decision-source.ts`, `notes/note-scribe-todos.ts`, new `notes/note-base-reader.ts`,
  new `notes/note-rendering.ts`.
- A6: `src/core/work-graph/tasks/run-activity-service.ts`, new `src/core/work-graph/state/activity-replacement.ts`.
- B1: new `src/core/work-graph/persistence/event-codec-factory.ts`, `persistence/decision-record-codecs.ts`,
  `persistence/line-settings-codecs.ts`.

Run S3 edits `src/core/work-graph/views/context-extensions.ts` and `src/contracts/note.ts` tonight: not yours.
`note-read-model.ts` is yours tonight for C1 only; its warning label text (`generalWarningLabel`) is S4's.

**A split with no overlapping files** (a suggestion): the four items touch disjoint files, so one subagent per item.
Start C2 (with its probe logs on the base copy, book §5.3) and C1 first; then B1 and A6 as a subagent frees. At most
two of them run tests at once (rule 2). Each item commits only when its own tests pass; one commit per item is fine
(`S85 S2: C2`, …), the lead squashes. The static proofs of C1, A6 and B1 go into the reply as the book asks
(diffs of the old and new function text, the binding table, the side-by-side of B1's three decoders).

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

`$S85_SCRATCH` is `/home/han001/dsh-work/s85-scratch`; your directory is `/home/han001/dsh-work/s85-scratch/S2`
(called `$S` below; write the path out in each command, the variable is not set for you). It is outside this
repository copy. Nothing in it enters your working tree.

```
S=/home/han001/dsh-work/s85-scratch/S2; mkdir -p $S/base $S/probes
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

The runner stops this run at 180 minutes and then asks you, in the same Session, for the reply with a HANDOFF
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
   `git add -A -- src && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "S85 S2: C2 C1 A6 B1"`.
   A later fix is a new commit (`S85 S2: C2 C1 A6 B1 fix`); never amend or reset.
4. Scope: `git diff --name-only s85-base HEAD | grep -vE -f ./.dsh-ref/s85-whitelist.txt` prints nothing;
   `git diff --name-only s85-base HEAD -- tests` prints nothing; `git status --porcelain` prints nothing.
5. Size: `git diff --numstat s85-base HEAD` (a new file counts all its lines as added); give added + deleted and the
   net, against the size in the table above.
6. The byte proofs of your items (book §5), each run on the final commit's result copy.

## Reply (plain Chinese): `./.dsh-ref/s85-reply-S2.md`

Book §7, in this order: questions (if any); the summary (under 300 words); the per-step table; the interface table
of every new module (path, export, signature, where it came from, who uses it) — this table is what the next night's
run codes against, so make it exact; the byte proofs with their probe tables (book §5.0 rule 6) and the probe paths;
the test files run, with pass/fail counts and failing test names (environment failures separately, with the error
text); the checks of step 4; the changed lines; suspected errors in the book, the inventories or this sheet; and a
**HANDOFF** section only if you stop before the end (done steps, half-done files, steps not started, the shortest
path to finish).
