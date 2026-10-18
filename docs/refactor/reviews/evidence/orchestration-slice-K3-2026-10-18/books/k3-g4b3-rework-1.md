# Task: K3 group 4 session B3, rework 1 — Codex's review (twelve items); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`, **read its section "How tests reach their state: no hand-written facts" first; it
is binding for every test in this rework**); no fixed limit on subagents at once (decision 76), files disjoint, every
vitest command `--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 240
minutes** (the run stops at 250). Finish whole items; an unfinished item is reported, not half-done. Delete
`./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is

Tag `k3-g4b3` (HEAD) = session B3 (book `./.dsh-ref/k3-g4b3-impl.md` with the lead's 10 answers in its §8; your reply
`./.dsh-ref/k3-g4b3-final.md`). The lead's bwrap check of B3: 325 test files, 5,764 passed — **including both A8-3n
tests**, so the A8-3n failure in your sandbox was the missing bwrap (Codex item 13 is closed). Codex's review:
`./.dsh-ref/k3g4b3-review.out.md` (Chinese, items 1–13 with file:line and the fix approach). Spec:
`docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (L19a, L19, L20, §2, §3.2b, §5.2 B2-01..B2-18,
K3-35). Everything B3's book says still holds unless an item below changes it.

## 2. Items (binding; Codex's numbering)

1. **The binding and the task read.** No silent cap: the binding carries every blocked command of the task's records
   (drop the 32-entry cut in `execution-preparation.ts` ~285 and the `<=32` comment on the contract). The task-form
   `listReviews` fixes its merged page window and cursor **before** filtering by task (Codex's a201/z example must
   return a201). The binding and the continuation's blocked lines use the same read result.
2. **One recognition function** used by the hook and the request tool (`command-recognition.ts`; the hook's own
   matcher in `execution-driver.ts` ~524 goes). It collects every hit — exact, action, current-`package.json`
   expansion, declared form — and picks the first by (record creation time, alias) (K8-6). A `package.json` read
   failure cancels only that expansion, never the whole recognition (so a valid `rewriteOf` with an unknown script
   still requests). The request side also matches the stored `declaredForms`, so the hook and the tool never disagree.
3. **Directories, expansion basis and caps.** Leaving a pipeline element restores the outer directory
   (`echo x | cd app; npm run x` reads the outer `package.json`). Expansions are keyed by (directory, script name), not
   by action text. **Each expansion level is its own `expansions` entry with its own `basis`** (the second level's
   `action` is the first-level action that produced it); never fold a second level into the outer entry. A cut
   `scriptText` sets `truncated: true`. The 16 KiB measure counts every new field (`reviewRunId` included) and every
   cut reason.
4. **`closed` derived the same way everywhere (ruling 4).** One derivation from the canonical task facts
   (`plan-readers.ts` ~2200: satisfied, cancelled, superseded — not only the plan disposition), read once per task per
   operation and shared by the CRR list, the card source, the request tool, the hook, `consumeAllowance` (no hard-coded
   `taskActive: true`) and `prepare`. A read failure is `unavailable`, never "still valid". The next owner operation
   persists CRR-06 through the state module.
5. **The card shows its full text.** Put the full card text (the blocked command from the Kernel, this request's form,
   the reason, the stored `match`, the `declaredForms`, the earlier requests and answers, the fixed sentence) into the
   public card exactly as the UCR card does, and assert the public card in B2-07. Earlier requests = created before
   this request (not "all except this one"), at most 5, newest first.
6. **UR7's failed-card set covers both kinds (answer 7).** An internal discriminated set that accumulates failures of
   `unknown_call_review` and `command_rerun_request` cards within the continuous selection; the ordinary advance skips
   both kinds of failed cards; a later failure never overwrites an earlier one; the named-task advance keeps its
   waiting rules; the set stays internal (B1 rework 4).
7. **Reads per request call exactly as B2-18.** The paging port reads one physical page per call; the request tool
   reads the task's request set once (⌈R/200⌉ pages, the existing `lookup-all.ts` helper where it fits) and uses that
   set for the alias, the refusals and the declared forms. With 401 requests on one alias: exactly 3 pages.
8. **The request owner's return contract (lead ruling, replaces the B3 signature).** Never report `committed` without
   a real commit cursor (`contracts/core/results.ts` ~5). The owner returns
   `CommandRerunRequestReplyV1 = { status: 'not_written'; outcome: { status: 'not_blocked' } | { status: 'pending';
   requestId } | { status: 'allowed'; requestId } | { status: 'refused'; reason: 'denied_final' | 'denied_in_this_run' } }
   | WriteResult<{ request: CommandRerunRequestV1; outcome: { status: 'requested' | 'pending'; requestId } |
   { status: 'refused'; reason: 'denied_final' | 'denied_in_this_run' } }>` — the second form for CRR-01 and CRR-07
   writes (and the usual error results: `invalid`, `capacity`, `unavailable`, conflicts). The tool maps both to L19a's
   result union. No-write branches still replay through the Kernel; no receipt for them (ruling 3). Write this
   type in `model/command-rerun-request-contracts.ts`.
9. **Omitting the blocked section.** The count line is its own last entry. Each candidate is measured together with
   the omission note. Remove the count line first, then command lines from the last; each removed command line is
   counted in the note, including on the early-return paths (`continuation-brief.ts` ~405–419, ~532). Case: 17
   blocked commands where removing only the count line fits → all 16 lines stay.
10. **No hand-written facts in the fixtures (coordinator-mode section).** Rebuild through public steps:
    - **K3-35's anchors:** the 8 anomaly anchors come from real interrupted runs archived through the public archive
      path with the workspace capture made to fail (fault injection) — the same path the A8-3n "closing unsupported"
      scenario and the slice-1 anchor tests use; reuse their helper. The continuation Run, its claim and attempt come
      from the real requeue/claim path; `prepare` reads through the real readers (no stand-in reader). Keep the hand
      totals; re-derive them if the reachable facts change a byte.
    - **Blocked-command fixtures** (`tests/helpers/K3-blocked-command-fixture.ts` ~74, `tests/helpers/B2-blocked-
      runtime.ts` ~214–230): the Kernel command facts come from a real Work Run whose `shell` call goes through the
      stand-in `shell` of §5.1; answers are saved through `decisions/answer` before they are applied.
    - Extreme values public steps cannot reach stay only in the pure-renderer and parser tests.
11. **Missing and weakened rows.**
    - **B2-09b** at R4 with L29's SQLite Host crash fixture: a real approval → `consumeAllowance` commits → crash before
      the `shell` starts → restart: the allowance is used, the call is `outcome_unknown`, and it enters the K3 review.
    - **B2-15** at R4: the same Kernel call that was blocked through an expansion is replayed after `package.json`
      changes → the original `hook_blocked` result, no re-parse, no re-read; and a no-write request result replays
      through the Kernel.
    - **`rewriteOf` prefix ambiguity:** production run ids are UUIDs (`create-platform.ts` ~987); make two records
      whose runIds share 8 characters through the public claim with an injected id generator (an injected dependency,
      not a fact) → `invalid` listing both full runIds.
    - Restore the whole-block literal equality of the required part that B3 removed (`b3.diff` ~8871) and assert the
      blocked section as one literal where the rows give it.
12. **Shared helpers instead of second copies (decision 75; Codex's suggestion, done here).** One revision guard (the
    S5 one, `goal-settings-service.ts` ~97); one receipt replay helper (receipt read, event decode, identity check,
    result projection) used by the UCR and CRR owners and absorbing 4C-2's exception handling (`note-service.ts` ~545);
    the UCR codec field checks reused by the CRR codecs; one source-identity parse (card ~222 and codecs ~448); index
    names imported from the contract. Keep every CRR-specific field, event and index. Report the production line count
    before and after this item.

## 3. Checks

`--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/B2-*.test.ts`, `tests/**/K-*.test.ts`,
`tests/**/S5*.test.ts`, `tests/**/S4C2-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`,
`tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`, `tests/composition/`, `tests/app/S4C*.test.ts`,
`tests/architecture/`, `tests/runtime/`, `tests/**/*brief*.test.ts`, the changed files; `npm run typecheck`,
`npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected (no bwrap; A8-3n
included). The close-out subagent greps the new and changed tests for hand-written facts as the coordinator-mode
section says and reports each hit. No real model calls, no git writes, never ports 3080/3099/44797.

## 4. Reply

Under 900 words: files changed (production net per item; tests), each item RED → GREEN or how it was checked, the
production line total of B3 before and after (against `k3-g4b2-r1`), the K3-35 totals, the fact-grep result, checks
with numbers, UNSPECIFIED.
