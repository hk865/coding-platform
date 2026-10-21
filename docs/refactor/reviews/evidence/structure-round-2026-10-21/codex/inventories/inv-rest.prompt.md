# Inventory for the structure-round task book: D2, C2, C1, A6

$(COMMON)

## The four items (rows in `./.lead-ref/d84-condensed.md`; re-locate on this tree)

- **D2** tool assembly in one place: the optional tool names, dependencies, factories and the final registered list
  are spread over the Work and Query assembly paths (then `execution-driver.ts:246`, `query-execution.ts:218`,
  `observed-model-run.ts:288`). One tool-group assembly module with one output shape; the per-call-kind eligibility
  stays explicit. Keep the Work / copy / review allowlists, the order of names Kernel receives, failure behaviour.
- **C2** the activity family's "new budget → watermark before → read → watermark after → at most four tries" flow
  exists in four copies (then `activity-read-model.ts:780`, `:805`, `track-read-model.ts:1186`,
  `task-state-timeline.ts:556`). One stable-window executor inside the activity family; callers supply the window
  read and the error mapping.
- **C1** the note read model and the note write service import each other (then `note-read-model.ts:58`,
  `note-service.ts:36`). Move `readAllRecords`, `readAllHeads` and narrow types down to a note base reader; pure
  rendering into a pure module. Keep paging to the end, failure mapping, decode order.
- **A6** the activity replacement rule shared by Work and Query lives in the Run-only owner (then
  `run-activity-service.ts:151`) and takes a whole `RunActivitySnapshot` while reading only `facts`. Extract the pure
  replacement policy with narrowed parameters; Run and Query keep their own identity and transactions.

## Answer, per item

1. Current code: every piece to move or merge, `file:line` ranges, and every caller (production and tests).
2. Target: new module paths, exports with exact signatures, what stays where; which existing exports must stay
   importable from their old module (who imports them, file:line).
3. Preserve list specific to the item: texts, codes, order of checks, read counts, retry count and its stopping rule,
   field presence, list order. Point out any copy that differs from the others in a way that matters (so it must
   stay separate or take a parameter) — quote both places.
4. Tests that cover the behaviour today (file and test name) and gaps where a behaviour change would go unseen.
5. Estimated added+deleted lines; files touched; overlap with SC's files, with D3 (context assembler split, see the
   frozen spec `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md` §0.4) and with each other.
6. Risks; recommend skip or narrow where behaviour-identical is not achievable without a test change.

Then a proposal: DSH groups of 600-1,200 added+deleted lines in which no two groups edit the same file, their order,
and the interface each earlier group must freeze for later ones.

End with a last line exactly: `D2 N 行，C2 N 行，C1 N 行，A6 N 行，和 SC 重叠文件 N 个，风险 N`
