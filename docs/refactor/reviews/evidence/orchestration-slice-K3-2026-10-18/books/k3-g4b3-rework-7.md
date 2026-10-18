# Task: K3 group 4 session B3, rework 7 — the last preconditions, both backends everywhere, fixed capacity literals; coordinator mode; test-driven

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

Tag `k3-g4b3-r6` (HEAD) = rework 6 (book `./.dsh-ref/k3-g4b3-rework-6.md`, reply `./.dsh-ref/k3-g4b3-rework6-final.md`,
ledger `./.dsh-ref/k3-g4b3-closeout-grep.txt`). Codex's quick check of rework 6: `./.dsh-ref/k3g4b3-review7.out.md`
(Chinese). Items 1, 5, 6, 7, 8 of rework 6 are done; UNSPECIFIED 1 (the `vi.spyOn` memory seam) is accepted. Everything
under `slice-setup..HEAD` (K3 groups 1–4) merges together, so every K3 file is in scope; files that are on the lead
branch and unchanged by K3 are not (see §3). Production code is done: if an item seems to need a production change,
stop that item and report it.

**Category (a) of rework 6 §1, narrowed (lead ruling).** A built value counts as "the input under test of a rejection
or validation row" only when the row asserts that the owner refuses it, and **every state the row needs before that
input is reached through public steps**. A built classification, draft or record committed first to set up a later
rejection is a precondition, i.e. a defect.

## 2. Items (binding; Codex's points in `k3g4b3-review7.out.md` "剩余必须改")

1. **K3-06.** `K3-06-mixed-kinds-owner.test.ts` ~110, ~115, ~206 commits a hand-built classification before testing
   the illegal draft. Reach that state through the shared public steps; keep the illegal draft as the input under test.
2. **K3-26.** `K3-26-unknown-call-review-storage.test.ts`:
   - ~200, ~212: the same pattern as item 1.
   - ~302, ~307, ~318: a 32-item draft committed and then read as record and card. Use a reachable state through the
     public steps, or a pure test with no store for what the real path cannot reach; say which and why.
   - ~544, ~558: records built for the claim; use the public steps.
3. **K3-review-workflow-rows.** `K3-review-workflow-rows.test.ts` ~243, ~304, ~434 feeds hand-assembled reviews to a
   Workflow on real storage. Produce them through the shared public steps, or, for a combination the real path cannot
   reach, a pure test with no store.
4. **Both backends for every service-layer scenario** (spec ~1374; Codex's rejection of rework 6's UNSPECIFIED 2).
   - **Scope:** all 29 `openK3ReviewCardWorld('sqlite')` sites in these 11 files:
     - `K3-29-startup-reconcile-2b`, `K3-29-startup-answers`
     - `K3-18-requeue-confirmed`
     - `K3-41-disposition-proof`
     - `K3-15-list-by-task`
     - `K3-48-3-required-writes`
     - `B2-01-task-read`
     - `K3-35-owner-manifest-trim`
     - `K3-17-disposition-replay`
     - `K3-review-workflow-rows`
     - `K3-46-review-advance-failures`
   - **Rework 6's own changes:**
     - the memory rows rework 6 turned into SQLite (`./.dsh-ref/rework6.diff` ~1324, ~1337, ~2696; find them in the
       file) go back to both backends;
     - the new K3-18 file-fault row (`K3-18-review-card-queue.test.ts` ~424, memory only) runs on both.
   - **The only exception:** a row whose test entry in spec §5.1 needs real SQLite (R1: the Host is shut down and a new
     one starts on the real database and lease files). Name the row and the entry for every such case.
5. **Capacity literals.** `K3-48-3-extremes-pure.test.ts` ~47, ~48, ~95, ~98 builds its data from the production
   constants, so a wrongly raised limit would loosen the test. Use the spec's fixed values `158_720` and `524_288` as
   literals, and assert separately that the exported constants equal them.
6. **The ledger.** Rewrite `./.dsh-ref/k3-g4b3-closeout-grep.txt` with category (a) as narrowed in §1. Re-check every
   (a) and (c) hit in K3 files, including Codex's ledger lines ~101, ~105, ~107, ~123 and ~170. A hit that fits no
   category is fixed in this round, not listed.

## 3. Not this round (T list)

These files are on the lead branch and unchanged by K3: `B2-execution-fixture.ts` (~211, ~225, ~232, ~301),
`B2-model-request.test.ts` (~14, ~39), `B2-execution-result.test.ts` (~98, ~105), `B2-runtime-fixture.ts` (~194–197).
The earlier T list stands as well: K3-11, K3-14, K3-45, the non-proposal part of K3-48-2, K-R-close-open-turn,
B2-execution-entry. In the ledger, list these files under category (d), with this section as the reason.

## 4. Checks

As rework 4 §3: exact file lists, one vitest command at a time, `--maxWorkers=2`; then typecheck, check:architecture
and build. No real model calls, no git writes, never ports 3080/3099/44797.

## 5. Reply

Under 800 words:
- per item, RED → GREEN or how it was checked;
- the sites of item 4 with their backends, and every R1 exception with its spec row;
- the ledger's counts per category;
- helper lines before (5,209) and after;
- the checks, with numbers;
- UNSPECIFIED.
