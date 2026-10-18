# Task: K3 group 4 session B3, rework 2 — Codex's quick check (six items); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`, **its section "How tests reach their state: no hand-written facts" is binding for
every test here; read it first**); no fixed limit on subagents at once (decision 76), files disjoint, every vitest
command `--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 180
minutes** (the run stops at 190). Finish whole items; an unfinished item is reported, not half-done. Delete
`./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is

Tag `k3-g4b3-r1` (HEAD) = B3 rework 1 (book `./.dsh-ref/k3-g4b3-rework-1.md`; your reply
`./.dsh-ref/k3-g4b3-rework1-final.md`). Codex's quick check of it: `./.dsh-ref/k3g4b3-review2.out.md` (Chinese; items
1–12 with file:line and the fix approach, then its view of your UNSPECIFIED 1–8). The lead checked items 2, 7, 10 and
12 in the code; they hold. Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`. Everything the
earlier books say still holds unless an item below changes it.

## 2. Items (binding; Codex's numbering in brackets)

1. **[2] Recognition order.** Flatten every blocked command of every record first, then sort by (record creation
   time, alias, record ref key) and take the first hit. Today records with equal `createdAt` keep input order and only
   sort aliases inside each record (`command-recognition.ts` ~36). Test: two records with the same `createdAt` (an
   injected clock is an injected dependency), aliases interleaved → the lowest alias wins across both records.
2. **[4] Closed facts: required, read once per operation.** The task-closure reader is a required dependency of the CRR
   owner and of `prepare`; there is no "absent → open" default (`command-rerun-request-service.ts` ~374,
   `execution-preparation.ts` ~455); wire it everywhere composition builds them. Read the closure once per owner
   operation or hook call and pass it down; the paging loop (`command-rerun-request-service.ts` ~442,
   `execution-driver.ts` ~466) never re-reads it per page. A read failure stays `unavailable`.
3. **[7] The waiting form comes from the owner (lead ruling; replaces UNSPECIFIED 5).** The owner already holds the
   task's request set. Its no-write `pending` and `allowed` outcomes in `CommandRerunRequestReplyV1` carry the waiting
   request's `command` beside `requestId`; the tool uses it in L19a's text and the extra point read in
   `command-rerun-tools.ts` ~196 goes. The tool never substitutes the new input's command for the waiting form. B2-18
   then holds as written: R = 401 → 3 pages + 1 write, no other read.
4. **[10] No hand-written facts (coordinator-mode section).**
   - **B2-18** (`B2-18-request-reads.test.ts` ~108–121): the 401 requests come from real Runs of the task (public claim,
     the Run's `request_command_rerun` call or the owner with the Run's real context, a refusal through
     `decisions/answer` and its application, then the next Run through the public requeue/claim path). No made-up run
     ids, no unsaved answer refs. If 401 real Runs make the test slow, report the time; do not cut R.
   - **K3-35** (`K3-35-continuation-fixture.ts` ~382–440): no hand-built manifest, envelope or prepared input, no
     scaffold brief that leaves the anomaly section out, no hand-filled Kernel position. Every Run of the chain goes
     through the real `prepare` and runtime entry. Whatever anchors and sections the real path leaves for the K3-35
     continuation are the fact; re-derive the hand totals for that fact (show the arithmetic in the test comment) and
     assert them. The near-limit and over-limit cases that the real path cannot reach stay in the pure-renderer test
     with L20's worst case (UNSPECIFIED 1 accepted on that condition; UNSPECIFIED 2 rejected).
5. **[11] Rows that do not prove their point.**
   - **B2-15:** the command must match only through a `package.json` script expansion (not as a direct action of the
     original command; `npm run db:migrate` is one, `B2-blocked-runtime.ts` ~271). Block it through the expansion,
     change `package.json`, replay the same Kernel call → the original `hook_blocked`, no re-parse, no re-read.
   - **`rewriteOf` prefix ambiguity** (`K3-prefix-claim.ts` ~471–482): keep the injected id generator; the Kernel
     call facts come from real Work Runs through the stand-in `shell` of §5.1, not hand-built.
   - **B2-01 platform-only (UNSPECIFIED 3 rejected):** restore the deleted public-path assertion (`rework1.diff`
     ~8038) with an injected blocking non-process tool (an injected dependency, not a fact).
6. **[12] Remove the second copies (decision 75).** Report the production line count before and after this item.
   - UCR's own `pinRevision` (`unknown-call-review-service.ts` ~347) goes; UCR uses `revision-guard.ts`.
   - One set of `RunRef`, `TaskTriple` and `SessionMessageRef` field checks shared by the UCR and CRR codecs
     (`unknown-call-review-codecs.ts` ~92, `command-rerun-request-codecs.ts` ~84).
   - The multi-page watermark merge left in the CRR service after item 7 of rework 1 (`command-rerun-request-service.ts`
     ~475–482) and the old failed-card-set conversion (`collaboration-driver.ts` ~818, `workflow.ts` ~720) go.

UNSPECIFIED 4, 7 and 8 of your last reply are accepted; 6 is item 2 above.

## 3. Checks

`--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/B2-*.test.ts`, `tests/**/K-*.test.ts`,
`tests/**/S5*.test.ts`, `tests/**/S4C2-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`,
`tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`, `tests/composition/`, `tests/app/S4C*.test.ts`,
`tests/architecture/` (production reach included), `tests/runtime/`, `tests/**/*brief*.test.ts`, the changed files;
`npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected
(no bwrap). The close-out subagent greps the new and changed tests for hand-written facts as the coordinator-mode
section says and reports **each hit with why it is allowed**; "all allowed" without the list is not accepted. No real
model calls, no git writes, never ports 3080/3099/44797.

## 4. Reply

Under 900 words: production net per item and the B3 total against `k3-g4b2-r1` (before: +4,941/−394), each item
RED → GREEN or how it was checked, the new K3-35 totals with their arithmetic, the B2-18 test time, the fact-grep
list, checks with numbers, UNSPECIFIED.
