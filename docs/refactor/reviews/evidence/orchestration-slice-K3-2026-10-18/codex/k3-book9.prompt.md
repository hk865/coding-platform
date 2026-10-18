Read-only review of a rework book before the build: `./.lead-ref/k3-g4b3-rework-9.md` (K3 group 4 session B3, rework 9; this copy is tag `k3-g4b3-r8`). No length limit. Answer in Chinese. Do not write any file, do not run tests.

Inputs: the book; the binding test rule sheet `./.lead-ref/test-rule-sheet-v3.md` (ignore the other rule-sheet files in that folder); your own merge `./.lead-ref/k3-merge.out.md` (the finding table's text, `M§n`); `./.lead-ref/k3-line-scope.txt` and `./.lead-ref/pre-k3-files.txt` (the scope classification); `./.lead-ref/k3-b3-rulings-v1.md`; the spec `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`; the code.

This is a rework book: answer only items 1, 2, 4, 5 and 7 of the template below, and only for the book's NEW rulings (its §2 rulings 1–21 and the rows `F-098`–`F-101`); the rows `F-001`–`F-097` were your own text and are not re-reviewed.

1. Every file:line the book cites: ok / wrong (the right place).
2. Each ruling: the functions it changes, ALL callers, ALL downstream readers of its value; each place where the book leaves something to the implementer, or OPEN.
4. Reachability, STATIC, per ruling where it matters. In particular:
   - ruling 6: can the real shell definition from `createShellToolDefinition(sandbox)` with the pass-through sandbox of `tests/scenarios/support/process-sandbox-standin.ts` (made to answer `available`) be registered and called through the real Runtime by a scripted model, and does a gate at the handler's entry come after `tool.started` is committed? Which capability or probe path decides whether the shell tool is offered, and does the stand-in satisfy it? Which test files mock the process sandbox today (list all), and does any of them need something the one helper does not give? Can a row about an unknown outcome keep the call held while the Run ends, is cancelled or the Host is abandoned, with today's public steps?
   - ruling 7: does `restart({ crash: true })` in `tests/scenarios/harness.ts`, plus a real step held at a boundary, give each crash `F-044` and the other rows name? Name any row it cannot serve.
   - ruling 8: for `F-066`, `F-067` and `K3-48-3`, which budgets come from a Host or Runtime configuration value (file:line), and which do not; for those that do not, the largest input the public steps accept versus the budget (hand arithmetic).
   - ruling 9: which rows' original timeouts are likely too short for the public path (say why, from the steps they run); do not guess numbers you cannot ground.
5. Each new production row (`F-098`–`F-101`): each await × resolve / reject / throw / abort → the required outcome; every caller.
7. Conflicts with earlier rulings (rework books 6–8, `k3-b3-rulings-v1.md`), with the spec, with the rule sheet v3 or coordinator-mode.md, and between the rulings themselves. Is the scope rule (ruling 1) applied consistently with M§2–§4?

End with "buildable" or the exact clauses to fix, each with the wording you propose.
