# Task: K3 group 4 session B3, rework 8 — the remaining K3 preconditions and an independent audit; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`; **read "How tests reach their state: no hand-written facts" (with "A name does not
change what it is") and "Before you build: what the reworks were about" first; both bind every brief**; the close-out
runs one vitest command at a time). Files disjoint between subagents, every vitest command `--maxWorkers=2`. **Do not
end your turn while a subagent has not reported back.** **Finish within 150 minutes** (the run stops at 160). Finish
whole items; an unfinished item is reported, not half-done. Delete `./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is

Tag `k3-g4b3-r7` (HEAD) = rework 7 (book `./.dsh-ref/k3-g4b3-rework-7.md`; its §1 narrowed category (a) and its §3 T
list still bind; reply `./.dsh-ref/k3-g4b3-rework7-final.md`; ledger `./.dsh-ref/k3-g4b3-closeout-grep.txt`).
Codex's quick check of rework 7: `./.dsh-ref/k3g4b3-review8.out.md` (Chinese).
- **Done:** items 1, 4 and 5 of rework 7.
- **Your UNSPECIFIED:** 1, 3 (the rejection rows), 4 and 5 are accepted; 2 is not (item 3 below).

**Category (a) once more (lead ruling).** (a) is only a value the owner *refuses* in that row. A built draft,
classification, review, Run, record or entered fact that the owner *accepts and commits* is never (a), whatever the
row goes on to assert. Neither is a read result that the test overwrites (for example `purpose`) or a Session field it
rewrites.

## 2. Items (binding; from Codex's check)

1. **K3-26 success rows.** `K3-26-unknown-call-review-storage.test.ts` ~398, ~426, ~544 commit a hand-built draft
   successfully and then read the record or the card. Reach them through the shared Host draft read and recognition
   (`K3-35-continuation-fixture.ts`, `reconcileUnknown` / `createRecord`). A combination the real path cannot reach
   goes to a pure test with no store.
2. **K3-26 weakened row.** ~508/~511/~514: the input passes one unrecorded call *and* `itemsOmitted: 1`, so the row
   would pass even without the "must be a recorded call" check (`run-reconcile-service.ts` ~283, ~286). Set
   `itemsOmitted: 0` so that the only error is the unrecorded `call-9`; the wrong-count case stays its own row (~519).
   Also retitle ~376 as the 33-item over-limit case.
3. **K3-26 RUN-25 rows** (your UNSPECIFIED 2). ~585 and ~617 rest on the entry facts that B2's `enter()` writes by hand,
   and the classification then commits (~601, ~636). Use a real entered Run and the Host classification path, or move
   the rows to a pure test. Do not change the T-list file itself.
4. **K3-review-workflow-rows, the default branch.** ~219, ~228 still use real storage with hand-built inputs; ~360,
   ~398, ~434, ~446 return hand-built reviews and Runs; ~254 rewrites the Session's occupancy. Every remaining scenario
   goes through public steps (as the `realOrigin` branch now does), or is split into a pure test with no store. Do
   not keep a branch that feeds built values to real storage.
5. **K3-19.** `K3-19-review-admission.test.ts` ~39, ~54, ~56 prepares an ordinary Run and then overwrites the
   trusted read's `purpose`. Use a real review / proposal Run (public claim and prepare) as the precondition. Move
   an inconsistent combination the real path cannot produce to a pure test of the admission function.
6. **Independent audit, then the ledger.** Before the close-out, start a fresh subagent whose only job is to read
   every K3 test and helper (`tests/**/K3-*`, `tests/helpers/K3-*`, and the K3 parts of the B2 helpers) and list every
   place that does any of:
   - commits or returns a built value the owner accepts;
   - overwrites a read result, record or Session field;
   - writes state with no public step.

   It reports file:line and why; it changes nothing. Fix every hit in this round (except the T-list files of rework 7
   §3), then rewrite the ledger with (a) as in §1 above, and add the audit's list with what became of each hit. The
   ledger also lists the files of the K-* check set and how it differs from rework 6's (your UNSPECIFIED 5).

## 3. Checks and reply

Checks as before: exact file lists, one vitest command at a time, `--maxWorkers=2`; then typecheck, check:architecture
and build. No real model calls, no git writes, never ports 3080/3099/44797.

Reply under 800 words:
- per item, RED → GREEN or how it was checked;
- the audit's hit count and what became of each group;
- the ledger's counts per category;
- helper lines before (5,237) and after;
- the checks, with numbers;
- UNSPECIFIED.
