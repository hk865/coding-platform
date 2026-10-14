# Task: slice 2A, round 4 — make the SQLite continuation seek its index

You are working in the slice copy (the current directory). Rounds 1–3 built slice 2A (round 3 is uncommitted in the
working tree; keep it). This is a NEW session. No git write commands, no network, no real model calls. Throw-away files
go under `./.dsh-scratch/` and are deleted at the end; never use `/tmp`. Finish within 60 minutes. Do not start
subagents.

Read first: `docs/refactor/design/orchestration-2026-10/slices/slice-2A-SPEC.md` L1 (the ordered lookup: request,
"返回哪些、什么顺序", "续读", "SQLite"), and `src/core/record-store/sqlite-record-store.ts` around :600–640.

## 1. What the lead found (binding)

The lead's acceptance check of query plans (L1, D3) shows that SQLite never seeks on the continuation. Measured on
200,000 rows of one prefix, asking for the page after row 199,700:

| SQL on the order column | rows visited | time |
| --- | --- | --- |
| `(E, ref_key) > (?, ?)` only (today) | the whole prefix | 14 ms |
| `E >= ?` (after.order) AND `(E, ref_key) > (?, ?)` | the page | 0.05 ms |
| `E >= ?bound AND E >= ?after AND (…) > (…)` | the whole prefix (SQLite seeks on the FIRST range term only) | 13 ms |

So SQLite cannot seek on a row-value comparison over expression columns, and with two range terms on one side it uses
whichever comes first. Paging to the end is therefore quadratic today.

## 2. The rule (lead ruling, replaces the L1 SQL wording for the continuation)

In the SQLite `lookupOrdered`, the order column `E` gets **exactly one lower range term and at most one upper range
term**, computed in code from the request; everything else on `E` stays as residual filters. Results must not change
on either backend.

Ascending (descending is the mirror: swap lower/upper and `>`/`<`, `max`/`min`):

1. Start from the request's `bound` (if any) as the lower term: `E >= bound.value` (inclusive) or `E > bound.value`.
2. If `after` is given, compare `after.order` with `bound.value` in code, with the SAME order the index uses (text:
   `Buffer.compare` of the UTF-8 bytes; integer: numeric):
   - no bound, or `after.order` is after `bound.value` → the lower term is `E >= after.order`; drop the bound term (it is
     implied); keep the row-value filter `(E, ref_key COLLATE BINARY) > (?, ?)` for the ties.
   - `after.order` is before `bound.value` → keep only the bound term; drop the row-value filter (it is implied).
   - equal and the bound is exclusive → keep only `E > value`; drop the row-value filter (implied).
   - equal and the bound is inclusive → the lower term is `E >= value` plus the row-value filter.
3. `integer` indexes: today the safe-integer range is `E BETWEEN -MAX_SAFE AND MAX_SAFE`. Split it: the lower term from
   step 1–2 replaces the `-MAX_SAFE` side when it exists (request values are already validated safe integers); the
   other side stays `E <= MAX_SAFE` (ascending). With no bound and no after, keep both safe-range sides as one lower and
   one upper term.
4. Keep every other condition (equality prefix, `json_type`, `<> ''`, `ORDER BY`, `LIMIT`) as it is.

Put the comparison in one small helper next to the request decoding so both directions share it. The in-memory
backend does not change.

## 3. Tests (TDD, through the public `lookupOrdered` of both backends)

In `tests/record-store/S2A-ordered-lookup.test.ts`, check which of these cases already exist; add the missing ones
with literal expected identities and `next` values (both backends, text and integer, ascending and descending):

- `after` after the bound (the normal continuation);
- `after` before the bound (results start at the bound — already in L1);
- `after.order` equal to an exclusive bound;
- `after.order` equal to an inclusive bound, with ties on the order value (ref_key decides);
- `after` only, no bound.

These may pass before your change (results do not change); that is expected — they guard the rewrite. Say which were
new.

## 4. Checks

1. `npm run typecheck` and `npm run check:architecture` pass.
2. `tests/record-store/` (all files) and every `tests/**/S2A-*.test.ts` pass, plus `S5R2-queue-history`,
   `WP2-context-extensions`, `WP2-undelivered-notices`.
3. The four frozen sha256 values from round 3 are unchanged (`DSH-BASELINE.md` `4133c9ee…`,
   `S5R2-queue-history.test.ts` `0f3b59a9…`, `WP2-context-extensions.test.ts` `348fe889…`,
   `WP2-undelivered-notices.test.ts` `ff6cf385…`).

## 5. Reply

Under 250 words: the helper and the SQL change (file:line); which test cases were new; test counts; the four sha256
values; `git status --short`.
