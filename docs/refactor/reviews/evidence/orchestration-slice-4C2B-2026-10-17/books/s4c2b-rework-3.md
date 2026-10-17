# Task: slice 4C-2 session B rework 3 — three small findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The books and the
lead's rulings are binding; do not make design decisions; report anything undetermined under UNSPECIFIED with the
smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), at most 3 subagents at once, every vitest command `--maxWorkers=2`. **Finish within
90 minutes** (the run stops at 100).

## 1. What this copy is

Tag `s4c2-b3` (HEAD) = session B after rework 2 (book `./.dsh-ref/s4c2b-rework-2.md`, your reply
`./.dsh-ref/s4c2b-rework2-final.md`). Codex's quick check (`./.dsh-ref/s4c2b-review3.out.md`, Chinese): three items
partly done; the lead checked item 1 in the code. Accepted: U7's test-only rewrite needs no production RED.

## 2. Items (binding)

1. **The catalog at most once per queue call, across goals** (production). The queue calls the note card source once
   per goal (`views/decision-read-model.ts` ~566), and each call's `userReasonFacts` builds a fresh `NoteCall`
   (`notes/note-service.ts` ~918), so two goals with module targets read the catalog twice; a retired (not found)
   module target also reads the catalog again for its candidate list (`notes/note-anchors.ts` ~672, `readCandidateCatalog`).
   Fix: the catalog window lives in the queue read attempt's cache (the `attempt.cache` the collection adapter already
   uses), passed through `createCollectionCardSource` to the note source and into `userReasonFacts`; a new attempt
   starts empty. The candidate list uses the same window (or is not built at all on this path — the reason facts only
   need "retired"; choose the smaller and say which). The write path and the scribe path keep their own per-call
   caches and their behaviour. **Test:** extend the real-queue read-count case: two goals each with a pending note
   whose target is a module note, and one target module removed from the catalog through the public catalog revision;
   catalog reads = 1 for the whole queue call, plan windows = 1 per goal; hand count in a comment; memory and SQLite;
   it must fail on today's code.
2. **The note-specific "ordinary disposition → incomplete" row** (spec L17, book §2.1 / S4C2-U3): through public
   entries on memory and SQLite: a real card answered (`decisions/answer`), then — before the application — the note
   receives an ordinary disposition through the public note service (e.g. the scribe's), and the application read
   (`resolveDecision` / the card read) reports the application as not recorded with the receipt facts `incomplete`
   (proof null), the card still "answered, pending application". It must fail if the `NoteDispositionChanged` decoder
   row accepted a null proof.
3. **Literal card keys and labels:** `tests/work-graph/S4C2-D-rows.test.ts` ~25 builds keys from parameters — write
   the keys the rows compare as literals; in `tests/scenarios/S4C2-U6-note-card-e2e.test.ts` D-01 (~70) add the two
   objects' labels as hand-written literals (the labels `notes/note-decision-source.ts` ~91/~98 produce). In your
   reply, correct the deleted-test mapping: the pointer-move case is covered by `S4C2-U6-note-card-e2e.test.ts` ~211,
   not D17.

## 3. Checks

`tests/work-graph/S4*.test.ts`, `tests/work-graph/S5*.test.ts`, `tests/scenarios/S4C2-*`, `tests/app/S4C*.test.ts`,
`tests/business/`, `tests/composition/WP2-wiring.test.ts`, `tests/architecture/` with `--maxWorkers=2`;
`npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected.
No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 400 words: files changed (production net; tests), each item RED → GREEN, checks with numbers, UNSPECIFIED.
