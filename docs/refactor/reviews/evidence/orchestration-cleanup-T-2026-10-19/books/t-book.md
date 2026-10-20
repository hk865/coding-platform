# T round: build book (lead, 2026-10-19, v2 after the Codex book check)

Read this book, your run file (`./.dsh-ref/t-run-<G>.md`) and your item list (`./.dsh-ref/t-items-<G>.md`) before you
change anything. Report anything you cannot understand before you start (decision 56).

## 1. What T is

- HANDOFF decision 79 (search `^79\. ` in `docs/refactor/HANDOFF.md`):
  - **79-1:** nothing is released, so there is no old data to protect. Code reads only the current format; readers of
    older formats, "written by earlier versions" tolerance and legacy fixtures go. No migration, and no database version
    check either (the user, 2026-10-19: we never ran an old-format product).
  - **79-4:** the T round itself.
    - Tests: stale, duplicate, trivial and tamper-only tests go; handwritten-fact tests are converted to public steps,
      never deleted.
    - Production: code nothing reaches; the production-reach allowlist re-reviewed; old-data and legacy branches.
  - Also the C1 transfers and the N0 goal input (decision 85-4; C1 rulings 3 and 8).
- **Where the items come from:**
  - Two independent read-only inventories, Codex and DSH, over every test and production area.
  - Every finding was checked by a separate skeptic against the code.
  - Where the two inventories disagreed, a judge read both and the code, and the lead applied the result.
  - The user decided the items marked `user-decides`.
- **Each item's 动作 (action) is final.** Do not re-decide it. Where an item has a **书面核对改正** line (the Codex
  book check, adopted by the lead), that line wins over the 动作 when they differ.
- **BLOCKED in advance.** Some items or sub-cases are marked BLOCKED by the book check until the lead rules on them.
  Leave them as they are; do not work around them.
  - When an item is wrong against today's code, do not improvise. Cases: a line has moved and the target is ambiguous;
    the symbol is already gone; doing it would leave a current behaviour with no test.
  - Mark the item **BLOCKED** with the evidence (`path:line`, error text) and go on.

## 2. Rules (binding)

1. **Scope.**
   - Do only your group's items, and edit only the files on your run file's whitelist.
   - The whitelist is the edit boundary, not the work: change only the lines, tests and helpers your items name. Do
     not extend a change to a sibling test that an item keeps.
   - Files the other group running now also edits are listed in your run file. In them, change only the lines your
     items name; the lead merges the two groups.
   - **One exception.** A symbol your items delete may be imported elsewhere. You may then remove that import or usage
     in a file outside the whitelist, only as far as compiling needs. List every such file in your reply.
   - Do not edit `docs/`: the lead writes the spec post-notes.
   - Never touch `vendor/coding-agent/dist`, `package.json` or the lock files.
2. **Deletions.**
   - Every deleted test, test case, assertion, helper or fixture belongs to one of your items. The item's 覆盖/依据
     says what covers it, or why the behaviour no longer exists.
   - Do not delete or relax any other assertion.
   - When an item says "keep X, delete Y" inside one test, X stays exactly as it is, assertions and expected values
     included. Only where an item says so (TP-063, TP-166), an index into a list moves after an earlier element is
     deleted (`items[1]` → `items[0]`); the compared content stays.
   - An exact assertion change that an item or its 书面核对改正 line spells out is done as written. Example: TP-156's
     `steps` 12 → 5 and `runsCounted` 3 → 2. No other kept assertion changes. Index moves stay limited to TP-063 and
     TP-166.
3. **Merges (`merge-into`).**
   - Move the named cases into the target test so the target asserts everything the source asserted, unless the item
     names a part that is dropped. Then delete the source.
   - Keep the spec-row id (`K3-31`, `SV03`, `2C-18`, …) in the target test's name when the source had one.
   - A merge that would lose an assertion the item does not drop is BLOCKED.
4. **Conversions (`convert`).**
   - Replace the handwritten records, events or fixture state with the public step the item names.
   - Follow the test rule sheet v1 (`./.dsh-ref/test-rule-sheet-v1.md`). It is deny-by-default: only the forms it lists
     are allowed.
   - Keep the test's assertions and expected values unless the item says otherwise. Expected values come from the spec
     or a hand calculation, never from a source constant or the program's own output.
   - When the public step cannot reach the state, the item is BLOCKED. Do not delete the test, and do not keep the
     handwritten state under a new name.
   - Whether a step is public is decided by the rule sheet's allowed forms, not by its name. Calling an owner's write
     method does not make hand-made facts allowed (rule sheet F3).
   - If a step an item names breaks the rule sheet, that item or sub-case is BLOCKED. `keep-note` is not an exception,
     and a kept rule-breaking test is not `done`.
   - The rule sheet's list of lead-named helpers is empty in this round: there are no exemptions.
5. **Production changes.**
   - Behaviour on current-format data does not change; only old-format tolerance, legacy branches and unused
     declarations go.
   - Error codes, messages and check order for current inputs stay as they are.
   - When a decoder now requires a field, do not add a test that feeds it an old record. That would be tamper-only
     (root `AGENTS.md` rule 4); the item says when a test is wanted.
6. **Production-reach allowlist** (`tests/architecture/production-reach-allowlist.json`).
   - Remove the entry of every declaration you delete.
   - Change a reason or note only where an item says so.
   - Never add an entry. If `production-reach.test.ts` asks for a new one, the item is BLOCKED.
7. **No new tests or helpers** beyond what an item names: a conversion's replacement, a merge target, a named shared
   helper. The test rule sheet applies to every helper you write.
8. **Never get green by weakening.**
   - No `skip`, `todo` or `only`; no raised timeouts.
   - Never weaken an assertion to get green, and never decide on your own that something is "allowed".
   - When a check is red, fix your change or mark the item BLOCKED.
9. **Order.** Work by dependency combination. The "must land together or in order" tables of the book-check answers
   (`./.dsh-ref/t-bk-*.out.md`, section 3 or 4) are binding. Inside one combination, the production change, its
   callers, fixtures, assertions and allowlist entries land together, and then you run the checks. Never leave a
   combination half done. Only items with no dependency follow the run file's default order.
10. **Memory (binding; the 2026-10-19 OOM).**
   - The typecheck has one slot for the whole machine, shared with the other group: always run it as
     `flock /home/han001/dsh-work/t-typecheck.lock npm run typecheck`.
   - Only you, the coordinator, run the typecheck: never two at once, and not while a subagent runs tests.
   - Subagents run only their own dependent test files, with `npx vitest run --maxWorkers=2`.
   - At most three subagents at once.
   - Do not end your turn before every subagent has reported back.

## 3. Checks before you finish

1. `flock /home/han001/dsh-work/t-typecheck.lock npm run typecheck` and `npm run check:architecture`, both green.
2. Tests, `npx vitest run --maxWorkers=2 <files>`:
   - every test file you changed that still exists;
   - every test file that imports a source or helper file you changed (find them with `rg`).

   A deleted test file is not run; the ledger maps it to its item and the item's cover.

   Paste the summary lines into your reply.
3. Commit in this copy, without `.dsh-ref/`:
   `git add -A -- src tests scripts resources runtime-assets.json && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "T <G>"`.
   Then run
   `python3 -I ./.dsh-ref/d1-ledger.py . t-base HEAD > ./.dsh-ref/ledger-<G>.txt`.
   - Every REMOVED or LOOSENED line, and every deleted file, must map to one of your item ids.
   - List the lines you cannot map. There should be none: each one is an unplanned deletion, so undo it and commit
     again.
4. Line count: `git diff --shortstat t-base HEAD`.

## 4. Reply (plain Chinese), file `./.dsh-ref/t-reply-<G>.md`

1. **Per-item table:** 编号 | 结果 (`done` / `partial` / `BLOCKED`) | 改了哪些文件 | 覆盖 (for each deletion, from the
   item) | 备注.
2. **BLOCKED items:** the evidence for each (`path:line`, error text, what you tried).
3. **Files outside the whitelist:** each file you changed there, and why.
4. **Checks:** commands and pass/fail counts; the ledger mapping, with unmapped lines if any; line counts.
5. **Suspected book errors:** anything in this book or your items you think is wrong.
