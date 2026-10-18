You are a read-only reviewer for the lead of this repository. Do not modify files. You may run read-only commands (search, reading files); do not run tests or builds. Write the report in plain Chinese, with file:line for every code fact.

The working directory is the lead branch 8d14dc95. There is no `.git`. Your check of the first draft of the L8 construction book is `.lead-ref/l8-book1.out.md` (items 1–9). The lead has revised the book: `.lead-ref/l8-impl.md` (rulings 1–12 in §2, tests in §3). DSH's read-through: `.lead-ref/l8-preread-final.md`. Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md` (L7, L8, AE2, A-03, A-04). Test rule: `.lead-ref/coordinator-mode.md`.

Quick check only:
1. For each of your items 1–9: resolved in the revised book or not (cite the ruling).
2. Anything the revision newly got wrong: in particular ruling 3's `requestSeq` / `satisfiedRequestSeq` watermark (can the observation capture read the request record at its start and commit the watermark into the pointer in the same commit; does a manual capture satisfy requests correctly; the guarded failure write), ruling 4's request identity, ruling 5's close and abort, ruling 1's single place every finalize passes (does one exist, or must two places call the same step), and §3's way to make a capture really fail.
3. Is the book now buildable without the builder making design decisions?

For each problem: what, evidence (file:line), consequence, and the fix approach (修改思路); mark "必须改" or "建议". End with one line: "可以施工" or "先改完列出的几处". Keep it under about 1,500 Chinese characters.
