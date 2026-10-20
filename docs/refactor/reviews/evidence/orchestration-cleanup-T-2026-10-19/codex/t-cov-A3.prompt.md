Read-only coverage triage for the lead. Do not write any file, do not run tests or builds. Answer in Chinese,
with `file:line` for every claim.

**Background.** The T round (HANDOFF decision 79-4) cleaned up the test suite and removed production code kept only
for old data. Decision 79-4 says, for the coverage runs before and after T: "测试没执行到的分支只是候选：真不会发生的才
删，会发生但没测的记成测试缺口，不删。流程照 C1：Codex 只读审查并给出改法，lead 核实，用户定，DSH 施工。" You are that
Codex review. Also binding: root `AGENTS.md` rule 4: there is no running-Role hot-switch lifecycle, and defensive checks
or tests that only tampering with the database can trigger are not restored; decision 79: no old-data compatibility
(code reads only the current format; old development databases are rebuilt).

**Where things are.**
- After T (the code the coverage ran on): `D:/cxt/t-docs/tree/` (`src/`, `tests/`, `docs/`).
- Before T: `D:/cxt/t-inv/` (same layout).
- This folder: `lists/list-<G>.tsv` (your rows), `ref/` (`compare-summary.txt` and `mapped-summary.txt`: the before
  and after totals and how the rows were found; `t-src-U0.diff`: T's diff of `src`; `t-files-deleted-added.txt`: every
  file T deleted or added; `t-end-list.md`: what the lead already holds for the user, including L-2, the production
  guards T left untested).
- T's items and their reasons: `D:/cxt/t-docs/evidence/books/t-items-TP.md`, `t-items-TQ.md`, `t-items-T1-w2.md`,
  `t-items-T2-w2.md`, `t-items-T3-w2.md`, the per-row verdicts `t-final.json`, and the finding tables
  `t-w1-findings.md`, `t-w1r1-findings.md`, `t-w1r2-findings.md`, `t-w2b-findings.md`, `t-w2r2-findings.md`,
  `t-w2r3-findings.md` (R-3 tamper-only rows and R-4 unreachable rows were deleted with a `file:line`).

**The rows.** Columns: `row`, `group`, `path`, `line_after`, `line_before`, `kind`, `name_or_type`, `arm`, `arms`.
- Group **A**: covered before T, not covered after T, on a line T did not change: T deleted or changed the last test
  that executed it. Find that test in `D:/cxt/t-inv/tests/` (search for the function, the error code or the state that
  reaches the line) and what T did with it (the item id and its reason).
- Group **B**: not covered, on a line T added or rewrote.
- Group **C**: a function not covered before T and still not covered after T (outside `src/ui`).
- For a branch, `arm` is the 0-based arm index of the branch at `line_after` (`if` arm 0 = the then-branch, arm 1 =
  the else/fall-through; `cond-expr`, `binary-expr` (`&&`, `||`, `??`), `switch` (one arm per case), `default-arg`).
  For a function, `name_or_type` is its name (`(anonymous_N)` for a callback or arrow function at that line).

**Classify every row** (no sampling, no "and the rest are similar"; rows on the same condition may share one reason,
but each row id must appear in the table) into exactly one class:

- **D1 走不到：** no production caller path reaches the code at all (dead export, a branch whose condition is a
  constant, a function only tests used). Proposal: what to delete.
- **D2 不会发生：** callers exist, but the state that takes this arm cannot arise: an upstream check refuses it first,
  the type or the codec guarantees it, or the only writer never writes it. Give the `file:line` that guarantees it.
  Proposal: what to delete (and whether the remaining code then simplifies).
- **U 只有篡改才会发生：** only a record written outside the platform's owners (a hand-edited or corrupted store, a
  foreign writer, an old-format record) reaches it. Proposal: delete the guard, or keep it untested (AGENTS rule 4: no
  new test that tampers); say which and why.
- **F 外部故障：** reachable through a real external event: an IO, disk or store failure, a process crash or restart,
  a timeout, a cancellation, a concurrent writer, a model or provider error. Test gap. Proposal: the public steps plus
  the fault injection or seam that reaches it (a backend seam or fault wrapper the tests already use, with `file:line`).
- **G 公开步骤能到、没测：** reachable through public steps without any fault. Test gap. Proposal: the public steps
  (route, tool or owner calls, in order) that reach it, and the existing test file it belongs in.
- **N 不适用：** a log or debug line, a type-only artefact, or code whose test belongs elsewhere (say where).

If the evidence does not settle a row, say **待定** and what would settle it; never guess. For group A, also name the
before-T test and the T item that removed or changed it; if T's deletion reason (tamper-only / unreachable /
duplicate) is wrong for this line, say so: that is a finding against T.

**Output.**
1. A table with one line per row: `row | path:line_after | kind | class | reason (file:line) | proposal | (A only) the
   before-T test and the T item`.
2. Counts per class.
3. Findings against T (group A rows where a reachable behaviour lost its only test because of a wrong deletion
   reason), each with the item id and the public steps that would restore it.
4. Rows of `ref/t-end-list.md` item 4 (L-2) that fall in your list, and your class for each.

**Your group: A3** — `lists/list-A3.tsv`, 42 rows (ids A3-001 … A3-042). Every id must appear in your table.
