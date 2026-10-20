# T coverage triage — run summary (decision 79-4)

## Pass 1 (all done, all `ok`)

- `tw` (VERIFIER): 8/8 — tw-01 … tw-08, 19 rows.
- `dis` (JUDGE): 29/29 — dis-01 … dis-29, 167 rows.
- `skep` (SKEPTIC): 28/28 — skep-01 … skep-28, 276 rows.

No batch was missing, invalid or re-briefed; every pass-1 file passed `check-out.py`.

## Pass 2 (all done, all `ok`)

- `vt-dis`: 0 batches — no `dis` row carried `t_reason_wrong: true`, so `--pass2` named none.
- `tie-skep`: 11/11 — tie-skep-01, -10, -11, -13, -15, -18, -23, -24, -25, -27, -28;
  29 challenged rows (refuted or proposal_ok false).
  No `tie-skep` batch failed or was skipped.

Checker last line: `65 pass-1 files, 11 pass-2 files expected; 0 with problems`

## Not done / not ok

None.

## Rows reports could not settle (leads for the lead)

- dis-01 / A1-004 — class D2, winner neither; its before-T coverage looks like A1-003's corrupt-receipt fall-through, not a real "unsupported" arm.
- dis-11 / A2-047, A2-048 — which duplicated list entry is the outer vs inner alternate is not recoverable from the list; both G with the same cases.
- dis-12 / A3-006 — F now; becomes D2 if adapter re-pointing across restarts is ruled unsupported.
- dis-26 / C3-123 … C3-129 — D1; pinned TypeScript 6.0.3 internals are absent from the copy, so only in-repo call surface was checkable.
- skep-01 + tie-skep-01 / A1-007 — U stands; old-test attribution (TP-100) is inferred, no per-test map.
- tw-01 (report note, not a row) — IN05 appears red at e99b385; worth a separate check.
