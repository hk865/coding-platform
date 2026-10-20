# T round: build book, wave 2 (lead, 2026-10-20)

Read this book, your run file (`./.dsh-ref/t-run-<G>.md`) and your item list (`./.dsh-ref/t-items-<G>.md`) before you
change anything. Report anything you cannot understand before you start (decision 56).

## 1. What T is

- HANDOFF decision 79 (search `^79\. ` in `docs/refactor/HANDOFF.md`):
  - **79-1:** nothing is released, so there is no old data to protect. Code reads only the current format; readers of
    older formats, "written by earlier versions" tolerance and legacy fixtures go. No migration, and no database version
    check either.
  - **79-4:** the T round itself.
    - Tests: stale, duplicate, trivial and tamper-only tests go; handwritten-fact tests are converted to public steps,
      never deleted.
    - Production: code nothing reaches; the production-reach allowlist re-reviewed; old-data and legacy branches.
- **Where the items come from.** Two independent read-only inventories (Codex and DSH), a skeptic per finding, a judge
  where they disagreed, the lead's decisions, and the user's for the items marked `user-decides`.
- **Wave 1 is merged.** Groups TP and TQ ran first; their result, after three reworks, is this copy's base: tag
  `w2-base` (= `d4c4cea`). Your items were written against the older tree `3a9f6d94`, so lines may have moved.
- **Each item's 动作 (action) is final.** Do not re-decide it. Up to three lines below it correct it; when they differ,
  the later one wins:
  1. **书面核对改正** (Codex book check, 10-19, adopted by the lead): wins over the 动作.
  2. **第一批改过的文件** / **第一批之后已不存在的文件**: wave 1 changed or removed these files. Find the named code
     again by its content before you edit (`grep -n`), not by its line number.
  3. **刷新** (Codex check against `w2-base`, 10-20, adopted by the lead): wins over both. It gives the current
     `file:line`, or a rewritten action where wave 1 changed the code under the item.
- **Where an item still names two ways,** the correction line picks one. If no line picks one, the item is BLOCKED:
  report it; do not choose.
- **BLOCKED in advance.** Some items or sub-cases are marked BLOCKED until the lead rules on them. Leave them as they
  are; do not work around them.
- **When an item is wrong against today's code, do not improvise.** Examples: a line moved and the target is
  ambiguous; the symbol is already gone; doing it would leave a current behaviour with no test. Mark the item
  **BLOCKED** with the evidence (`path:line`, error text) and go on.

## 2. Rules (binding)

1. **Scope.**
   - Do only your group's items, and edit only the files on your run file's whitelist. No file is on two groups'
     whitelists in this wave: the lead grouped the items so that no two groups edit the same file.
   - The whitelist is the edit boundary, not the work: change only the lines, tests and helpers your items name. Do
     not extend a change to a sibling test that an item keeps.
   - **One exception.** A symbol your items delete may be imported elsewhere. You may then remove that import or usage
     in a file outside the whitelist, only as far as compiling needs. List every such file in your reply.
   - **The shared real Runtime** `tests/helpers/S2B-runtime-steps-fixture.ts` is on no whitelist: all three groups use
     it as it is. If a conversion needs something it lacks, you may add a new optional option or a new exported
     function, whose default path stays exactly as it is. Change nothing that exists; list each addition in the reply.
     The lead merges the three groups' additions.
   - An item that needs any other file outside your whitelist is BLOCKED: name the file and the change.
   - Do not edit `docs/`: the lead writes the spec post-notes. Never touch `vendor/coding-agent/dist`, `package.json`
     or the lock files.
2. **Deletions.**
   - Every deleted test, test case, assertion, helper or fixture belongs to one of your items. The item's 覆盖/依据
     (or its correction line) says what covers it, or why the behaviour no longer exists.
   - Do not delete or relax any other assertion.
   - When an item says "keep X, delete Y" inside one test, X stays exactly as it is, assertions and expected values
     included.
   - An exact assertion change, or an index move (`items[1]` → `items[0]`) after an earlier element is deleted, only
     where an item or its correction line spells it out. The compared content stays.
3. **Merges (`merge-into`).**
   - Move the named cases into the target test so the target asserts everything the source asserted, unless the item
     names a part that is dropped. Then delete the source.
   - Keep the spec-row id (`K3-31`, `SV03`, `2C-18`, …) in the target test's name when the source had one.
   - A merge that would lose an assertion the item does not drop is BLOCKED.
4. **Conversions (`convert`).** Replace the handwritten records, events or fixture state with the public step the item
   names, under the test rule sheet **v2** (`./.dsh-ref/test-rule-sheet-v2.md`, which changes v1
   `./.dsh-ref/test-rule-sheet-v1.md`). Both are deny-by-default: only the forms they list are allowed.
   - **Public input (v2 A1).** A value a route in `src/app/core-routes.ts` or a platform tool receives from outside is
     a public input, even when its type is called a draft (for example the `plans/propose` body). A helper may pass
     it to the owner that route binds, when the value meets that route's or tool's whole parameter contract; the test
     then goes on through public steps.
   - **Values the platform issues (v2 A1).** Credentials, display tokens, positions, cursors, receipts, fingerprints,
     prepared values, Kernel identities and message ids are taken from a public read after the real step, and used
     as returned. A test never builds, chooses or rebuilds them.
   - **The real Runtime.** `tests/helpers/S2B-runtime-steps-fixture.ts` (real prepare; start with a scripted model on
     a supported provider; an A3 gate that holds the model request; finish) is how a test reaches an entered,
     running or ended Run. "This fixture has no Runtime" is not a BLOCKED reason.
   - **Record-store tests (v2).** In `tests/record-store/*` and the helpers only they use, the store's ports are the
     public step, and only to check the store's own contract. Building and committing records by hand in any test of
     a module above the store is F3, which is not allowed.
   - **A7 has three named helpers,** each with its bounds (rule sheet v2 A7): the note tools adapter in
     `tests/runtime/S4C-note-tools.test.ts`; `damageKernel` in the two named scenario files; the process sandbox
     stand-in `probe` with `executeChecks: false`. Nothing else is exempt, and no old fixture is exempt.
   - **Expected values** come from the spec or a hand calculation. Write the literal, with its working (the input and
     the steps) in a comment. Never compute an expected value with a production function, a source constant or the
     program's own output (`canonicalJson`, `sha256Hex`, a codec, a constant).
   - Keep the test's assertions and expected values unless the item says otherwise.
   - **When the public step cannot reach the state, the item is BLOCKED.** Do not delete the test, and do not keep the
     handwritten state under a new name. The BLOCKED evidence names the `file:line` of the check that refuses that
     state, or of the entry point that is missing, and says which it is:
     - *tamper-only*: only rewriting an accepted record in place makes the state;
     - *unreachable*: no public step makes it, and a current check refuses it (name the check);
     - *missing entry point*: the platform has no public step for it yet.
     The lead rules on each; you do not delete a row for these reasons yourself.
   - **Format-only adaptation.** When an item makes a record field required, a handwritten seed that another item
     still keeps (or that is BLOCKED) may be brought to the current format: add exactly the fields the current codec
     requires, with the value the current writer writes; change nothing else; list it in the reply as `FORMAT`
     (`file:line`, field). This is not a conversion.
   - Whether a step is public is decided by the rule sheet, not by its name. Calling an owner's write method does not
     make hand-made facts allowed (F3). If a step an item names breaks the rule sheet, that item or sub-case is
     BLOCKED; a kept rule-breaking test is not `done`.
5. **Production changes.**
   - Behaviour on current-format data does not change; only old-format tolerance, legacy branches and unused
     declarations go.
   - Error codes, messages and check order for current inputs stay as they are.
   - When a decoder now requires a field, do not add a test that feeds it an old record (tamper-only, root
     `AGENTS.md` rule 4); the item says when a test is wanted.
   - Only the production changes your items name. If an item seems to need another one, it is BLOCKED.
6. **Production-reach allowlist** (`tests/architecture/production-reach-allowlist.json`).
   - Remove the entry of every declaration you delete.
   - Change a reason or note only where an item says so.
   - Never add an entry. If `production-reach.test.ts` asks for a new one, the item is BLOCKED.
7. **No new tests or helpers** beyond what an item names: a conversion's replacement, a merge target, a named shared
   helper. The rule sheet applies to every helper you write.
8. **Never get green by weakening.**
   - No `skip`, `todo` or `only`; no raised timeouts.
   - Never weaken an assertion to get green, and never decide on your own that something is "allowed".
   - When a check is red, fix your change or mark the item BLOCKED.
9. **Order.** Work by dependency unit.
   - The "must land together or in order" tables of the book-check answers (`./.dsh-ref/t-bk-T?.out.md`, section 3
     or 4) are binding for your items.
   - Inside one unit, the production change, its callers, fixtures, assertions and allowlist entries land together;
     then run the checks. Never leave a unit half done.
   - A merge's source, and a test whose conversion needs a shared prerequisite, are deleted only after the target and
     the prerequisite are done. Only deletions with no dependency go first.
10. **Memory (binding).** Three groups run on this machine at the same time.
    - Run the typecheck only as `flock ./.typecheck.lock npm run typecheck`, only by you, the coordinator, and never
      while a subagent of yours runs tests.
    - Subagents run only their own test files, with **`npx vitest run --maxWorkers=2 <files>`, never more workers.**
      Put this line in every subagent's prompt. Batches of at most 10 files, each under `timeout 900`.
    - **At most two subagents at once**, on files that do not overlap.
    - **Do not end your turn before every subagent has reported back.**
11. **This environment.**
    - There is no `rg`: use `grep -rn`. Use `python3 -I` for scripts.
    - There is no bubblewrap inside your sandbox. A test that fails only because the process sandbox is missing
      (`ENOENT … bwrap`, or the sandbox reported unavailable) is an environment failure: list it with its error text;
      the lead runs it with the sandbox. Never replace the real runner because of it.

## 3. Checks before you finish

1. `flock ./.typecheck.lock npm run typecheck` and `npm run check:architecture`, both green.
2. Tests, `npx vitest run --maxWorkers=2 <files>`, batches of at most 10 files under `timeout 900`:
   - every test file you changed that still exists;
   - every test file that imports a source or helper file you changed (`grep -rln`).

   A deleted test file is not run; the ledger maps it to its item and the item's cover. Paste the summary lines into
   your reply.
3. Commit in this copy, without `.dsh-ref/`:
   `git add -A -- src tests scripts resources runtime-assets.json && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "T <G> wave 2"`.
   Then run `python3 -I ./.dsh-ref/d1-ledger.py . w2-base HEAD > ./.dsh-ref/ledger-<G>.txt`.
   - Every REMOVED or LOOSENED line, and every deleted file, must map to one of your item ids. Check the file path of
     every line you map.
   - A line you cannot map is an unplanned deletion: undo it, re-run that file's tests, commit again
     (`T <G> wave 2 fix`), and run the ledger again.
4. Line count: `git diff --shortstat w2-base HEAD`.

## 4. Reply (plain Chinese), file `./.dsh-ref/t-reply-<G>.md`

1. **Per-item table:** 编号 | 结果 (`done` / `partial` / `BLOCKED` / `已由第一批完成`) | 改了哪些文件 | 覆盖 (for each
   deletion, from the item) | 备注.
2. **BLOCKED and partial parts:** the evidence for each (`path:line`, error text, what you tried, and for a
   conversion: tamper-only, unreachable or missing entry point).
3. **Files outside the whitelist:** each file you changed there, and why. **FORMAT** adaptations, if any.
4. **Checks:** commands and pass/fail counts; environment failures (rule 11); the ledger mapping as a table (文件 |
   REMOVED/LOOSENED 行 | 编号), with unmapped lines if any; the shortstat.
5. **Suspected book errors:** anything in this book or your items you think is wrong.
6. **HANDOFF**, if you stop before the end: done items; half-done files and what is missing; items not started; what
   the next Session must know.
