# The product owner's decisions of 2026-10-18 afternoon (lead's record)

Background. Under decision 80 Codex audited K3 group 4 B3 and L8 in full (K3: about 600 instances, 97 root rows
F-001–F-097; L8: KNOWN 1–5, T01–T71, P01–P16, S01–S12). The user asked whether all of Codex's findings matter to the
business. The lead had each finding classified by business consequence (a workflow of 8 Claude agents: one classifies,
one checks against the code; files `l8-business-classification.md` and, for K3, `k3-business-classification.md`):

- behavior_bug: production does something wrong a person or an agent can meet;
- protection_gap: no test guards a real business behavior;
- form_only: the test's form breaks the rule sheet, but another test on a real path guards the behavior;
- hygiene: no consequence anyone can see.

Result. K3 production 25 rows: 5 behavior bugs (only F-073 is met in normal use: a command-rerun card answered while
the Goal is paused, or after step ② fails, is never applied), 20 hygiene. K3 tests 76 rows: 20 protection gaps, 56
form-only. L8 55 items: 7 behavior bugs (K1 serious, fixed in rework 2; K2, P01–P04, P10 silent background failures,
kept as known limits), 2 protection gaps, 19 form-only, 27 hygiene.

## Decision 1 (about 16:40): K3's remaining rows

Question: "K3 剩下的一半（约 45 行）怎么做？" Answer: **"只做业务相关的（推荐）"**. K3 rework 9b does the in-scope
protection gaps (F-008, F-020, F-021, F-026, F-031, F-032, F-033, F-035, F-040, F-041, F-042, F-044, F-045, F-054,
F-066, F-067, F-097) and the new production row F-102 (`rewriteOf` matched only against the first hit, spec
`slice-K3-SPEC.md:539`); the form-only rows go to the cleanup round T.

## Decision 2 (about 17:00): how L8 ends

Question (after Codex verified L8 rework 3: 13 partly rows, 1 lost check, 17 new rule instances, 3 production
defects, one rework left under decision 80): "L8 怎么收尾？" Answer: **"只修业务相关的（推荐）"**. The last rework
fixes the three production defects, deletes the 15 new cases that hand-build driver commands, and restores the lost
check; the other form issues go to T; then L8 merges.

## A question in between

The user asked whether using internal commands in tests is bad in itself. The lead's answer: not in itself. Inputs
that really come from outside (public route bodies, a person's or an agent's input) and fault injection around a real
dependency are fine. A test that builds a value only the platform itself produces, in a way the real system never
produces it, proves nothing about real behavior, keeps unreachable code alive and pins the internal shape; that is a
form issue, not a business one. The 15 cases were deleted and the branches they guarded go to T (decision 79: code
nothing reaches is cleaned in T).

These decisions apply decision 80-4 ("其余经用户同意进 T"): the moves to T were made with the user's yes.
