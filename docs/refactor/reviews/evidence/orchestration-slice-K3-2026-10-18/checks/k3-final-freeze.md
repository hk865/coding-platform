# K3 group 4 B3: final freeze (decision 81-3), lead 2026-10-18 ~21:15

Source: Codex full list `codex2/k3-final-list.out.md` (on `k3-g4b3-r10`), independent recheck `codex2/k3-final-recheck.out.md` (decision 81-2): categories 5/5 agreed, closures agreed, no missed 会出错; one correction (F-021's mutation proof). No 会出错 row remains, so **no DSH rework 3** (81-3: only test rows left).

## Open rows (final; no further rulings are added)

| id | category | disposition | who |
|---|---|---|---|
| N-01 (`K3-44-crr-kind4:292` replaced the saved-answer read failure by a ③ commit failure) | 缺保护 | New case in `tests/work-graph/B2-UR7-crr-answer.test.ts` (both backends, the existing UR7 world): public `answerDecision` saves ① only; inject one `unavailable` at the Workflow's `decisionMessages.readDecisionAnswer`; `taskId: 'k3-20-a'` with the real answer refs; assert `status: 'ready'`, `value.state: 'waiting'`, `value.next: null`, the exact reason, and that the public request/message revisions and application are unchanged. | Codex test patch (81-5) |
| F-067 remainder (full hand calculation of the prefix C) | 只是写法 | The capacity guard holds (mutation M2 kills it). The remaining hand arithmetic goes to T (80-6: form-only rows to T); not Opus. | T |
| N-02 (`K3-review-preparation:192` `[1,2,3]` → `[1]`) | 只是写法 | Accepted as option (a): the real single-item record stays `[1]`; the multi-item mapping stays in `K3-review-input-pure:94`. Recorded as an approved replacement, not an equivalent move. | lead (this note) |
| N-03 (`K3-44-crr-kind4` old projection asserts A21, A22, A24, A28–A31, A34) | 只是写法 | Accepted split: the two real-Host cases guard the automatic hand-over and its public result; `B2-UR7-crr-answer:162–174` guards the real ②③ replay; the old report-projection asserts are not restored. Recorded as local deletions. | lead (this note) |
| N-04 (five new timeouts: `K3-44-crr-kind4:290, 340`; `B2-09-crr-owner:524, 536, 548`) | 只是写法 | Recorded into the F-055/T record; limits unchanged. | T |

## Frozen mutation for N-01 (the test writer may not change it)

M1, `src/business/workflow/workflow.ts` (lines at `k3-g4b3-r10`):

```diff
-      if (result.status !== 'ready') {
-        hardFailure = true;
-        cardFailure = true;
-        addFailedCardRef(failedCards, card);
-        if (failure === null) failure = dispositionReadFailure(result);
-        continue;
-      }
+      if (result.status !== 'ready') continue;
```

With M1 the new case must fail on the `waiting` / `next: null` assertion and on the exact-reason assertion (STATIC expectation: `advance`, `select_work`, `reason: null`). Without M1 it must pass on both backends. The zero-write assertions alone do not kill M1.

## Corrections and T

- F-021 stays closed; its proof: removing only `command-expansion.ts:133`'s catch is not a valid mutation (the reader throw is already turned into `unavailable` at `command-recognition.ts:86`); removing both conversions makes `B2-12-recognition:180` receive `rejected`.
- Stay in T: G3 (`K3-B3-runtime-fail-closed:28, 48` test only the reader), G5 (`K3-B3-shared-rules-pure:56, 59` compare production keys with themselves), F-066 (ruling 6), `K3-48-2:213–217` (hand-encoded UnknownCallReview), `B2-blocked-runtime:260–271` (hand-built WorkspaceFile), the form-only rows of book 9b §1 and book 10 ruling 2.
- Accepted: the claim-only steps local to `K3-review-preparation` and `K3-12-review-round-tools`.
