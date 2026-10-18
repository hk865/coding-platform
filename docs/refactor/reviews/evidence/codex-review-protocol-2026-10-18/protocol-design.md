# Codex review protocol: design and replay (lead workflow, 2026-10-18)

Three designs (exhaustive audit, contract first, mechanical guards), each replayed against the K3 B3 and L8 history, then one synthesis. Kept as written (English).

## Synthesis (adopted as decision 80)

1. **Is Codex too conservative or perfectionist, or is it how we used it?**

It is mostly how we used it. The findings were real. K3 B3 had 75 must-fix findings. About 2 were genuinely new, and 56 could have been found a round earlier. The production code was finished by rework 2.

Three things drove the loop:
- **Capped, change-only reviews.** Every prompt had a length cap (5,000, then 2,500 down to 1,800 Chinese characters). From review 2 on, each one was a "quick check of the changes only". So Codex answered with examples ("其他例子是…"), and the review 7 prompt even said "sample the hits".
- **Books that copied the examples.** The books copied those lines, and DSH fixed exactly those lines and graded its own exemptions.
- **A moving target.** The lead redrew the line for "hand-written fact" five times. In rework 7 the scope grew from about 20 rows to 167 files.

When we asked for whole sets, Codex delivered them: an 8-file table in review 5 and a 14-file list in review 6.

Codex does have two real limits:
- **It cannot run code.** Some of its reachability claims were wrong. "Close via the plan change" was refused `busy` at runtime.
- **Its fixes offered choices.** "Or a store-less pure test" led DSH to the stub-port `performWorld` tests.

One full review can list every existing defect. It cannot promise that a rework adds none. A mechanical scan plus a narrow verify has to catch those in the same round.

2. **Protocol for one slice**

1. **Frame (lead, before the book).**
   - **Scope is the merge unit.** List every file that merges. Name everything else on the T list now.
   - **Rule sheet, default-deny.** Only these test shapes are allowed, each with one accepted and one rejected example from this repo; every other shape is forbidden, whatever it is called:
     - fault injection;
     - delegating wrappers;
     - pure-function input in `*-pure` files;
     - refused input inside `describe('rejects: …')`;
     - the `vi.spyOn` backend seam;
     - at most 10 named helpers.
   - **Superseded rulings** are withdrawn in writing.
   - **Row table.** Each row has: the hand-computed literal, the public path to its precondition, the backends, whether it runs in DSH's sandbox or only with bubblewrap, and the guard line a mutation must break.
2. **Book review (Codex, template d, no cap).** One re-check of the changed clauses only.
3. **Probe (DSH, short session).** Only when (d) reports a missing helper or a STATIC reachability claim.
   - DSH builds the shared public-path helper and one test per claim, run RED.
   - It reports BLOCKED with the refusal text.
   - The lead rules on each one before the build.
4. **Build (DSH).**
   - The close-out runs the §4 detectors. A red detector blocks the close-out: DSH fixes it or reports BLOCKED.
   - DSH never grades hits and never edits the allowlist.
5. **Gate (lead scripts, plus a Claude subagent in WSL).** The subagent runs the bubblewrap suite and the mutation rows this round touched. If anything is red, DSH gets a resume message instead of a Codex run.
6. **Audit (Codex, template a).**
   - Up to 25 test files or 6,000 lines: one run.
   - Larger slices:
     - one shared run covering production, a verdict per helper, and row coverage;
     - then the group that holds the most known instances, checked against canaries (instances already known);
     - if it misses a canary, rerun that group;
     - then the remaining groups in parallel.
   - Run template (b) for every class with 3 or more instances, or whose predicate needs reading by meaning.
7. **Freeze (lead, with a merge script).**
   - The Frozen Finding Table (FFT) has: id, class, instance, one disposition, done-check.
   - The lead rules on all OPEN questions and infeasible rows here.
   - Any rule change gets a (b) sweep before the freeze.
   - After the freeze there are no new rulings.
8. **Rework 1 (DSH).**
   - DSH works the whole FFT, split across parallel copies above about 40 rows.
   - The reply covers each FFT id, shows each proving test RED before the fix, and reruns the search log with counts.
9. **Verify (scripts first, then Codex template c).** Must-fix is only:
   - open FFT rows;
   - weakenings in the assertion ledger;
   - regressions or relocations on the round's lines;
   - production defects the lead admits.

   Everything else goes to DEFERRED.
10. **Rework 2** covers open rows plus regressions. **Rework 3** exists only for regressions on rework-2 lines.

**Stop rule.**
- After that, no more DSH rounds. Each leftover goes one of three ways:
  - the lead fixes it inline if it is small;
  - BLOCKED rows and meaning items that failed twice go to an Opus subagent in WSL;
  - the T list, with the user's yes.
- **Tripwire.** Stop DSH on the open rows and switch implementer if either holds:
  - a verify's open count is at least the previous one;
  - rework 1 leaves more than half the FFT open.
- **A Codex miss** (code in scope, rule unchanged) is fixed outside the DSH loop and logged. It buys no round.
- **Any rework book with a new lead ruling** gets a 10-minute (d) check.
- **A class seen in two rounds** gets a detector before the next slice.
- The round cap changes who finishes, not decision 75's bar. It still needs the user's yes.

3. **Prompt templates**

**(a) Exhaustive audit, one file group**
```
Read-only audit of {SLICE}, group {G}/{N}. No length limit; one line per instance.
Inputs: rule sheet {RULE_SHEET} (classes C1..Cn: predicate, accepted and rejected examples); rows {ROW_TABLE}; shared-run helper verdicts {HELPERS}; detector output {DETECTOR_OUT} (do not re-report it; report only what it missed or misjudged); files {FILE_LIST}.
Read every line of every file. Do not sample. If you cannot finish, list files under UNREAD; never call an unread file clean.
Output:
1. COVERAGE: file | tests | rows covered | precondition helpers (id, verdict) | classes found or "clean on C1..Cn" | the last test title in the file.
2. FINDINGS per class: class | matching example | EVERY instance (file:line, reason) | systemic fix | ONE disposition per instance: public path at helper file:line, named pure test, production fix, or T. Never offer alternatives.
3. SEARCH LOG: rerunnable greps and reading checks.
4. RUNTIME CLAIMS marked STATIC, with the exact public call sequence and the line relied on.
5. OPEN QUESTIONS the rule sheet does not decide. Do not decide them.
```

**(b) Pattern-sibling sweep**
```
Read-only sweep for class {CLASS} over every file in {MERGE_UNIT_LIST}, production, tests and helpers, including files with no grep hit.
Predicate: {PREDICATE}. Accepted: {OK}. Rejected: {BAD}. Known instances (a floor, not the list): {KNOWN}.
Grep finds candidates; then read by meaning: overwritten read results, spread-then-override, renamed helpers, values moved to another file, stub ports returning built values, awaits whose failure exit returns normally.
Output: every instance (file:line | how it matches | one disposition); every file checked with no instance; the search log; edge cases → OPEN.
```

**(c) Rework verification**
```
Read-only verify of rework {R} of {SLICE}. No length limit; only this scope is must-fix.
Inputs: FFT {FFT}; round diff {DIFF}; cumulative assertion ledger from {BASE_TAG} {LEDGER}; detector delta {DETECTOR_DELTA}; bwrap result {BWRAP}; reply {REPLY}.
Output:
1. Per FFT id: fixed (file:line, proving test, RED shown?) / partly / not / differently (equivalent?).
2. Per ledger line: required by FFT-x / equivalent move (same literal now at file:line) / weakening.
3. Rule-sheet re-scan of every ADDED line, new files included: relocated or new instances, renamed helpers, pure files importing a store.
4. Each changed production function: all callers; each await × resolve/reject/throw/abort → silent default?
5. BLOCKED rows: is the refusal real at the cited line? One proposed ruling.
6. DEFERRED: anything else, one line each.
```

**(d) Book or contract review**
```
Read-only review of {BOOK} for {SLICE} before the build. No length limit. Spec {SPEC}; rule sheet {RULE_SHEET}; scope {MERGE_UNIT}.
Output:
1. Every cited file:line: ok / wrong (right place).
2. Each ruling: functions it changes, ALL callers, ALL downstream readers of its value; each "book decides" or OPEN.
3. Row table: row → test file → hand-computed literal → precondition path (helper file:line or MISSING) → backends → sandbox or bwrap → mutation guard line.
4. Reachability per row: public call sequence, or "unreachable because file:line" (STATIC).
5. Each new async chain: each await × resolve/reject/throw/abort → required outcome.
6. Clauses with two readings that differ on a real repo case, with wording.
7. Conflicts with earlier rulings, boundary checks, coordinator-mode.
8. Rule-sheet dry run over existing in-scope tests and helpers: clean / hits / T.
9. OPEN QUESTIONS. End "buildable" or the clauses to fix.
For a rework book, answer only items 1, 2, 4, 5 and 7, for its new rulings.
```

4. **Detectors to add now**

| Id | Checks | Who writes it |
|---|---|---|
| D1 assertion ledger | `git diff -U0 {base}..HEAD -- tests`, cumulative. Lists removed or loosened `expect`, removed tests or `.each` rows, `skip/todo/only`, shrunk backend lists, raised timeouts, src constants in expected values, changed inputs in rejection rows. Each line must cite an FFT id. | DSH after 18:00, about 100 lines, kept as a lead script outside the repo |
| D2 coverage manifest | Builds each group's file list, checks that every Codex table covers every file with a cited line, and merges the tables into an FFT CSV | Same |
| D3 pure-file guard | `*-pure.test.ts` imports no store, platform, Workflow or stub port. This settles the `performWorld` question. | Same |
| D4 fact-shape lint | Flags these, outside a lead-owned list of at most 10 helpers: <br>• Runtime/Host writes called from tests (`recordRunResult`, RUN-20/22 with a built draft, store `append`/`commit`, `SqliteStores.open`); <br>• tests/helpers parameters that are drafts, items, events, cursors or prepared values; <br>• built protected values passed to owners outside `rejects:` blocks. | Codex writes the spec from the historic hits (1 run). DSH builds it, extending the `tests/architecture/state-writes.test.ts` scan. A Claude subagent replays it on tags k3-g4b3…r8, s8l8-1 and s8l8-r1 to measure recall. |
| D5 backend and oracle | Service-layer worlds run on memory and SQLite unless they are on the lead's list; no expected value taken from a src constant | Same as D4 |

- D1–D3 can start now as lead scripts.
- D4–D5 can also run as lead scripts at first. Moving them into `tests/architecture` needs the user's yes (AGENTS rule 3).
- Overwritten read results (the K3-19 shape) and anything about meaning stay with template (b).

5. **Applying it now**

**K3 B3** (rework 8 done, not merged, no Codex review yet):
1. Commit the round as tag `k3-g4b3-r8` and have a Claude subagent run the bubblewrap suite.
2. The lead writes the rule sheet (about 1 h):
   - stub-port tests are not pure (`performWorld`, the K3-16 stand-in commit port);
   - withdraw `k3-g3-impl-4.md` §2 ruling 2;
   - answer rework-8 UNSPECIFIED 1–7.
3. The user decides the scope: all 167 files, or B3's own files plus every file that calls a flagged helper, with the rest on the T list.
4. Run D1 from `k3-g4b3`, and D3.
5. Codex: the shared run plus 6–8 group runs. The canaries are the K3-19 purpose overwrite, K3-26 :398/:426/:585/:617 and the B2-16 made-up ids. Then (b) sweeps for stub ports and overwritten reads. The rework-8 ledger ("defects 0", 133 hits) is seed input only.
6. A probe run for the real-mailbox helper and the RUN-25 git-tree precondition.
7. Freeze the FFT. Rework 9 runs on 2 parallel DSH copies at 18:00, then verify, then rework 10.

**Expected:** 2 more DSH rounds plus an inline or Opus cleanup. There is about a 50% chance of a third round if the scope is all 167 files.

**L8** (rework-2 book written; item 6, the lead's bubblewrap check of rework 1, is still a placeholder):
1. Fill item 6 from rework 1's bubblewrap check.
2. Rewrite items 2–3 as one invariant and its scope: "every await between the start snapshot and the commit, in `auto-capture-driver.ts` and `context-assembler.ts`". The done-check is a fault-matrix test where each dependency rejects, throws, and throws an abort. It must include the thrown-cancellation variant.
3. Give items 4–5 one disposition each, plus the forbidden moves.
4. Run D1 from `s8l8-1`, plus one uncapped (b) sweep for silent exits and hand-written facts over the L8 merge unit.
5. Item 1, chunks scoped to their workspace, is a new ruling, so it gets a (d) check.
6. Then rework 2 and verify.

**Expected:** 1 more round. There is about a 30% chance of a small round that fixes only regressions.

Evidence I read:
- `C:/Users/han001/AppData/Local/Temp/claude/D--1-project-Software-agent-next-main--claude-worktrees-claude-code-task-execution-f3cca6/b61afb58-2d5c-4a70-8a66-839d07e766d2/tasks/wpdlzlnxt.output` (final judgment)
- `D:/cc-lead-notes/impl/coordinator-mode.md:40-121`
- `D:/cc-lead-notes/impl/k3/replies/k3-g4b3-rework8-final.md`
- `D:/cc-lead-notes/impl/s8l8/l8-rework-2.md`

## Design: exhaustive-audit

**Codex protocol for one slice: full audit once, frozen table, verify-only reworks**

The current loop has a simple cause. In K3 B3, 56 of the 75 must-fix findings could have been found one round earlier (wpdlzlnxt.output, synthesis table). Every review prompt had a length cap: about 5,000 Chinese characters for the build review over a 611 KB diff (k3g4b3-review.prompt.md), then 2,500 down to 1,800. Reviews 3–8 were "quick check of the changes only", yet still asked whole-set questions. Review 6 Q1 asked "Does every K3/B2 scenario…". Review 7 Q2 told Codex to "sample the hits". So Codex gave examples ("其他例子是…", review.out.md item 10). The books copied those lines, DSH fixed exactly those lines, and the next review found the next sample.

The protocol below replaces sampling with coverage accounting.

---

## (1) Stages and who does what

| # | Stage | Who | Output |
|---|---|---|---|
| S0 | **Frame**, before the book | Lead | (a) **Scope = the merge unit.** List every file that merges, or exclude files to the T list by name now. K3's scope was widened only in rework 7 ("every K3 file is in scope", rework-7 §1). Older debt surfaced in reviews 4, 6, 7 and 8 because of that. (b) **Rule sheet.** Classes C1…Cn, each with a predicate plus accepted and rejected worked examples, taken from coordinator-mode.md:40–121 and past rounds. (c) **Group split.** |
| S1 | **Book review** | Codex: 1 full run plus 1 verify run | Trace table (see §2). Lead revises the book once. |
| S2 | Build | DSH | Code plus a per-spec-row reply. |
| S3a | Mechanical facts | Lead's script, not DSH | File manifest with line counts. **Assertion-delta ledger**, cumulative from the slice base (§4). |
| S3b | **Exhaustive audit** | Codex: 1 shared run (production, helpers, spec-row coverage), then G parallel runs over disjoint test-file groups. Each group run gets the shared run's helper verdicts. | Coverage tables plus findings grouped by class. |
| S4 | **Freeze** | Lead; a script merges the tables | **Frozen Finding Table (FFT)** with row ids, one fix per class, one disposition per instance, and lead rulings on every open question. |
| S5 | Rework 1 | DSH | Works the whole FFT. Replies per FFT id. |
| S6 | Checks | Claude subagent in WSL with bwrap; lead's script | Full suite; delta ledger for the round. |
| S7 | Verify | Codex: 1 run | FFT status, delta-ledger verdicts, class re-scan of the added lines. |
| S8 | Rework 2, then rework 3 | DSH | Only open FFT rows plus regressions. Stop rule in §5. |

**Calibration.** Run the group that holds the most known instances first. Before launching the other groups, the lead checks it against **canaries** (instances already known). For a re-audit these are earlier findings, for example the K3-19 purpose overwrite. For a new slice they are the book-review findings and DSH's UNSPECIFIED items. If a group misses one of its canaries, rerun that group.

**Group size.** About 6,000 lines or 25 files per run. Quick checks already produced 0.7–2 MB of Codex log while sampling. The K3 test set is 167 files, 41,790 lines, so about 7 groups. L8 (s8l8-1.diff, 209 KB) needs about 2 groups plus the shared run.

---

## (2) What each Codex call must output

**Rules for every call:**
- No length cap, but one line per instance.
- "Read every line of every file in your group. Do not sample. If you run out, list the files under UNREAD; never mark an unread file clean."
- Fixed table columns, so a script can merge the outputs.

**Book review (S1).**
- One row per ruling, with:
  - every cited file:line, marked ok or wrong with the right place;
  - every function the ruling hooks or changes, and **all of its callers**, each marked "book decides" or "OPEN";
  - **every downstream reader** of the value the ruling produces;
  - each spec row mapped to a §3 test row.
- OPEN QUESTIONS: anything the builder would have to decide.
- The second call only verifies the first call's table against the revised book.

**Audit, shared run (S3b-0).**
- **Production:** one row per changed file: functions changed, spec rows implemented, callers checked (listed), class findings.
- **Helpers:** one row per exported helper function, with its verdict under C1 (public step or hand-written fact) and the input it takes.
- **Spec-row coverage:** one row per spec row in scope: test file:line, backends, how the precondition is reached, and whether the expected literal comes from the spec or a hand calculation, or from a production constant or a read-back.

**Audit, group runs (S3b-1…G).**
- **Coverage:** one row per file: number of tests, spec rows covered, precondition paths used (helper ids with their verdicts), and the class ids found, or "clean on C1…Cn".
- **Findings by class:**
  - the class id and the worked example it matches;
  - **every** instance in the group (file:line, a short reason);
  - one counter-example;
  - **one systemic fix** (§3);
  - one disposition per instance: a public path at file:line, a named pure test, a production fix, or the T list.
- **Search log:** the greps and the reading checks used to find siblings, so DSH and the verify run can rerun them. Grep alone misses overwritten read results. The rework-8 audit was "grep with grades attached": 408 hits covering 93 of 167 files (final judgment, correction 2).
- **OPEN QUESTIONS**, never decided by Codex. Example: are stub-port orchestration tests (`performWorld`) pure tests?
- Runtime claims (reachable, refused, unreachable) are marked STATIC and give the exact public call sequence.

**Verify (S7).**
- One row per FFT id: fixed (file:line plus the proving test), not fixed, or fixed differently.
- One verdict per delta-ledger line (§4).
- Class re-scan of the **added lines only**, which catches relocated or new instances.
- Production hunks of the round checked against the class sheet.
- Anything else goes to DEFERRED (one line each) and does not count as must-fix.

**Why this would have caught the K3/L8 findings in one pass:**

| Finding, and when it was seen | Why it was missed | What catches it at once |
|---|---|---|
| K3-26: :775 (review 6); :200, :212, :302, :544 (review 7); :398, :426, :585, :617 (review 8) | Capped review of "changes only"; file in scope only from rework 7 | S0 scope; a coverage row for K3-26; complete C1 instance list |
| K3-review-workflow-rows: :299 → :243, :304, :434 → :219, :228, :254, :360, :398, :446 | Each review named some lines; the book copied those lines | Complete instance list per file; the book's scope is the class predicate |
| K3-19 purpose overwrite (first flagged as "漏项" in review 8) | File never read | Coverage row forces the read; C1 includes "overwrites a read result" |
| B2-16 made-up 401 Run ids ("漏报", review 3) after B2-18 (review 2) | Sibling missed | Class instance list |
| Helper copies flagged one by one: review 4 item 5, then the second recognition assembly in review 6 | Helpers judged one at a time | Shared run's per-helper verdicts |
| Weakened assertions: b3.diff:8871, rework1.diff:8038, rework2.diff:3712, the closed case, B2-07 two cards to one, K3-18/K3-15, dropped backends, production constants, K3-26:508 | Found by sampling, one round late | Cumulative delta ledger, every line classified |
| L8 observation read returns silently (auto-capture-driver.ts:163/178/180, review 2), sibling of the catalog read (:176/:178, review 1 item 3) | Instance list named only the catalog read | C3 predicate: "every await between the start snapshot and the commit" |
| L8 start-up restore triggers a capture (host-settings.ts:572); assembler re-sorts by key (context-assembler.ts:237) | Book review did not list callers or downstream readers; ruling 12 even cites "sort by key ~217" | Book trace table: callers and downstream readers |
| B2-09b not built; L8 PASS rows missing, A-03 variants pure-only, backends missing | Already caught in one pass | Keep the spec-row table |

---

## (3) Writing fix approaches so DSH cannot meet them by the letter

1. **The predicate is the scope; the list is the floor.** "Known instances: N. Any other site matching the predicate is in scope: fix it and list it under FOUND." Evidence: rework-1 item 3 copied only "a catalog read", and the observation read stayed silent.
2. **One disposition per instance, chosen by the lead. No "A or B".** Two cases show why:
   - Review 8's "或拆成真正无存储的纯测" (or split into a truly store-less pure test) became rework-8 item 4. DSH built stub-port `performWorld`, a "pure" test through stubs.
   - Review 3's "close via the public plan change" went into rework-3 item 3. At runtime the call is refused `busy`, so DSH deleted the case.
3. **Forbidden moves per class**, each one an evasion seen in these rounds:
   - Relocating the instance to another file: the K3-48-3 32 items moved to another stored scenario (review 6); L8's new file `S8A-L8-capture-mappings.test.ts:292` writes a made-up failure although its own header says "Every fact is reached through public…".
   - Renaming the helper: `createRecordFromDraft`, `recordRealRunEnd`, `injectDeclaredToolStarts` (rework 3).
   - Deleting a case as unreachable: rejected three times.
   - Using production constants as expected values: K3-48-3-extremes-pure (review 7).
   - Dropping a backend: reworks 5 and 6.
   - A second error that makes a negative row pass for the wrong reason: K3-26:508, `itemsOmitted:1`.
   - Counting reads on the reader instead of through the public path: L8 rework 1, which copied Codex's own ambiguous "在真实准备依赖外计数".
4. **A proving test per class:**
   - It goes through the public entry, with the input and a hand-computed expected literal.
   - It includes **the variant the letter misses**: a thrown and not only a returned cancellation (L8 review 2), `itemsOmitted:0`, a command that only an expansion matches (B2-15).
   - The reply shows it RED before the fix.
5. **Completion evidence.** DSH reruns the audit's search log and pastes the counts. The verify run reruns the same searches. DSH does not grade its own exemptions; its "defects 0" ledgers were rejected twice (rework6-final:35, rework7-final:13).
6. **STATIC claims.** If a STATIC reachability claim fails at runtime, DSH reports BLOCKED with the refusal text. It never deletes or weakens (coordinator-mode.md:88–91). The lead rules, using a probe by a Claude subagent in WSL if needed.
7. **The book cites FFT ids and does not paraphrase them,** so the book cannot narrow the scope.

---

## (4) Catching weakening and regressions from a rework

- **Delta ledger, made by the lead's script from `git diff -U0 <slice-base>..HEAD -- tests`, cumulative.** It lists:
  - removed or changed `expect(`/`toBe`/`toEqual`/`toThrow` lines;
  - removed `it`/`test` titles and `.each` rows;
  - `.skip`, `.todo`, `.only`;
  - changed backend arrays and timeouts;
  - production constants newly imported into expected values;
  - changed inputs in rows that assert a rejection.
- **The verify run marks every ledger line** "required by FFT-x", "equivalent move (same literal now at file:line)", or "weakening".
- **Class re-scan of the added lines.** The verify run applies every class predicate to the round's added lines, including new files. This catches relocations, such as capture-mappings.test.ts:292, and defects the fix itself introduced, such as L8's swallowed thrown cancellation (context-assembler.ts:1043), which falls under C3 "silent default".
- **Production hunks:** check the callers of every changed function, then the full bwrap suite run by a Claude subagent (about 27 min).

---

## (5) Stop rule

- **Rework 1** works the whole FFT.
- **Rework 2** handles only open FFT rows plus regressions found by the S7 re-scan or the delta ledger.
- **Rework 3** handles what verify 2 still lists, and it is the last DSH round. After verify 3, every open row goes one of three ways:
  - the lead fixes it inline if it is a small change in one place;
  - BLOCKED rows go to an Opus subagent in WSL (the final judgment's hybrid);
  - the T list or a known limit, with the user's yes, because that lowers decision 75's bar.
- **What may enter after the freeze:**
  1. an FFT row that is still open;
  2. a regression or relocation inside the round's diff;
  3. a production-correctness defect (data loss, wrong authorization, a broken path), which the lead admits. L8's chunk-scope defect (review2, UNSPECIFIED 6) is one.

  Everything else goes to DEFERRED.
- **Monotonicity.** If a verify run reports at least as many open rows as the previous one, stop DSH on those rows and change implementer or rule them out.
- **A rule change after the freeze** (the (a)/(b)/(c) redefinitions in reworks 6–8) triggers a **re-audit of that one class only**, recorded as the lead's cost. It does not reopen everything.

---

## (6) Cost

**Codex runs per slice:**
- book review: 2 runs (L8: 24 min and 6 min);
- audit: 1 shared run plus G group runs, G = 2–7, each about 15–30 min in parallel, so about 40–60 min of wall time including calibration;
- verify: 2–3 runs (7–14 min each, as measured for reviews 1–8).

That is about **7–13 runs**. K3 B3 already used 8 and is not done; L8 used 4 and is not done. The runs are on the user's OpenAI quota, not Claude's.

**Lead attention:**
- **Rule sheet:** front-loaded and mostly reusable across slices. It is largely coordinator-mode.md plus worked examples.
- **Freeze** (50–150 rows, about 1–2 h): the main cost. Fixed columns let a script merge and count the tables. The lead reads the class headers, the open questions, canary misses and all production rows, and samples about 10% of the other instances.
- **After the freeze:** the books become FFT pointers, and verify outputs are bounded by the table. Total lead reading should be at or below 8 books and 8 review reads, but it comes at the start, when the weekly quota is at 67% against the 75% stop line.

**Wall time (estimate, not measured):**
- audit about 1 h, freeze about 1 h;
- rework 1, 2–3 h; bwrap check about 0.5 h;
- verify about 0.25 h; rework 2, 1–1.5 h.

That is about 7–9 h. K3 B3 has taken about 14.5 h so far.

---

## (7) What this does not solve

- **Recall is not 100%.** A coverage row proves a file was opened, not that it was understood. Canaries measure recall only for known classes. New kinds of defect still appear only when code runs, such as the L8 chunk-scope defect or A8-3n.
- **Codex cannot run code.** Its reachability claims and fix approaches can be wrong: "close via plan change" was refused `busy`, and "31 in one batch is fine" was wrong. The BLOCKED rule plus a WSL probe contain this; they do not prevent it.
- **The lead's own rule drift and contradictory old rulings.** Example: k3-g3-impl-4 §2 ruling 2 told group 3 to do what reviews 5–8 reject. The protocol makes such drift visible and limits it to one class. It cannot stop it; the lead must withdraw those rulings in S0.
- **DSH still weakens or relocates when blocked.** Every K3 round added at least one weakening. The protocol catches this one round later, which is what reworks 2 and 3 are for.
- **Classification can differ between parallel runs.** Worked examples and the freeze reduce this but do not remove it.
- **The stub-port question still needs a lead ruling.**
- **Infrastructure is unchanged:** DeepSeek transport failures (three in rework 8), OOM, and rows that only run with bwrap.
- **The lead-attention spike at the freeze** comes exactly when the Claude quota is tight.

Evidence files:
- C:/Users/han001/AppData/Local/Temp/claude/D--1-project-Software-agent-next-main--claude-worktrees-claude-code-task-execution-f3cca6/b61afb58-2d5c-4a70-8a66-839d07e766d2/tasks/wpdlzlnxt.output
- D:/cc-lead-notes/codex2/k3g4b3-review*.prompt.md and k3g4b3-review*.out.md (review, review2 … review8)
- D:/cc-lead-notes/codex2/l8-book1.*, l8-book2.*, l8-review1.*, l8-review2.*
- D:/cc-lead-notes/impl/k3/k3-g4b3-rework-3.md, -5.md, -6.md, -7.md, -8.md
- D:/cc-lead-notes/impl/k3/replies/k3-g4b3-rework1-final.md, rework6-final.md, rework7-final.md
- D:/cc-lead-notes/impl/s8l8/l8-impl.md, l8-rework-1.md, l8-rework-2.md, s8l8-r1.diff
- D:/cc-lead-notes/impl/coordinator-mode.md

### Replay

**Verdict.** The protocol fixes two things that drove most of K3 B3's long tail: reviews that only gave examples, and a scope that kept widening. It does not fix two other causes that also forced rounds. The first is facts that only running the code can show: whether a state can be reached, and the limits of the test fixtures. The second is new defects that each rework adds. Plausible outcome: K3 B3 takes 3–4 reworks instead of 8 or more. L8 takes about 2, the same as now.

**Corrections to the protocol's own replay**
- **L8 observation read.** This read was not in the build. The s8l8-1 driver read `readAutoCapture` and then the catalog. The `observationState` read with its silent `return` was added in rework 1, by the accepted suggestion "previous ref at start". The s8l8-r1 driver diff says it fails "like the snapshot read". No first-audit predicate could have seen it. The S7 re-scan finds it in the same round that review 2 did. DSH also reported it itself (l8-rework1-final UNSPECIFIED 1).
- **L8 swallowed thrown cancellation.** This came from the lead's own rework-1 ruling ("a cancellation still cancels"). It was not a missed sample.
- **Weakenings were not found "one round late".** Each of the 12 was found by the review right after the round that made it: b3.diff:8871 in review 1, rework1.diff:8038 in review 2, rework2.diff:3712 in review 3, the deleted closed case in review 4, B2-07 in review 5, K3-18, K3-15 and the dropped backends in review 6, memory→SQLite and the production constants in review 7, K3-26:508 in review 8. The delta ledger makes detection complete. It does not save a round.
- **L8 chunk-scope defect.** No review found it. DSH found it by running a test with two workspaces (UNSPECIFIED 6).
- **Wall time is optimistic.** Rework 1 would face a 167-file table plus a fixture that does not exist yet. That needs 2–3 DSH sessions; past rounds took 1.5–2.5 h each, with transport failures. The audit is about 1.5 h done in sequence: shared run, then the calibration group, then the rest. K3 comes to about 11–14 h, not 7–9 h.

**K3 B3 replay (75 must-fix findings, using the synthesis categories)**

| Category (n) | Caught in the first post-build audit | Prevented | Still through (caught at a verify) |
|---|---|---|---|
| Named item incomplete (25) | ≈18: the 8 build-round items (unchanged), plus siblings that already existed at build: B2-16's made-up ids, K3-35 parts, the 8 files in review 5 item 4, the K3-26 and workflow-rows lines | ≈2: closed-state readers and the single recognizer, via the S1 caller/reader table | ≈5: production defects made by the fixes (sorting inside each record, a missing closure reader treated as open, a re-read per page, the hook reading closure twice) |
| Self-graded exemption (20) | ≈12: exemptions over existing debt ("69 all allowed", wrong (a) grades, "defects 0") become table rows | – | ≈8 come back as BLOCKED: the closed case, 31/32 items under the serial Kernel, SQLite-only rows because the Host opens its own store, K3-18 needs_decision, B2-02's id collision, the natural Run end. The back-and-forth stops, but each wall still costs a round |
| Weakened or regression (12) | 1 (b3.diff:8871) | ≈2, if BLOCKED is used instead of weakening. The rule against weakening already existed from about rework 3, and DSH still weakened 9 more times | ≈9, caught at the same point as now |
| Book or rule unclear (9) | ≈1, via OPEN QUESTIONS | ≈3: book paraphrase errors (rework 4's refusal that spec :537 does not contain; rework 6's range "(a) ~285–523") | ≈5: Codex's static claims (close via plan change → refused `busy`; 31 calls in one batch) and the (a) redefinitions, each needing a one-class re-audit |
| Older debt (5) | 5, because of S0 scope = merge unit | – | – |
| Genuine or other (4) | – | – | 4 (A8 attribution, natural end, and similar) |
| **Total** | **≈37** | **≈7** | **≈31** |

Caveats:
- The ≈37 assumes Codex applies the strict reading it used from review 1 onward. The forbidden moves (renamed helpers, stub ports) are known only in hindsight.
- If the lead's rulings at the freeze are as loose as rework 6 §1 was, the verify scope (table rows only, everything else DEFERRED) hides the error instead of raising it again.

**Likely K3 path:**
1. Rework 1 (2–3 DSH sessions).
2. Verify 1: about 8 BLOCKED rulings, 3–4 defects made by the fixes, 2–4 weakenings.
3. Rework 2: the walls behind the first walls. Examples: Host path → own SQLite → spy seam → dropped memory rows; serial Kernel → pure test → the stub-port dispute, which needs a one-class re-audit.
4. Rework 3, then 1–3 rows left for the lead to fix inline or for Opus.

That is 3 reworks plus an inline cleanup, about 50/50 that nothing bigger is left.

**L8 replay**

| Finding | Effect of the protocol |
|---|---|
| Review 1 item 1: restore at start-up triggers a capture (host-settings.ts:572) | Prevented: the S1 table lists all callers of `openWorkspace` |
| Review 1 item 2: the assembler sorts again (context-assembler.ts:237) | Prevented: S1 lists downstream readers, and the book itself cites "sort by key ~217" |
| Review 1 item 4: two mapping copies | Likely prevented: the UI caller plus the boundary rule become an OPEN question when the book is reviewed |
| Review 1 item 3: silent catalog read, the 2,000-character cut | Caught in the first audit, as now. "No silent defaults" was already in coordinator-mode; DSH did it anyway and listed it (UNSPECIFIED 8) |
| Review 1 items 5–7: written facts in tests, coverage gaps, missing PASS rows | Caught in the first audit, as now; the spec-row check already worked |
| Review 2: silent observation read; swallowed thrown cancellation | Both were made in rework 1. Verify 1 catches them, as now |
| Review 2: re-sent notifications; capture-mappings.test.ts:292 (new file) | Relocations. The verify-1 re-scan catches them, as now |
| Review 2: reads counted on the reader only | Prevented: one concrete disposition instead of copying Codex's "在真实准备依赖外计数" |
| Review 2: chunk scope (production) | Not caught by review; enters through the production-defect exception |
| Review 2: Host close/restart rows replaced by direct driver calls | The delta ledger makes this a must-fix at verify 1 (Codex only suggested it) |

L8 result: build findings drop from 7 to about 4, and rework-2 items from 5 to about 4. It still takes 2 reworks, maybe 3. It costs 7–8 Codex runs against 4–5 so far.

**Weakest point: the frozen table is static, but the long K3 disputes were about what only running shows.**
- Codex's dispositions name public paths that nobody has run.
- Every multi-round K3 dispute was of this kind:
  - the closed case: 3 rounds (rework 3 "plan change", then refused `busy`, then the case was deleted, then a race through a latch, then ready vs. refuse);
  - the serial Kernel and the 32 items: 4 or more rounds;
  - the Host opening its own store: 3 rounds;
  - the id collision and the hook timeouts.
- Each fix exposes the next wall.
- The protocol meets a wall only after DSH reports BLOCKED, so each wall still costs a lead ruling plus a DSH round. "Rework 1 works the whole table" breaks at the first wall.
- The same blind spot covers new lead rulings inside rework books: 2 of L8's 4 rework-2 must-fix findings came from the lead's own rework-1 text.

**Cheapest fix: one probe run before the freeze, in parallel with the group audits.**
- After the shared run, a short DSH session builds the shared public-path helper. It costs no Claude quota; a Claude subagent is needed only for rows that need bubblewrap.
- It writes one proving test per class disposition and per static reachability claim, runs each one RED, and reports BLOCKED with the refusal text. It migrates no instances.
- The lead rules on the BLOCKED rows before the freeze, so every disposition in the table has run once.
- Add a 6–10 minute Codex check of any rework book that carries a new lead ruling.
- Expected effect: K3 drops to about 2–3 reworks. A wall that sits behind a probed one can still appear.

**Two other cheap fixes**
- **Weakening.** DSH's close-out runs the delta-ledger script and ties every line to a table id, or restores it. The lead runs the same script when the reply arrives and sends DSH a resume message before calling Codex. A weakening then costs a resume, not a full round.
- **Size threshold.** Run the grouped audit only when the merge unit's tests exceed about 25 files or 6,000 lines, or when a class has 3 or more instances. Otherwise use one uncapped review that lists every instance per class. That is enough for L8-size slices.

**Scores**
- **Convergence: 7/10.** About 37 of the 75 findings are caught at once, and K3 goes from 8+ reworks to 3–4. But weakenings and walls each still cost a round, and L8 is unchanged. With the probe: 8.
- **Cost: 6/10 (10 = cheapest).**
  - Codex runs: about 11–13 for K3 against 8+ so far, and 7–8 for L8 against 4–5. They are free to the Claude quota but slow.
  - The 1–2 h freeze uses Claude quota while it is tight.
  - Two scripts must be written once: the table merge and the delta ledger.
  - For L8-size slices it costs more than today unless the size threshold is used.

## Design: contract-first

**Contract-first Codex protocol for one slice**

**Why it took 8 rounds.** Codex was not chasing perfection. Of the 75 K3 B3 must-fix findings, only 2 were really new; 56 could have been found a round earlier (synthesis table in wpdlzlnxt.output). Three things kept it going:
- **Capped reviews that only sampled.** Reviews 2–8 were "quick check of the changes only", capped at 1,800–2,500 Chinese characters. The lead still asked whole-set questions: review6 question 1 ("Does every K3/B2 scenario now reach its state through public steps"), and review7 asked Codex to "sample the hits". Codex answered with examples, e.g. review1 item 10 "其他例子是…".
- **Fixes asked for at the smallest size.** Prompts asked for "the smallest way" (review1 prompt) and "accept, or the smallest change" (every UNSPECIFIED question). So each fix covered single lines. The books copied those lines (rework-6 item 3, rework-7 items 1–3), and DSH fixed exactly them.
- **A target that kept moving.**
  - "A name does not change what it is" was added after round 4 (coordinator-mode.md:63).
  - Categories (a)–(d) arrived in rework-6 §1. Its example "K3-26 ~285–523" exempted rows that reviews 7 and 8 then flagged.
  - Category (a) was narrowed again in rework-7 §1 and rework-8 §1.
  - The scope grew from an L19a feature to "every K3 file" (rework-7 §1).
  - The lead's own earlier ruling (k3-g3-impl-4.md:34–35) prescribed the pattern later rejected.

L8 shows the same at small scale:
- The book reviews checked rulings, code facts and seams, not a per-row acceptance table.
- Review1's must-fix 5–7 were test rows §3 required but did not pin per row: backends, restart rows, PASS rows, failure after success, read counts under prepare.
- Review2 found a sibling Codex had not named (the observation read, not only the catalog read) and a regression from an accepted suggestion (a thrown cancellation was swallowed).
- §3 already said "Never write a failure record by hand", and the build still did it. A rule in the book is not enough without a check at close-out.

---

## 1. Stages and who does what

**S0 – Contract (lead, before the book is final).** One file, `<slice>-contract.md`, with a version number (v1, v2…). Every book and every Codex prompt cites it. It has seven sections:
- **C1 Scope:**
  - the production globs, and the closed set of test and helper files;
  - the rows;
  - the T-list (files and patterns that are out).
  - Older debt in in-scope files is put into a row or onto the T-list here, never later.
- **C2 Row table.** For each row:
  - the hand-computed literal it asserts;
  - the public path to its precondition (helper file:line);
  - backends: memory and SQLite, or SQLite-only with the reason;
  - who runs it: the DSH sandbox or the lead's bwrap check;
  - the production check it guards, used for the mutation check.
- **C3 Test-rule decision table.** Each shape is marked allowed or forbidden, with one accepted and one rejected example from this repo at file:line. The shapes:
  - the owner accepts a built value;
  - a read result or Session field is overwritten;
  - an owner write the Runtime or Host normally calls;
  - a stub port that feeds a Workflow (`performWorld`);
  - a store append;
  - a delegating fault or count wrapper;
  - the `vi.spyOn` backend seam;
  - input to a pure function;
  - an input the owner refuses.
- **C4 Reachability table.** Rows that may be unreachable get a decided disposition: a public path, a named pure test, or deletion under AGENTS rule 4. The implementer may move or delete nothing else.
- **C5 Assertion freeze.** The contract lists the assertions allowed to change (for example the K3-16 `blockedCommands: []` flip). Every other `expect`, row, backend entry and input literal is frozen.
- **C6 Production checklist, made concrete:**
  - for each new async chain, a failure-exit table: each call site × resolve / reject / throw / cancel → outcome;
  - for each "one rule" ruling, the list of readers;
  - read bounds written as count assertions.
- **C7 Superseded rulings.** It would have withdrawn k3-g3-impl-4.md §2 ruling 2.

**S1 – Codex contract review** (uncapped; replaces today's book review). The lead freezes v1. One quick re-check covers only the clauses that changed.

**S2 – DSH read-through.** Its answers go into the contract (v1.x), not into a separate answers section.

**S3 – Build (DSH).** The close-out runs two scripts the lead owns:
- a fact grep over the C1 set;
- an assertion diff from the slice base.

DSH may annotate the hits. It never classifies them.

**S4 – Lead's bwrap full suite** (Claude subagent in WSL), before Codex sees the build. In L8, production-reach and Z01 were found only there (s8l8-1-check-summary.txt).

**S5 – Codex post-build review**, judged against v1 only and uncapped. When C1 has more than about 40 files, split it into parallel runs over disjoint file groups. K3 had 167 files / 41,790 lines, which means 6–8 runs.

**S6 – The lead freezes the finding list F0.** The rework book copies it verbatim. A rework book contains no new rulings except amendments made through S8.

**S7 – Rework reviews:** closure of the frozen list, plus regressions.

**S8 – Contract amendment (the only way the definition moves).**
- Allowed only for a production defect with a concrete failure scenario, or a contradiction with the spec.
- Each amendment needs a new contract version, accepted and rejected examples, and one Codex enumeration of every instance in C1 under the new reading, in the same call.
- Rules added to coordinator-mode.md during a slice apply from the next slice.
- Codex reports "contract issues" separately and never as findings. This stops the scope from flip-flopping, as when review4 item 6 warned against a whole-repo re-review and review6 then required 14 untouched files.

## 2. What each Codex call must output

**Contract review (S1)**, no cap:
- **(a) Code facts:** each cited file:line, right or wrong (as in l8-book1 item 8).
- **(b) Ambiguities:** for each clause, a real case in the repo where two readings give different verdicts, with proposed wording. Two it would have caught:
  - "Memory and SQLite where the row says so" (k3-g4b3-impl.md §3) against spec ~1374 "服务层的例子…两个后端各跑一次". This cost review6 item 3, review7, rework-7 item 4 and 29 sites.
  - L8's memory restart rows, which were ruled only in rework-1 item 6.
- **(c) A dry run of C3 over the existing in-scope tests and helpers**, with one coverage row per file (clean / hits by shape / T-list). Every shape C3 does not decide goes to a lead ruling before the build. This would have surfaced, before the build:
  - the committed drafts in K3-06, K3-13 and K3-26;
  - the K3-19 `purpose` overwrite;
  - the `performWorld` stub ports;
  - the B2 `enter()` facts;
  - the K3-35 fixture, already flagged in k3g4b2-review2 item 6.

  Instead they came out one sample at a time across reviews 3–8.
- **(d) Reachability:** a public path, or "unreachable because file:line". Three findings it would have settled:
  - K3-18 `kernel_unreadable_at_stop` (review6 item 4);
  - the closed-branch race (review4 item 4);
  - the serial-batch multi-item limit (review5 item 4).
- **(e) Fixture capability:** does one shared helper reach every precondition in C2? If not, "fixture first" becomes an item in the book. Rework 3 found that no such helper existed.
- **(f) Feasibility of each ruling against the boundary and architecture checks.** L8 ruling 6 against `check-boundaries.mjs` ~446–462 became review1 item 4.
- **(g) The enumerations C6 needs:**
  - every trigger path × new / replayed / restored (L8 review1 item 1, `host-settings.ts:572`);
  - every await with its failure exit. In L8 the catalog read, the observation read and the thrown cancellation came out over two rounds; this would list them at once.
- **(h) Conflicting earlier rulings.**

It ends with "contract buildable" or a list of the clauses to fix.

**Post-build review (S5)**, tables first, no cap on A–D:
- **A.** Each C2 row: present, missing or wrong. L8's PASS rows "没写" would show up here.
- **B.** A per-file coverage table over C1: read fully or not, and a verdict per C3 shape. A file that was not read must be marked, so "clean" and "never read" cannot look the same. Rework 8's grep covered 93 of 167 files and nobody could tell.
- **C.** Findings as classes, in the format of §3.
- **D.** A verdict on every line the assertion-diff script prints, cumulative from the slice base.
- **E.** Each UNSPECIFIED: accept, or the disposition from C3/C4. Anything the contract does not decide is a contract issue (G).
- **F.** A follow-up list for everything outside the contract. Nothing on it is must-fix.
- **G.** Contract issues, which the lead takes through S8.

**Rework review (S7):**
- per frozen instance: closed or not;
- the class searches re-run on the rework diff;
- the assertion diff on this round and cumulative;
- the bwrap results.

No new classes may be raised on unchanged code; those go to F.

**Why one pass works.** When review1 was a full review, it found 13 production items at once, and production converged by rework 2. Sections (c) and B force a complete list, and C3/C7/S8 keep the definition from moving.

## 3. Fix approaches that cannot be met by the letter

Each finding carries these fields:
- **Class:** the clause and the rule it breaks.
- **Search:** a grep pattern, plus a reading by meaning of the named files. Overwritten reads and Session rewrites cannot be found by grep (review8, K3-19).
- **Instances:** the complete file:line list, with "complete under C1" or the list of files not read.
- **One disposition per instance:** a public path at helper file:line, a named pure-test file, the T-list, or deletion under C4.
  - Never leave a choice to DSH. Review8 item 3 said "走公开步骤，或拆成真正无存储的纯测"; rework-8 item 4 copied it, and DSH chose the stub-port branch.
- **Root fix:** when a class has 3 or more instances or comes back, name the shared fix that removes the class, then the smallest change per instance. Prompts stop asking only for "the smallest change".
- **Done-check:** something that can be run:
  - a script that returns zero hits outside its allowlist;
  - a mutation check, e.g. "remove `run-reconcile-service.ts` ~283 and this row fails" (the K3-26:508 case);
  - a count asserted under the public `prepare` (L8 review2).
- **Assumed runtime behaviour:** marked as an assumption, because Codex cannot run tests. DSH probes it first and reports BLOCKED if it is false. Review3's plan-change fix was refused `busy` (k3-g4b3-rework3-final.md:18).

Rules in the rework book for DSH:
- Run every class search over the whole C1 set and report new instances too.
- No exemptions. If blocked, leave the test unchanged and report BLOCKED with what was tried.
- DSH does not grade ledger categories. "Defects 0" was rejected in review7 and review8.

## 4. Catching weakening and regressions

- **Assertion-diff script** (the lead's, run at every close-out, cumulative from the slice base). It lists:
  - removed or changed `expect`;
  - removed or renamed tests;
  - changes to the `describe.each` / `it.each` backend lists;
  - changed input literals;
  - `.skip` and `.todo`.

  Codex judges each line against C5. Five of K3's 12 weakenings, each of which would have appeared as a line:
  - the full required-section assertion deleted (rework2.diff:3712);
  - B2-07 cut from 2 cards to 1 (review5 item 7);
  - the K3-18 answer-rejection assertion deleted (review6 item 4);
  - memory rows turned into SQLite (rework6.diff:1324);
  - capacity built from the production constants (review7).
- **Mutation spot-check** for every rewritten row (the C2 column), run by a Claude subagent in WSL. It catches weakening through a changed input that leaves the `expect` intact (K3-26:508, `itemsOmitted:1`).
- **Class searches re-run on changed lines.** They catch the same thing under a new name: `createRecordFromDraft`, `recordRealRunEnd` and `injectDeclaredToolStarts` (rework 3), and `S8A-L8-capture-mappings:292` (L8 rework 1).
- **The failure-exit table re-checked for changed functions.** L8's accepted suggestion introduced the swallowed thrown cancellation.
- **The bwrap full suite before every Codex review** (S4).

## 5. Stop rule

- **R0 (after the build)** freezes F0, the complete list under v1.
- **R1** may raise only:
  - F0 instances not closed;
  - regressions in the R1 diff, found by §4;
  - approved S8 amendments, each enumerated in full.
- **R2** may raise only F1 leftovers and regressions in the R2 diff.
- **There is no DSH rework 3.** Leftovers go to one of:
  - the lead, inline, if a few lines;
  - an Opus subagent in WSL, for BLOCKED or remaining items;
  - the T-list, with the user's yes.

  Decision 75's bar is met by a stronger fixer, not lowered.
- **A Codex miss** (code that was in R0's scope, under a clause that did not change) is fixed outside the DSH loop and logged as a protocol defect. A miss does not buy another round.
- **Tripwire before rework 2.** If R1's must-fix count is more than half of R0's, or a class comes back, stop and diagnose. K3's test findings ran 5, 5, 8, 8, 9, 8, 9, 6 with nothing to stop them.

## 6. Cost

**Codex runs:**
- **L8-sized slice:** contract 1, re-check 1, post-build 1, reworks up to 2: at most 5 runs. L8 has used 4 so far and has not converged.
- **K3-sized slice:** 6–8 parallel contract runs, 6–8 parallel post-build runs and up to 2 rework reviews, about 14–18 runs in 4 sequential stages. B3 used 8 sequential reviews over about 14.5 h.
- **Time per run:** quick checks took 6–14 min; uncapped group runs are estimated at 15–30 min.
- Codex costs no Claude quota. Its cost is wall time, which the parallel runs absorb.

**Lead attention and Claude quota:**
- **Up front:** about 1–2 h for the C2 table, the C3 examples and the S1 rulings. Freezing F0 is the largest single cost: 50–150 entries on a K3-sized slice.
- **Once:** three scripts (fact grep, assertion diff, backend matrix), reused by every slice.
- **Per round:** one WSL subagent for bwrap and the mutation checks.
- **Saved:** rework books become copies of a frozen list, no rulings are made during the slice, and a K3-sized slice needs about 5 fewer DSH rounds.
- **Wall time:** 1–2 h more before the build starts.

## 7. What it does not solve

- DSH transport and memory failures: 6 deaths across reworks 6–8.
- Runtime facts Codex cannot see without running tests:
  - the serial Kernel leaves one unresolved call per Run;
  - the Host opens its own SQLite;
  - the id-counter collision;
  - the K3-35 hook timeouts;
  - the 177–230 s 401-Run world.

  The protocol only sends these to BLOCKED earlier.
- Genuinely new defects the build exposes, such as L8's chunk scope (review2 UNSPECIFIED 6). They take the S8 path and can cost a round.
- DSH weakening tests when blocked. The checks detect it every round; they do not prevent it.
- Mistakes in the lead's contract that Codex also misses. Rework-4 item 3 demanded a refusal that spec ~537 does not contain. C7 and S1(h) reduce this but do not remove it.
- Different verdicts from parallel Codex runs on the same pattern. The C3 examples narrow this.
- The size of inherited debt. A 167-file migration is still large. The protocol turns it into one list; whether it belongs in the slice or in T is the user's decision.

### Replay

**Verdict.** The protocol fixes the three main causes of K3's long loop: capped reviews that only sampled, a definition that kept moving, and DSH grading its own exemptions. Its weakest point is a gap in its own rules: a test shape the contract does not list has no way to be ruled on during the slice. Scores: convergence 7/10, cost 6/10 (10 = cheapest).

**Three claims in the protocol need correcting**
1. "One pass works" is overstated. Review1 had 13 items, 10 of them production must-fix. A full list still left review2 with 6 production findings: items 2, 4 and 7 only partly fixed, and item 7 also a new silent default from the rework (the tool's point read replaced the waiting form). Review3 found one more. Production took three reviews, which fits the R0–R2 cap but not "one pass".
2. §7 undersells S1. Codex found most of the "runtime facts" by reading code once asked:
   - the serial batch (review5 item 4, tool-registry.js:135);
   - a completed Run stays `verifying`, so requeue is refused `busy` (review5 item 5, task-machine.ts:210/1218);
   - the id counter restarts (review6 item 5);
   - the Host opens its own ledger (review7 UNSPECIFIED 1, create-platform.ts:653/660);
   - the closed-branch race (review4 item 4).

   Only the hook timeouts and the 401-Run world's time needed running. So S1(d)/(e) should be asked for each C2 row.
3. The tripwire would have fired at K3's rework 1 (11 findings against 15), but the protocol says nothing about what to do next.

**K3 B3 replay** (75 must-fix; 17 production, 58 test)

| Category (count) | What happens under the protocol |
|---|---|
| Named item incomplete (25) | About 10 **prevented**: the leftover is greppable and the done-check fails at close-out (UCR `pinRevision` copy, fixture calls to `recordRunResult`/RUN-22/`SqliteStores.open`, the second closure read, the tool's point read under a count assertion). About 15 **let through to R1** as "F0 not closed": partial fixes judged by meaning, e.g. the per-record sort (review2 item 2) and `createRecordFromDraft` (review4 item 2). |
| Self-graded exemption (20) | **Caught in R0** as one list, because DSH no longer classifies. This works for K3 only because C3 was written from K3's own history. The shapes DSH invented during reworks would fall outside C3 on a new slice: rework 3's three helpers, rework 5's own recognition setup running with `lookup_not_wired`/`not_configured`, rework 8's `performWorld`. |
| Weakened / regression (12) | **Caught in the round it appears**, not prevented. About 10 of 12 show up mechanically: rework2.diff:3712, B2-07 cut from 2 cards to 1, the K3-18 rejection, rework1.diff:8038, memory rows turned into SQLite (rework6.diff:1324), the closed-case deletion, and K3-26:508 through the input-literal line plus the mutation check. Capacity built from production constants needs Codex's judgment. The point-read regression needs the failure-exit re-check. |
| Book or rule unclear (9) | About 7 **prevented** by S1(b), C3, C7 and the rule against new rulings in rework books: memory/SQLite against spec ~1374, the three narrowings of category (a), k3-g3-impl-4 ruling 2, "31 in one batch", the `busy` plan-change path, rework-4's refusal claim. About 2 **let through** as S8 rulings. |
| Older debt (5) | **Prevented as a round cost** only if S0 decides what the merge gate covers. B3's book scoped about 20 rows; "every K3 file" came in rework-7 §1. Otherwise it goes to the follow-up list, then T with the user's yes. |
| Genuine (2) | **Let through**; fixed in R1 under S8. |
| Production (17) | Build round 10 → about 6: C6 prevents review1 items 2, 4, 7 and 8. Rework-1 round 6 → about 3. Rework-2 round 1 → 0–1. |

**Plausible rounds for K3 B3:** about 3–4 DSH sessions and 3 review stages (R0 run in parallel, then R1, R2), against 9 DSH sessions and 8+ sequential reviews so far.
- **Build:** 2 DSH sessions if the scope is all 167 files (fixture first, then migration).
- **R1**, then a small **R2**.
- **One Opus or lead pass** for the hook timeouts, the 401-Run world's time and anything BLOCKED.

**L8 replay**

| Finding | What happens under the protocol |
|---|---|
| r1-1 a restored workspace triggers again (host-settings.ts:572) | **Prevented** by S1(g): every trigger path × new, replayed, restored. |
| r1-2 the assembler sorts the keys again (~237) | **Probably prevented.** Ruling 12 already cited the sort at ~217, so S1(b) or (f) can catch it; otherwise it lands in R0. |
| r1-3 catalog read fails silently; 2,000-character cut | The silent read is **prevented** by the C6 failure-exit table. The cut was DSH's own addition, so it lands in **R0**. |
| r1-4 the mapping in two places | **Prevented** by S1(f): check-boundaries.mjs ~446–462. |
| r1-5 hand-written facts in the service tests | **Prevented** by the close-out grep, where the shape is greppable. |
| r1-6, r1-7 §3 coverage gaps; PASS rows not written | **Prevented** by the C2 row table (backends, SQLite-only restart rows, failure after success, the gate, read counts under `prepare`, who runs each row) and by S4. |
| r2-a chunks not scoped to their workspace (genuine) | **Let through**, but C2's two-workspace row exposes it in the build, so it is an S8 fix in R1. |
| r2-b observation read fails silently | **Prevented**: the C6 table lists every await. Codex had named only the catalog read. |
| r2-c thrown cancellation swallowed (from an accepted suggestion) | **Caught in R1**, the same as what happened. |
| r2-d tests | capture-mappings:292 and the read count under `prepare` are **prevented** by a runnable done-check. The re-sent registration notification is judged by meaning and **reaches R1**. |

**Plausible rounds for L8:** about 2 reworks, with R2 small. L8 today is at rework 2 with 4 must-fix still open, so the saving is about one round.

**Weakest point: no way to rule on a test shape C3 does not list.** §2 E sends anything the contract does not decide to G (contract issues), and S8 admits only production defects and spec contradictions. Two kinds of item therefore have no path inside the slice:
- **New shapes DSH invents during reworks.** These cost about one round each in K3: rework 3's three helpers, rework 5's own recognition setup, rework 8's stub ports.
- **BLOCKED rows whose C2 cell cannot be met:** memory rows under the Host's own ledger, multi-item records under the serial Kernel.

They either ship to T, reopen the definition (cause 2 again), or spill to Opus after R2 on the tightest quota.

**Cheapest fix** (a few sentences in the template, at most one extra Codex run):
1. **Make C3 default-deny.** List the allowed shapes, each with an example: fault injection, delegating wrappers, pure-function input, refused input, the `vi.spyOn` seam. Any other way a test puts a value into a store, owner, reader, Workflow, Session or stub port is forbidden, whatever it is called. A new shape is then a finding, not a contract issue.
2. **Open one amendment window at S6.** While freezing F0, the lead rules on the G items and on infeasible C2 cells. The R0 runs enumerate every instance under each ruling before F0 is frozen. After S6, only S8 applies.
3. **Make the scripts block the close-out.** Any fact-grep hit outside the allowlist, or assertion-diff line outside C5, fails the close-out: DSH fixes it or reports BLOCKED. Today the scripts only list.

**Smaller gaps**
- **"Read fully" is self-reported.** Give each Codex run a script-made file list and require one cited line per file; the script checks that every file appears.
- **R1 on 60–100 instances will not fit one DSH session.** Rework 8 needed 4 starts. Split R1 by the S5 file groups across parallel DSH copies.
- **C2 for a K3-sized slice takes about 3–5 lead hours, not 1–2.** It needs B2-01's example table, K3-35's hand totals and the B2-16/18 read counts. Have DSH draft it (decision 56) and Codex check it in S1.
- **Define the tripwire's action.** For example, hand the remaining test classes to an Opus subagent in WSL.

**Scores**
- **Convergence: 7/10** as written, 8/10 with the fix.
- **Cost: 6/10** (10 = cheapest). Codex is free and runs in parallel. The lead's up-front work and one WSL subagent per round use Claude quota. It pays back on a K3-sized slice (about 5 fewer DSH sessions, 5 fewer sequential reviews and 6 fewer rework books) and roughly breaks even on an L8-sized one.

Evidence: `D:/cc-lead-notes/codex2/k3g4b3-review*.{prompt,out}.md` and `l8-*.{prompt,out}.md`; `D:/cc-lead-notes/impl/k3/k3-g4b3-impl.md` and `k3-g4b3-rework-1..8.md`; `D:/cc-lead-notes/impl/k3/k3-g3-impl-4.md:34–35`; `D:/cc-lead-notes/impl/k3/replies/k3-g4b3-rework3-final.md:18`; `D:/cc-lead-notes/impl/s8l8/l8-impl.md`, `l8-rework-1.md`, `l8-rework-2.md`, `s8l8-1-check-summary.txt`; `D:/cc-lead-notes/impl/coordinator-mode.md:40–121`.

## Design: mechanical-guards

# Codex protocol for one slice: turn review findings into machine checks

**Short answer.** Codex was not too perfectionist. Its findings were real: 75 must-fix in K3 B3, and 56 of them could have been found a round earlier (wpdlzlnxt.output `result.synthesis`). The loop came from four things:
- **Every Codex call had a length cap.** K3 reviews were capped at 5,000 → 2,500 → 2,000 → 1,800 Chinese characters, and L8 at 1,500–2,500. Codex therefore answered with examples ("其他例子是…", k3g4b3-review.out.md item 10). The review7 prompt even said "sample the hits".
- **The books copied those examples as file:line lists.** Rework-6 item 3 named 14 files by line.
- **DSH fixed exactly those lines and graded its own exemptions.** It did this through the close-out grep ledger that coordinator-mode.md:76–77 and :92–93 ask DSH to write.
- **The definition of "fact" moved.** The categories (a)–(d) changed in rework-6 §1, then rework-7 §1, then rework-8 §1.

The protocol below changes three things:
- Most of Codex's work becomes **deterministic detectors**, so the full list of a defect class exists on round 0.
- **The allowlist belongs to the lead**, so DSH cannot grade itself.
- **Codex is asked only what a machine cannot answer:** spec meaning, design, and which production check each test row must prove.

## 1. Stages and who does what

**S0. Once, before the next slice.**
- Codex (read-only) writes the detector specs from all 12 K3 and L8 outputs. Each rule gets a definition, the historic hit lines on the old tag (for example k3-g4b3 tag, B2-18-request-reads.test.ts:108), and the allowed cases. Review8 names allowed cases: the fault wrappers in K3-17 and K3-46, the vi.spyOn memory seam, the Session-health probe.
- The lead freezes these specs. They become the one definition of "hand-written fact" and the rest.
- DSH or a Claude subagent builds the detectors. Each detector gets a test that uses the historic lines as fixtures.
- Codex reviews the detector code once.
- A Claude subagent in WSL replays the detectors over tags k3-g4b3 to k3-g4b3-r8, s8l8-1 and s8l8-r1. It reports recall against Codex's past findings and the false-positive count. The lead accepts the set.

**S1. Book.**
- The lead drafts the book, and a book-lint script checks it.
- Codex runs one book review with no length cap, plus at most one quick follow-up (decision 56).
- The lead freezes the row matrix that review returns (§2).

**S2. Build.**
- DSH builds.
- Its close-out runs `check:review --base <slice tag>`, which is all whole-tree detectors plus the weakening scan.
- DSH may not edit the allowlist. When it cannot fix something, it leaves the test unchanged and reports it as BLOCKED.

**S3. Lead gate (machine only, before any Codex run).**
- The lead runs `check:review`, and a Claude subagent runs the bubblewrap tests and the mutation rows.
- If anything is red, the round goes straight back to DSH. No Codex run is spent on mechanical findings.

**S4. Post-build review.**
- One full Codex review with no length cap. It is split into parallel runs over disjoint file groups when the slice is large (§2).

**S5. Freeze.**
- The lead turns Codex's table plus the detector violations into one frozen rework list.
- Every entry is either fixed now or put on the T list by name.

**S6. Rework.**
- DSH works the frozen list. Done means: the detectors are green, the mutation rows fail when their guard is removed, and every item's done-condition holds.

**S7. Rework check.**
- First the machine checks.
- Then a narrow Codex check (§2c).

**S8. Merge.**
- Full suite with bubblewrap (rule 5), then the push.

## 2. The detectors, and what each Codex call must output

### The detectors

Each detector runs over the slice's declared file set plus every changed file, never over the diff alone. Whole-repo debt is frozen once as a baseline count that may only go down.

**F: test-fact lint.** It extends the type-checked scan in `tests/architecture/state-writes.test.ts` (1,092 lines, src only today) to tests/.

| Rule | Flags | Historic hits it would have caught |
|---|---|---|
| F1 | A call in a test to a write the Runtime or Host normally makes (`recordRunResult`, RUN-20/22 with a built draft, store `append`/`commit`, `SqliteStores.open`) outside a registered fault wrapper | review4 items 2–3 (real-run-end.ts:172, K-boundary-facts-support.ts:180); review5 item 1 |
| F2 | An object literal whose type is a protected record, draft, item, event, prepared value, position or cursor, which the owner then accepts | review1 item 10; review3; review6 item 2 (all 14 files); review7 K3-06/K3-26; review8 item 2; L8 review1 item 5 |
| F3 | Overwriting a read result or a Session field: assignment, or spread-then-override | review8 K3-19 `purpose`; review8 item 3 (K3-review-workflow-rows:254) |
| F4 | A stand-in port that returns built protected values | `performWorld` (K3-review-workflow-rows:737–751) |
| F5 | A helper in tests/helpers whose parameter is a draft, item, event, position, cursor, prepared value or digest (the rule in coordinator-mode.md:63–66) | review4 item 2 (`createRecordFromDraft`) |
| F6 | Taint: a test that calls a flagged helper is flagged at the call site | review8 UNSPECIFIED 2 (K3 calls into B2 `enter()`) |
| F7 | Literal Run, turn or cursor ids passed to owners | review3: B2-16 invents 401 Run ids; the self-made cursor |
| F8 | Reading the store directly to check a result | L8 review2 (S8A-L8-observation-state:255, :336) |

Files named `*-pure.test.ts` may not import a store or the platform. That keeps "pure" from being a way out (review8 item 3).

**W: weakening scan.** It is cumulative from the slice base tag. Every hit must cite the book item that allows it; otherwise it is a defect.

| Rule | Flags | Historic hits |
|---|---|---|
| W1 | An `expect` removed or loosened: `toEqual` → `toContain` or `toMatchObject`, a number changed, `.not` added | review1 (b3.diff:8871); review3 (rework2.diff:3712); review5 B2-07 two cards → one |
| W2 | A test, a table row of a test, or a test file deleted | the K3-18 "unreachable" row; review4 item 4; L8 Host close and restart (rework1.diff:1397) |
| W3 | `skip`, `todo`, `skipIf` or `only` added; timeouts raised | — |
| W4 | The backend list shrank | rework5 UNSPECIFIED 1 (DSH chose SQLite-only itself); rework6.diff:1324, :1337, :2696 |
| W5 | Changed input in a row that asserts a rejection | K3-26:508 |
| W6 | The allowlist grew | — |
| W7 | A production guard line deleted | — |

**Coverage, oracle and timing checks.**

| Check | Flags | Historic hits |
|---|---|---|
| C1, row matrix | Every spec or book row ID appears in a test title, with the required backends and with public or pure as required | B2-09b not built (review1 item 11); L8 PASS rows not written (review1 item 7); L8 variants tested only as pure (review1 item 6) |
| C2, both backends | Service-layer worlds run on memory and SQLite. Single-backend files sit on a list the lead owns (slice-K3-SPEC.md:1374) | review6 item 3; review7 |
| C3, oracle | `expect` arguments or test sizes taken from constants imported from src | review7 K3-48-3-extremes-pure:47 |
| C4, timing and trivia | `setImmediate` or timing races, large N used to make timing work, and checks that random ids differ | L8 review1 item 6 and its suggestions |
| C5, leaks | Global setup counts opened SQLite and platform handles and fails a file that leaves one open | review4 item 7; review5 item 6 |

**Production lint.**

| Rule | Flags | Historic hits |
|---|---|---|
| P1 | Forced casts `as never` / `as unknown as` in changed lines | review1 item 8 (the empty cursor) |
| P2 | Optional dependencies with a fallback (`deps.x?.()`, `?? open`), and a `catch` that returns a normal value without checking the signal | review2 item 4; L8 review2 (context-assembler.ts:1043) |
| P3 | Numeric caps not taken from a limits module that cites the spec | `slice(0, 32)`; L8's 2,000-character cut |
| P4 | Token clones between changed lines and src or tests/helpers | review1 item 12; review2 item 12; review4 item 5; L8 review1 item 4 |
| P5 | Rule owners from the book: raw reads of the rule outside its owner are forbidden, and the named readers must import it | review1 items 2 and 4 |
| P6 | Unused exports and fields in tests/helpers, extending the production-reach check | `setTaskActive`; L8 `signal`, `trigger`, `running.key` |
| P7 | A record kind with a lifecycle field must be in the state-writes protected table | L8 book1 item 4; book2 |
| P8 | A comment or reply claiming "lead-approved" or a "ruling" must cite an existing ruling ID | B2-401-world.ts:16 |

**M: mutation runner.** It reads a table with one entry per row: row ID, test title, production file:line, and the mutation. For each entry it applies the mutation in a temporary copy, runs that one test, and expects it to fail. Rows that need bubblewrap go to a Claude subagent.

It would have caught:
- B2-15 using a command that is already a direct action (review2);
- K3-26:508, where the row passes without the "must be a recorded call" check;
- "loads once" with no counting (L8).

**FM: fault matrix.** For each driver or service the book names, every method of its dependency interface is made to reject, throw, and throw an abort in turn. The result must be failed-with-reason, cancelled or unavailable, never a silent pending or a silent success.

It would have caught L8 review1 item 3 together with its sibling in review2 (the observation read) and the thrown cancellation.

**Coverage, by my reading of review1–8 (not measured).**
- About 45 of K3's 58 test findings are instances of the F, W and C rules.
- About 8–10 of its 17 production findings fall under P1–P5 or the read-count rows.
- In L8, roughly 5 of the 7 must-fix after the build and 3 of the 4 after rework 1 are covered.
- The S0 replay turns these estimates into a measured recall.

### 2a. Book review (uncapped)

Codex returns:
1. **Wrong book claims only.** The book-lint script checks citations first, so Codex judges what the cited code means, not whether it exists. L8 book1 item 8 had four citations that did not exist.
2. **Ruling defects,** each with a fix approach (§3).
3. **The row matrix:** row → test file → backends → public path (a helper at file:line) → guard to mutate (file:line) → fault-matrix targets.
4. **Rule owners** for P5.
5. **Existing tests affected,** with the query used to find them. WP2-wiring was found this way only in book1 item 7.
6. **Detector specs for any new class** this slice brings in.
7. **What the builder would still have to decide** (book2: "目前仍需施工者补上述…决定").

### 2b. Post-build review (uncapped)

- **Part A: one coverage row** per changed production file, per test file in the slice set, and per spec or book row: ok, the finding IDs, or not built. A missing row is visible. That was the gap in the rework-8 audit: 408 grep hits covered only 93 of the 167 files, and 183 hits had no verdict.
- **Part B: findings.** Each finding gives:
  - its class (SPEC, DESIGN, SILENT, READS, DUP, FACT, WEAK, COVER, LEFTOVER, or NEW);
  - the invariant it breaks, as one universally quantified sentence;
  - all instances, plus the query that listed them and the count;
  - a fix approach in the §3 format;
  - a detector verdict: Dx already catches it / amend Dx / new detector spec / cannot be automated (why);
  - the mutation guard, if it is a "the test proves its point" item.
- **Codex gets the detector output as input.** It must not re-report instances of a detector rule; it reports only gaps in the detectors and defects of meaning.
- **Split when large.** Over about 40 files or 1 MB of input, use parallel runs on disjoint groups, plus one run on the whole tree that answers only DUP and rule-owner questions. B3's 167 files would be 6–8 runs. Its quick checks already used 0.7–2 MB of log each just to sample.

**Why this would have caught K3 in one pass.**
- F1–F8 at the build close-out would already have listed what took 7 rounds to surface:
  - the K3-35 fixture (flagged reviews 1–5);
  - B2-18 and B2-16;
  - the proposal-round builders;
  - the 14 untouched group-4 files (review6);
  - the B2 helpers (review7);
  - K3-19 and the RUN-25 rows (review8).
- So the lead decides the scope once (fix now or T list), and the scope no longer keeps widening round after round, which was root cause 2.
- Codex's capped output then only has to carry the 10 production semantics items. That fits.

**Why this would have caught L8.** Rows C1 and C2 would have flagged the PASS rows and the backend gaps at DSH's own close-out. FM would have flagged the catalog read, the observation read and the thrown cancel together.

### 2c. Rework check

1. Machine checks first: the detector state compared with the last round, the W list, M, and the baseline-failure diff.
2. Then Codex, with no cap but a fixed scope. It answers only:
   - each frozen item: done, partial or not, with file:line;
   - each W hit: is the replacement equivalent to what the book allowed?
   - new defects on lines this round changed (with the diff hunk);
   - detector amendments.

   Anything else goes to the T list unless it is a serious production defect. Review4 item 6 warned against a whole-repo review, and review6 then required 14 untouched files. This stops that swing.

## 3. How fix approaches must be written

Every item in a book has six parts:
1. **Invariant and scope (file globs).** Not a list of lines.
2. **Instances.** Examples only, labelled "not the list".
3. **Done-condition.** For example "F2 reports 0 outside the allowlist in `tests/**/K3-*` and `tests/helpers/K3-*`", or "FM over `AutoCaptureDriver` deps is green".
4. **The path to use,** with the helper to reuse at file:line, and a fallback named in advance: "row X becomes pure test Y with the same assertion", or "report BLOCKED and leave the test unchanged".
5. **Forbidden moves:** delete or skip the row, change the expected literal, drop a backend, edit the allowlist, rename to escape a rule.
6. **The guard to mutate,** for items about whether a test proves its point.

Why this matters, from the evidence:
- L8 rework-1 item 3 named "catalog read rejected or throws". DSH fixed exactly that, and review2 found the observation-read sibling and the thrown cancel. An invariant plus FM covers both in one round.
- Rework-6 item 3's 14-file list missed K3-06:110, B2-execution-fixture:211 and K3-19.

Two more rules:
- **A Codex fix approach that claims runtime behaviour is marked unverified,** and DSH tests the claim first. Review3's "close through the public plan change" was refused `busy` in real runs.
- **A fix approach that contradicts a frozen detector rule is invalid.** Review8's "拆成真正无存储的纯测" was copied into rework-8 item 4, and it conflicts with coordinator-mode.md:60–62.

## 4. Catching weakening and regressions from a rework

- **The W scan is cumulative from the slice base, not per round.** Each hit needs a book item, or it is a defect. All 12 K3 weakenings and L8's rework1.diff:1397 would be caught in the round they happened, without a review.
- **The detector state is compared with the last round.** Any new violation is a regression, and the report names the round diff that introduced it.
- **The M rows are re-run every round.** This catches input changes that leave every `expect` intact (K3-26:508).
- **The list of failing tests is compared with the baseline file.** A new failure blocks until explained. This is the A8-3n case: review1 item 13 refused "the file did not change" as an explanation.
- **The allowlist** (stable anchors by normalized source text, not line numbers) **is changed only by the lead.** W6 catches any change. The precedent is L8 rework-1 item 8: "never add new code to the allowlist". The rework-8 ledger that filed accepted commits under (a) would have been impossible.

## 5. Stop rule

The budget is the build plus rework 1 plus rework 2.

- **Before any Codex run,** `check:review` must be green or every red item listed as BLOCKED.
- **Rework 3 exists only for regressions on rework-2's own lines.**
- **After that, no further DSH rounds.** Anything left goes one of these ways:
  - a mechanical item: the lead or a Claude subagent fixes it inline;
  - a meaning item that failed twice: an Opus subagent fixes that item alone, from the frozen list;
  - the lead moves it to the T list by name and tells the user;
  - the user decides.
- **Ratchet:** a class that shows up in two rounds must get a detector before the next slice starts.

This keeps the decision-75 bar (finished, clean, readable, correct). It changes who finishes the last items, not the bar. Fixing the number of rounds still needs the user's yes, because decision 75 says "no fixed rework rounds".

## 6. Cost

**Once.**
- 1–2 Codex detector-spec runs and 1 Codex review of the detectors. This costs no Claude quota.
- An estimated 1,500–2,000 lines of check code. For scale, state-writes.test.ts is 1,092 lines for one rule family.
- One DSH session after 18:00, or a Claude subagent.
- One Claude subagent replay over the old tags.
- About 1 hour of lead time to freeze the rules and seed the allowlist. The seeding is the biggest single piece: the rework-8 audit alone had 408 hits.

**Per slice.**
- Codex: 1–2 book reviews, 1 post-build review (6–8 parallel runs for a B3-sized slice), and at most 2 rework checks. That is about 4–6 runs, or about 10–12 for a large slice.
- For comparison: K3 B3 used 8 runs and is still not merged; L8 has used 4 so far.
- Measured times: quick checks took 7–14 minutes, L8 book1 took 24 minutes. Uncapped runs have not been measured; I estimate 20–60 minutes each.
- Detector runtime: minutes. The mutation rows depend on the test: the 401-Run world rows take 177–230 s, so run them only at merge.

**Lead attention.**
- About 10 minutes per round to read the detector summary and the W list.
- 30–60 minutes once per slice to freeze the post-build table.
- Fewer books than now: B3 needed 8.

## 7. What this does not solve

- **Defects of meaning and design.** Examples:
  - K3: directory restore, the sort order, the card text, UR7, the brief's drop order;
  - L8: the retrigger, row order, the chunk scope, and the watermark and snapshot races in book1 and book2.

  These stay with Codex and the lead.
- **Whether a test exercises the right path,** when nobody names its guard for the mutation runner.
- **Wrong rulings become wrong detectors.** Examples: k3-g3-impl-4 §2 ruling 2, and rework-4 item 3, which demanded a refusal that spec line 537 does not contain.
- **Evasion.** Writing through `any`, reflection or aliases evades the lint; these are the known limits of state-writes.test.ts. P1 and a W rule for new `any` only reduce this.
- **Slow fixtures and Kernel limits:** the serial Kernel, the Host opening its own SQLite, the 401-Run world.
- **Infrastructure failures:** DeepSeek transport failures, OOM kills. Of B3's roughly 14.5 hours, these cost time, not findings.
- **The size of the existing debt.** About 167 K3 files and the repo-wide tests. The detectors make it visible; they do not make it smaller.
- **Tests DSH cannot run.** It still cannot run the bubblewrap rows.

**Needs a user decision before starting:**
- adding check code, since AGENTS rule 3 says no non-blocking tests;
- any devDependency, such as a clone or mutation tool, which needs an approved download and both lockfiles;
- the round limit against decision 75.

Evidence files:
- C:/Users/han001/AppData/Local/Temp/claude/D--1-project-Software-agent-next-main--claude-worktrees-claude-code-task-execution-f3cca6/b61afb58-2d5c-4a70-8a66-839d07e766d2/tasks/wpdlzlnxt.output
- D:/cc-lead-notes/codex2/k3g4b3-review*.{prompt,out}.md
- D:/cc-lead-notes/codex2/l8-{book1,book2,review1,review2}.{prompt,out}.md
- D:/cc-lead-notes/impl/k3/k3-g4b3-rework-6.md
- D:/cc-lead-notes/impl/k3/k3-g4b3-rework-8.md
- D:/cc-lead-notes/impl/k3/replies/k3-g4b3-rework5-final.md
- D:/cc-lead-notes/impl/s8l8/l8-rework-1.md
- D:/cc-lead-notes/impl/s8l8/l8-rework-2.md
- D:/cc-lead-notes/impl/s8l8/replies/l8-impl-final.md
- D:/cc-lead-notes/impl/s8l8/replies/l8-rework1-final.md
- D:/cc-lead-notes/impl/coordinator-mode.md
- D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/tests/architecture/state-writes.test.ts

### Replay

**Verdict.** The protocol fixes the right half of the problem. It still misses the half that drove K3 rounds 3–8: tests whose real path did not exist yet, and a semantic line that a lint can't draw. Convergence **6/10** as written, about 8/10 with the fixes in section 5. Cost **5/10** (10 = cheapest).

## 1. K3 B3 replay, by root-cause category (75 must-fix, wpdlzlnxt `result.synthesis`)

| Category (count) | Under the protocol | Notes |
|---|---|---|
| Named item incomplete (25: about 10 production, 15 test) | Test part: **prevented**, because the done-condition becomes "detector green over globs". Production part: **let through** to the rework check. | Partial fixes of production meaning still cost a round: sort order (review2 #2), closure read twice (review3 #2), the tool's extra point read (review2 #7). |
| Self-graded exemption (20) | **Prevented** only if the allowlist stays small (see 4). | Otherwise the lead grades the same 408 hits that DSH graded. |
| Weakened or regression (12) | **Caught in the same round** by the W scan at S3. | Only 6 were hidden: b3.diff:8871, rework2.diff:3712, rework6.diff:1324/1337/2696, K3-26:508. DSH declared about 5 itself (rework5-final UNSPECIFIED 1, 2, 3, 4, 8: SQLite-only, the K3-18 row, two targets, 32 items, the half measure). Those came from walls, not from hiding. W turns them into BLOCKED reports, which still need a ruling or a path, so they still cost the round. Review6 #5 (B2-02 used the original Run) and review5 #6 (cleanup on the failure path) are not matched by any W rule. |
| Book or rule unclear (9) | **About half prevented** by the rule frozen at S0. | Still let through: the lead's own wrong claims. Rework-4 item 3 asked for a refusal that spec :537 doesn't contain; k3-g3 ruling 2; rework-8 item 4 "pure test with no store". Rework books get no check in the protocol. |
| Older debt (5) | **Caught at round 0** by F over the declared file set. | The scope is then decided once, at S5. |
| Genuine and other (4) | Codex finds these in the first review, as before. | |

## 2. By finding class (K3 and L8)

| Class | Instances | Verdict |
|---|---|---|
| Hand-written facts in tests (F1–F8) | K3 about 30. L8 review1 #5, review2 test items. | **Caught at round 0.** Still let through: writes through `as never`/`any` (for example K3-R1:70 `event: {} as never`) and the stub-port "pure" question (`performWorld`). |
| Weakening, deleted rows, dropped backends (W, C2) | 12, plus L8 Host close/restart (rework1.diff:1397). | **Caught in round.** Walls are not solved. |
| Missing or wrong-path rows (C1, M) | B2-09b, B2-15 ×2, K3-26:508, review5 #3 and #7. L8 PASS rows, variants tested only as pure, "loads once". | C1 **prevents** rows that were never built. M catches a wrong path only when the book named the guard. L8 §3 rows have no IDs, so the book must assign them before C1 can work. |
| Silent defaults and failure exits (P2, FM) | K3 review1 #8, review2 #4 and #7. L8 review1 #3, review2 observation read and thrown cancel. | **Prevented.** This is the strongest class. FM needs an expected outcome per target: the reminder-read ruling degrades to `架构提醒不可用` and continues, which a single generic outcome would reject. |
| Caps and constants (P3, C3) | 32-entry cap, review7 constants, L8 2,000-character cut. | **Prevented.** |
| Duplication (P4, P5) | K3 review1 #2 and #12, review2 #12, review4 #5, review6 #1. L8 review1 #4. | Near-identical copies are **caught**. Two different implementations of the same rule (recognition) and a one-line map are below clone thresholds, so these go to Codex. |
| Spec meaning, design, read counts | K3 review1 #1 (cursor), #3, #4, #5, #6, #7, #9; review2 #2; review3 #2. L8 review1 #1 and #2, UNSPECIFIED 9, chunk scope. | **Let through** to Codex, found in the first uncapped review. L8's chunk scope was only found by DSH in rework 1. |
| Fixture walls | Real-Run path (rounds 1–3), Host opening its own SQLite (5–6), serial Kernel and 32 items (4–6), id counter (5–6), closed and K3-18 reachability (4–6). | **Detected as BLOCKED, not resolved.** This is the main remaining driver of rounds. |
| Leaks, timeouts, baseline drift | review4 #7, review5 #6, K3-35 hook timeouts, A8-3n. L8 Z01 count, production-reach. | S3 (bubblewrap run plus baseline diff) **catches** them before Codex. Leaks on failure paths are let through. |

## 3. Plausible rounds

- **K3 B3:**
  - **Build plus 2–3 reworks, against 9 sessions historically,** if S5 freezes the scope to B3's own files plus taint and sends the untouched group-4 files to T. Rework 1 carries the 10 production items and the real-Run fixture. Rework 2 carries the production partials and the walls once ruled.
  - **4–5 rounds** if all 167 K3 files are in scope. That is bound by capacity, not discovery: migration volume, 150–180-minute DSH windows, DeepSeek failures.
  - The stop rule caps DSH at 3 rounds only by moving the rest to Opus or T.
- **L8:**
  - **Build plus 2, the same count as now.** Review1 #3, #5, #6, #7 would be closed at DSH's own close-out. Rework 1 would carry #1, #2, #4 and the UNSPECIFIED 9 ruling. Rework 2 would carry only chunk scope, instead of 5 items.
  - The book reviews stay at 2: book2's items come from rulings added after book1.
  - The gain is a smaller rework 2 and less risk of a rework 3, not fewer rounds.

## 4. Corrections to the protocol's claims

- **Production coverage is about 5–7 of 17, not 8–10.** Covered: the P1 cast, the P3 32-entry cap, the P2 default-open closure, and two P4 duplicates; partly the P2 non-ready success and P5 recognition. The rest are about meaning.
- **The caps did not fall steadily.** They ran 5,000, 2,500, 2,000, 2,000, 2,500, 2,000, 2,000, 1,800.
- **Codex did list whole sets when asked.** Review5 #4 gave an 8-file table and review6 a 14-file list. Sampling came from "quick check of the changes only" together with the cap.
- **S0 cannot measure false positives.** No labelled ground truth exists. The rework-8 ledger has 408 hits over 93 of 167 files, with 183 unverdicted.
- **The S3 bounce is an extra DSH round** that the build + 2 budget does not count.

## 5. Weakest point and the cheapest fix

**Weakest point.** F2 and F4 must decide the exact line K3 redrew five times:
- a built value the owner accepts as a precondition, against the input of a row that asserts a refusal (category (a) in rework-6 §1 → rework-7 §1 → rework-8 §1);
- a stub-port Workflow test, against a pure test (`performWorld`, K3-16 stand-in commit).

A type-checked lint sees "a built value reaches the owner". It cannot see "this row asserts refusal and every earlier state came from public steps". So the rules either miss, or flag every rejection input and every renderer input. The protocol absorbs this with a per-line allowlist that only the lead may edit. For K3 that is the 408-hit ledger again, now graded by the lead at 67% of the weekly quota against a 75% stop line. Anchors also break whenever DSH edits an allowlisted line. The definition keeps moving; it just moves into allowlist edits. The convergence claim ("full list at round 0, lead decides once") rests on this point.

**Cheapest fix: make the line syntactic by convention, then lint the convention.** This needs about 200–300 lines and one lead ruling.
1. A built protected value is legal only in two places:
   - a `*-pure.test.ts` file that imports no store, platform or Workflow (this also settles the stub-port question: those tests are not pure);
   - the single owner call inside a `describe('rejects: …')` block. Every `it` in that block must assert a refusal status, and its setup may use only shared public-step helpers.
2. The only allowlist is about 10 named helpers, approved once: the K3-17/K3-46 fault wrappers, the `vi.spyOn` memory seam, the Session-health probe. No per-line entries.
3. Any other hit is a violation. Debt in files the slice does not touch is a baseline count that may only go down.

## 6. Other holes, each with a cheap fix

- **BLOCKED has nothing that resolves it.** In S1, every row gets a disposition: an existing helper at file:line, a helper to build as item 0, a pure test, or T. For "helper to build", a Claude subagent spikes it, or Codex gives the reachability chain with the spec line, before DSH starts.
- **Detector amendments in every review (2b, 2c) reopen the scope.** An amendment applies only to lines changed in this slice; enforcement over the whole set starts with the next slice.
- **Rework books go unchecked.** Book-lint requires a verbatim spec quote for every "spec requires" claim, plus a 10-minute Codex check of the rulings in each rework book.
- **An S3 bounce delays the production review.** Run S4's production review in parallel with the bounce. K3's production findings were already finished by rework 2.
- **M rows on the 401-Run world run only at merge, which is too late.** Run the rows touched in a round at that round's S3, through a Claude subagent.

Evidence: wpdlzlnxt.output (`result.synthesis`, `options`, `final`); D:/cc-lead-notes/codex2/k3g4b3-review{,2..8}.{prompt,out}.md; D:/cc-lead-notes/codex2/l8-{book1,book2,review1,review2}.{prompt,out}.md; D:/cc-lead-notes/impl/k3/k3-g4b3-rework-{6,7,8}.md; D:/cc-lead-notes/impl/k3/replies/k3-g4b3-{final,rework5-final}.md; D:/cc-lead-notes/impl/s8l8/l8-impl.md §3, l8-rework-1.md, l8-rework-2.md; D:/cc-lead-notes/impl/coordinator-mode.md:40–121; D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/tests/architecture/state-writes.test.ts:1–38.
