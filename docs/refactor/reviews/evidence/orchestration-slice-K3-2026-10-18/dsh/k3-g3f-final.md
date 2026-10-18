All checks complete. Final reply:

## FILES CHANGED
- `src/contracts/core/prepared-execution.ts` — `renderUnknownCallReviewZh`: the `unexpanded` branch no longer `continue`s; it keeps the spec floor line and now also emits the full D6 sentence (same literal/indent as `truncated`). `truncated`/`full` output unchanged; trim order and floor rules untouched.
- `tests/scenarios/K3-42-unexpanded-r2.test.ts` — line ~170 now also asserts the full D6 sentence.

## RED → GREEN
- RED: K3-42 failed at line 170 (`这条命令没有全文…` absent; rendered tail showed only `- #1 shell：没展开，按判断不了处理。`).
- GREEN: K3-42 1/1; `K3-review-preparation` 8/8.

## CHECKS (`--maxWorkers=2`)
- Capacity set (K3-35 ×3, K3-48 ×2): 5 files / 10 passed.
- Every `K3-*`: **47 files / 243 passed**; `tests/architecture`: **3 files / 52 passed**. Combined run: **53 files / 339 passed, 0 failed**.
- `npm run typecheck`: exit 0. No model calls, no git writes.

## LITERALS
None moved. Added sentence measures 159 UTF-8 bytes/line; a 32-item floor grows 5,088 B, absorbed by the existing render→measure loop (K3-35 owner manifest still ≤262,144, all 32 aliases kept).

## UNSPECIFIED
Whether the added sentence shifts how many items K3-35's trim converts to `unexpanded` (no literal asserts that count; I did not measure it).