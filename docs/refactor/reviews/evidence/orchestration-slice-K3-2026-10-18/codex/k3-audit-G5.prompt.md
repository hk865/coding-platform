You are a read-only auditor for the lead of this repository. Do not modify files. You may read and search; do not run tests or builds. Write the report in plain Chinese, with file:line for every code fact. **There is no length limit: completeness matters more than brevity.** One line per instance.

The working directory is the code of K3 group 4 session B3 after rework 8 (tag `k3-g4b3-r8`); there is no `.git`. This is **group G5** of a parallel audit; other runs cover the other groups. Your files: `.lead-ref/groups/G5.txt` (17 files, about 2824 lines).

Inputs in `.lead-ref/`:
- `test-rule-sheet.md`: the test rules v1. **Default deny**: only A1–A7 are allowed; F1–F12 give examples of the forbidden. It binds every test and helper.
- `k3-b3-rulings-v1.md`: the scope, a withdrawn ruling, rulings on rework 8's open points, and the known instances (canaries).
- `d1-k3g4b3-r8.txt`: the mechanical assertion ledger from before B3 to now. Do not re-list its lines; judge those in your files (see output 4).
- `b3-helpers.diff` and `groups/H.txt`: the helpers; another run audits them. Read every helper your files call, and give your own verdict on it.
- History, for context only: `k3-g4b3-impl.md`, `k3-g4b3-rework-6.md` … `-8.md`, `k3-g4b3-rework8-final.md` (its "independent audit" was a keyword search and found "0 defects"), `k3-g4b3-closeout-grep.txt`, `k3g4b3-review8.out.md` (your last capped review).
- Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`.

**Read every line of every file in your list. Do not sample.** A keyword search finds candidates only; then read by meaning: overwritten read results, spread-then-override, renamed helpers, values built in another file, stub ports returning built values, owner writes that the Runtime or Host normally make, a rejection row with two errors. If you cannot finish a file, list it under UNREAD; never call an unread file clean.

Output:
1. **COVERAGE:** one line per file in your list: file | tests in it | read fully? | rules hit (F-numbers), or "clean" | the helpers it calls, each with your verdict (A-number or F-number) | the title of the last test in the file.
2. **FINDINGS by rule:** rule | every instance (file:line, the test title, why it matches) | **ONE disposition** per instance: (i) the public path to use, naming the helper and its file:line (or "helper missing: what it must do"); (ii) move to a named `*-pure.test.ts` file, naming the pure function; (iii) delete, with the reason (AGENTS rule 4, or covered by file:line); (iv) T list, only for files the rulings put there. Never offer alternatives.
3. **ROWS:** for each spec row your files claim (K3-nn, B2-nn, UR, RUN-25 …): file:line | the literal it asserts and where the literal comes from (spec line or hand computation) | backends | whether removing the production check it guards would make it fail (name the check's file:line).
4. **LEDGER:** for each line of `d1-k3g4b3-r8.txt` that falls in your files: required by an earlier book item (name it), an equivalent move (the same assertion now at file:line), or a weakening (F12).
5. **CANARIES:** for each known instance in `k3-b3-rulings-v1.md` §4 that falls in your files: found at file:line, or why not.
6. **STATIC claims:** any "this cannot be reached through public steps" you rely on, with the exact public call sequence you tried and the line that refuses it.
7. **OPEN QUESTIONS** the rule sheet and rulings do not decide. Do not decide them; give the smallest options.
8. **SEARCH LOG:** the searches and reading checks you ran.

End with one line: `G5: files read X/17; instances by rule: F1 n, F2 n, …; open questions n`.
