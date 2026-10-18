You are a read-only auditor for the lead of this repository. Do not modify files. You may read and search; do not run tests or builds. Write the report in plain Chinese, with file:line for every code fact. **There is no length limit: completeness matters more than brevity.** One line per instance.

The working directory is the code of K3 group 4 session B3 after rework 8 (tag `k3-g4b3-r8`); there is no `.git`. This is the **helpers run (H)** of a parallel audit; seven other runs cover the test files (`.lead-ref/groups/G1.txt` … `G7.txt`). Your files: `.lead-ref/groups/H.txt` (23 helpers, about 10,200 lines; `b3-helpers.diff` is B3's change to them). For `AG2b-collaboration-fixture.ts`, `K-boundary-facts-support.ts`, `S5-decision-fixture.ts`, `S5-goal-settings-support.ts`, `S5R2-c-support.ts`, `S5R2-d-support.ts` and `WP1-entry-fixture.ts`, B3 changed only a few lines: audit those changed lines and what they let callers do. Read every other helper whole.

Inputs in `.lead-ref/`: `test-rule-sheet.md` (the test rules v1: **default deny**, A1–A7 allowed, F1–F12 forbidden examples); `k3-b3-rulings-v1.md` (scope, the withdrawn ruling, rulings on rework 8's open points, known instances); `d1-k3g4b3-r8.txt` (the mechanical assertion ledger); history for context: `k3-g4b3-impl.md`, `k3-g4b3-rework-6.md` … `-8.md`, `k3-g4b3-rework8-final.md`, `k3-g4b3-closeout-grep.txt`, `k3g4b3-review8.out.md`. Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`.

**Read every line. Do not sample.** Read by meaning: a helper that takes a draft, item, event, cursor, position or prepared value; calls an owner write the Runtime or Host normally makes; opens a store and writes; returns built values through a stub port; overwrites a read result; or wraps a dependency in a way that is not A2, A3 or A4.

Output:
1. **HELPER TABLE:** one line per helper and per exported function: helper:function (file:line) | what state it produces and how | verdict: A1–A7, or F-number with the line | every caller (search the whole `tests/` tree, not only B3's files) | read fully?
2. **FINDINGS by rule:** rule | every instance (file:line, why) | **ONE disposition** per instance: the public path to use instead (an existing helper and its file:line, or "helper missing: what it must do, and which real steps it calls"), or delete. Never offer alternatives.
3. **CALLERS OUTSIDE B3:** test files not in B3's list that call a forbidden helper function (these join the scope).
4. **RUN-25** (rulings §3 item 2): can RUN-25 run on both backends through the shared harness? The public call sequence, or "unreachable because file:line".
5. **The real-mailbox option** (rulings §3 item 3): which helper gets it, and the exact real steps it must call.
6. **STATIC claims**, **OPEN QUESTIONS** (do not decide; smallest options), **SEARCH LOG**.

End with one line: `H: helpers read X/23; forbidden functions n; callers outside B3 n; open questions n`.
