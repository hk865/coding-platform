# Structure round, run S4: D3b (lead, 2026-10-21)

You are run **S4**. Do **D3b** only: book §5.1, the parts for S4 (rulings 1–11, "S4 = D3b", "Byte proof, S4"). Runs
S1 (D2), S2 (C2, C1, A6, B1) and S3 (D3a) are done, merged by the lead, audited by Codex and fixed in rework 1; this
copy's base is that result. You are the only DSH run on this machine tonight.

| | |
| --- | --- |
| Item | D3b — split `context-assembler.ts` into the modules of inventory §3 and move its own texts into the pack (book §5.1; inventory `inv-d3.out.md` §1 rows 1–4, 6–8, 24–26, 28, §2 (the three main input templates and the seven adaptation rules), §3, §4) |
| Size | about 3,750–4,550 added + deleted, mostly moved code |
| Time limit | 300 min |
| Scratch | `.dsh-scratch/S4` in this copy |
| Commit | paths `src resources runtime-assets.json`, message `S85 S4: D3b context assembler split` |
| Tests | `./.dsh-ref/s85-tests.txt`: the test files that import `context-assembler.ts`, `note-read-model.ts` or `execution-preparation.ts` themselves, plus the proof tests of "Byte proof, S4" (24 files). The lead runs the rest with the full suite |

**Whitelist** (`./.dsh-ref/s85-whitelist.txt`): `src/core/agent-runtime/context-assembler.ts`; the new modules of
inventory §3 (`context-types.ts`, `context-support.ts`, `context-rendering.ts`, `context-fact-text.ts`,
`context-review-input.ts`, `context-workspace-facts.ts`, `context-history-facts.ts`, `context-review-recipe.ts`,
`context-continuation-recipe.ts`, `context-work-recipe.ts`, `context-query-recipe.ts`, all in
`src/core/agent-runtime/`); `src/core/work-graph/notes/note-read-model.ts` (row 28, `generalWarningLabel`, only);
the pack owner's files `resources/prompts/platform/**` (adding `work-input`, `query-planning-input`,
`query-copy-input` and the assembler's strings), `src/contracts/prompts/slot-tables.ts` (**the three main input
tables only**), `runtime-assets.json` and the regenerated `src/contracts/prompts/platform-pack.generated.ts`.
`render-template.ts`, `prompt-pack.ts`, the build script and every text S3 moved are frozen: use them, never edit them.

**Order and split** (book §5.1 "How to split the work", ruling 11):
- (1) at the start, at the same time: the probes of "Byte proof, S4" on the base copy (record the renderers and fact
  formatters, the whole assembler result, `bodies.put`, the deps proxy with the clock), run twice, logs compared
  equal; and the pack owner (one subagent, the only one that ever edits the pack files above) publishes the key
  table **before** any consumer starts: the three templates with their slots, every new string key, the exact text
  of each (from the base `context-assembler.ts` and `note-read-model.ts`), and the base location.
- (2) subagents that create the new modules copy their code from the base text of `context-assembler.ts` without
  editing it (one subagent per new module or per group of modules; no two on one file), coding against the key
  table and the frozen interfaces below.
- (3) after they report: one subagent owns `context-assembler.ts`, deletes the moved code and wires the modules;
  another (or the same, after) edits `note-read-model.ts` (row 28 only). The owner writes the resources and
  generates the module once all texts are in.
- (4) the proofs on a result copy of the final commit, then your checks.

**Lessons from night 1's audit** (the frozen table `./.dsh-ref/n1-findings.md`):
- An optional slot alone on a template line leaves that line's newline when the slot is empty (P4-01): the base
  printed nothing there. Put the slot at the end of the line before it and pass the value with a leading `\n` when
  it is non-empty (S3's `slotLines` pattern in `prepared-execution.ts`), or prove the empty case byte-equal.
- Every optional slot's empty case and every list's zero case is a byte-proof input, not only what the tests reach.
- Keep each base test as it was (`x ? … : …` stays a truthiness test, not `!== undefined`; P1-01).
- Keep every probe inside this copy (`.dsh-scratch/S4/probes/`); last night's probes in `/tmp` were lost.

**Probe kits you may reuse** (recovered from last night; read their README/REPORT first; they ran on other files, so
adapt the anchors, never the rules): `./.dsh-ref/probes-S1/` (Python; the model-run captures), `./.dsh-ref/probes-S3/`
(`e1/`: record and replay of renderers, the edge-input harness and the comparer; `e2/`: the guide and the tools at
two points). S2's C2 probe after rework 1 is in `./.dsh-ref/probes-R1/` when rework 1 kept it there.

## Base

- Tag `s85-n2-base` is this run's base: HEAD when you start, the lead's merge of S1–S3 with rework 1 (lead commit
  `b35e077`, same tree). Every count and every byte proof is against `s85-n2-base`. (S1–S3 were proven against the
  older tag `s85-base`; you do not repeat that.)
- The frozen prompts spec the book names is in this copy at its `docs/` path; read only the parts the book names.

## Read first, and only this

- The book (`s85-book.md`, given to you as the task): §1–§4, §5.0, **§5.1 only** of the items, §6, §7.
- The inventory `./.dsh-ref/inv-d3.out.md`, only the parts your table above names. Hand a subagent only its part.
- The frozen interfaces (next section) and `./.dsh-ref/n1-findings.md`.
- `./.dsh-ref/coordinator-mode.md`.
- There is no `rg` here; use `grep -n`. A coordinator that reads large files fills its context in minutes: you
  coordinate, subagents read the code and do the work.

**Questions.** This run is headless and nobody answers during it. Write what you cannot understand into the first
section of your reply. Where a point blocks a step, skip that step (book §2 rule 4), say so, and go on with the rest.

## Scratch place for the byte proofs (book §5.0)

Your scratch place is **`.dsh-scratch/S4` inside this copy** (in `.git/info/exclude`: never committed; it stays after
the run so the lead and Codex can re-run the probes). It replaces the book's "outside the repository copy": the rule
that matters is that nothing of it enters a commit. Do not use `/tmp` or any path outside this copy.

```
S=.dsh-scratch/S4; mkdir -p $S/base $S/probes
git archive s85-n2-base | tar -x -C $S/base
cp -al node_modules $S/base/node_modules
cp -al vendor/coding-agent/node_modules $S/base/vendor/coding-agent/node_modules
```

A result copy is made the same way from a commit of yours, in a new directory each time (`$S/result-1`,
`$S/result-2`, …; do not delete old ones): `git archive HEAD | tar -x -C $S/result-1`, then the two `cp -al` lines.
Probes are edited into the copies only, the same edit in both (book §5.0 rule 2). Keep every probe, its run command
and its report under `$S/probes/`.

## Rules for this night

1. **Scope.** Change only the files of your whitelist (`./.dsh-ref/s85-whitelist.txt`, anchored patterns; listed
   above too). A step that needs another file is skipped and reported (book §2 rules 4–5).
2. **Memory (binding).**
   - `tsc` only as `flock .dsh-scratch/tsc.lock npm run typecheck` and `flock .dsh-scratch/tsc.lock npm run build`,
     by you, never by a subagent while another subagent runs one.
   - Tests only as **`npx vitest run --maxWorkers=2 <files>`, never more workers**, at most 10 files per command,
     each command under `timeout 900`. Put this line in every subagent's prompt. This holds in the scratch copies too.
     Never run a `*.scale.test.ts` file, `npm run test:scale`, `npm test` or a bare `npx vitest run`.
   - At most **three subagents running tests at the same time** in your run; subagents that only read or edit may
     run beside them, on files that do not overlap.
   - **Do not end your turn before every subagent has reported back** (`sleep 300`, then `list_agents`).
3. **The process sandbox.** There is no bubblewrap here: a test that fails only on `ENOENT … bwrap` (or the sandbox
   reported unavailable) is an environment failure. List it with its error text; it fails the same way in the base
   copy. The lead runs it with the sandbox.
4. **Tests are not edited** (book §2 rule 2). A failing test is your regression (undo or fix your change) or an
   environment failure (rule 3). Never `skip`, `todo`, `only`, or a raised timeout.

## Interfaces frozen by earlier runs

Code against these; never edit a file of theirs that is not in your whitelist. Each reply is in `./.dsh-ref/`.

- **S1, D2** (`s85-reply-S1.md` §3): `src/core/agent-runtime/tool-group-assembly.ts` and the rewired
  `execution-driver.ts`, Runtime `query-execution.ts`, `observed-model-run.ts`. Not yours; the assembler does not use
  them.
- **S2, C1** (`s85-reply-S2.md` §3): `notes/note-base-reader.ts` (`ReadFailureCode`, `ReadOutcome`, `readAllRecords`,
  `readAllHeads`) and `notes/note-rendering.ts` (`renderUnderstandingBody`). `note-read-model.ts` now imports them and
  re-exports `readAllRecords`, `readAllHeads`, `ReadFailureCode`; your row-28 edit leaves those imports and
  re-exports as they are. C2, A6 and B1 are not on your path.
- **S3, D3a** (`s85-reply-S3.md` §3 interfaces, §4 key table): `renderTemplate` and `SlotRangeV1`
  (`src/contracts/prompts/render-template.ts`), `TEMPLATE_SLOTS` (`slot-tables.ts`), `PromptPackManifestV1`,
  `ResolvedPromptPackV1`, `ToolTextV1` (`prompt-pack.ts`), `PLATFORM_PROMPT_PACK_V1` (the generated module) and
  `scripts/build-platform-prompts.mjs`. The renderer's rules are frozen (book §5.1 ruling 3; `sectionRanges` in
  UTF-8 bytes, one entry per slot that rendered a non-empty value). In `slot-tables.ts` you may change only the
  three tables `work-input`, `query-planning-input`, `query-copy-input`. S3's templates, strings and tool files stay
  as they are: you add keys and templates; you never rename or edit S3's keys or texts.
- **Rework 1** (`s85-reply-R1.md`, `n1-findings.md`): the renderer now checks every required slot of the template's
  table (P3-01); `mentionsTools` are generated as literal tuples (P3-03); the `unknown-call-review` template puts
  `{{items}}` at the end of its heading line (P4-01). Regenerate the module only with the build script.

## Time

The runner stops this run at 300 minutes and then asks you, in the same Session, for the reply with a HANDOFF
section. Commit what is done and green before that; do not leave a file half moved if you can avoid it (finish the
file or undo it).

## Checks before you finish (book §3)

1. `flock .dsh-scratch/tsc.lock npm run typecheck`, `npm run check:architecture`,
   `flock .dsh-scratch/tsc.lock npm run build`: all green, one at a time.
2. The tests: every file in `./.dsh-ref/s85-tests.txt` plus `tests/architecture`, in batches of at most 10 files
   under `timeout 900`. A new module is covered by the files that import its old home. The lead runs the full suite
   and the scale batch after you.
3. Commit without `.dsh-ref/` and `.dsh-scratch/`:
   `git add -A -- src resources runtime-assets.json && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "S85 S4: D3b context assembler split"`.
   A later fix is a new commit (`S85 S4: D3b context assembler split fix`); never amend or reset.
4. Scope: `git diff --name-only s85-n2-base HEAD | grep -vE -f ./.dsh-ref/s85-whitelist.txt` prints nothing;
   `git diff --name-only s85-n2-base HEAD -- tests` prints nothing; `git status --porcelain` prints nothing.
5. Size: `git diff --numstat s85-n2-base HEAD` (a new file counts all its lines as added); give added + deleted and
   the net, against the size in the table above.
6. The byte proofs of book §5.1 "Byte proof, S4", each run on the final commit's result copy.

## Reply (plain Chinese): `./.dsh-ref/s85-reply-S4.md`

Book §7, in this order: questions (if any); the summary (under 300 words); the per-step table; the interface table
of every new module (path, export, signature, where it came from, who uses it); the key table of the pack additions
(template ids and slots, string keys, base locations); the byte proofs with their probe tables (book §5.0 rule 6)
and the probe paths; the read points no test reaches, each with its base line and a side-by-side reading (book
"Byte proof, S4" item 4); the test files run, with pass/fail counts and failing test names (environment failures
separately, with the error text); the checks of step 4; the changed lines; suspected errors in the book, the
inventories or this sheet; and a **HANDOFF** section only if you stop before the end (done steps, half-done files,
steps not started, the shortest path to finish).
