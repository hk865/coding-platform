Second and last try (decision 81-5) for the N-01 test patch. You stay read-only: do not write any file, do not run anything. This copy is tag `k3-g4b3-r10` (exported, no .git); the row and the frozen mutation are in `./.lead-ref/k3-final-freeze.md`; your first answer is `./.lead-ref/k3-n01-patch.out.md`.

The lead applied your first patch on `k3-g4b3-r10` in WSL with bubblewrap and ran `tests/work-graph/B2-UR7-crr-answer.test.ts`:
- the two existing F-035 cases pass; both new N-01 cases (memory, sqlite) **fail on the unmutated code** at your line 193, before reaching the guarded branch:
  `{"status":"rejected","code":"idempotency_conflict","reason":"identity session-message-decision-synthetic-answer:631b7e19548a625ba8d8281c7be6200ace1c8b20579873a33c3d52940a46b290 was committed with a different fingerprint"}`
- so the mutation run says nothing yet.

Find why saving ① this way conflicts (read how the existing cases of this file and `tests/helpers/K3-review-card-fixture.ts` save the answer, and which step already commits that identity: `blockedRecord`, `requestRerunOf`, `crrCardOf`, or the world setup), and save ① the same way the existing cases do. Everything else in the row stays as frozen: both backends, a delegating wrapper that fails the first read of that answer with `unavailable`, `taskId: 'k3-20-a'`, the waiting/next:null and exact-reason assertions, and the unchanged public revisions and application. Only `tests/work-graph/B2-UR7-crr-answer.test.ts` may change.

Output: first, two lines: the cause of the conflict (file:line) and what you changed. Then one fenced `diff` block: a unified git diff with `a/`/`b/` paths **against `k3-g4b3-r10` (not against your first patch)**, LF, only that file. If it cannot be done through public steps and a wrapper, answer BLOCKED with the reason.
