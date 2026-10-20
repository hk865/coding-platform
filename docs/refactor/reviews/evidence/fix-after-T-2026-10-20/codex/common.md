
## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This tree is the fix round after T (HANDOFF decision 86, drafted; the user decided it on 2026-10-20): five groups,
one commit each, built by DSH from the book `./.lead-ref/books/tf-book.md` on `tf-base` (`e99b385`, the T merge).
HEAD is `d4140be`. Commits: TF1 `d66c606` (triage deletions), TF2 `a127c23` (seven restored tests), TF3 `54f4744`
(AD08), TF4 `92b7404` (old browser workbench removed), TF5 `d4140be` (unused local names; DSH amended a type-only
change to `src/app/core-routes.ts` into it). This is the first audit: your findings become the frozen table for
rework 1 (at most three reworks, decision 80). Report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The book** `books/tf-book.md` (binding; read it in full) and `books/test-rule-sheet-v2.md` (binding for tests).
- **The rows** `rows-merged.tsv`, one line per TF1 row: part, row, class (`D1` no production caller reaches it, `D2`
  callers exist but the state cannot arise, `U` only a tampered or old-format stored record reaches it, `old-data`,
  `stale`), where (`path:line` in the base), DSH's result (`deleted`, `simplified`, `kept`, `BLOCKED`), files, DSH's
  note, kind, what, the judged reason, the judged proposal. (`tf-rows.tsv` is the book's input, `replies/tf1-rows.tsv`
  DSH's result.)
- **The restorations** `tw/tw-01.json` … `tw-07.json` (TF2): `restore` and `spec_basis`.
- **Your part:** `parts/<P>.diff` and `parts/<P>-files.txt`. The base version of every changed or deleted file is at
  the same relative path under `base/` (the 79 deleted `src/ui/` files are only listed, in `parts/src-ui-deleted.txt`).
- **DSH's reply** (claims, not evidence): `replies/tf-reply.md`; the ledger `replies/ledger.txt` (every REMOVED or
  LOOSENED test line between tf-base and HEAD; DSH maps them in its reply §5); `replies/tf5-before.txt` (the 290
  names TF5 removed).
- **Specs** are in the tree: `docs/refactor/design/orchestration-2026-10/slices/slice-*-SPEC.md` and
  `docs/refactor/design/orchestration-2026-10/STATE-MACHINES-SPEC.md`.
- **Tests:** the lead runs the bubblewrap full suite separately; you do not need test results. DSH's sandbox had no
  bubblewrap, so its environment failures are not evidence either way.

## For every row of your part and every hunk of your diff

1. **The row's result follows the book's §3 rules.**
   - `deleted` / `simplified`: the change is what the proposal says, no more. Behaviour on current-format data does not
     change (error codes, messages, check order); an exhaustive `switch` keeps its `never`; nothing a current writer
     produces is now refused. A change a public flow can reach is 会出错: name the flow and the input.
   - `kept`: the reason is one the book allows. D1/D2: the proposal says keep; a spec reserves the code (cite the
     spec line); deleting would narrow a frozen interface (a `src/contracts` type, an HTTP request or response type,
     an allowlist `wire-format` entry); or the proposal offers two ways and picks neither. U: the guard rejects a
     **damaged or foreign** record (an integrity guard). A U guard that tolerates an **old shape** (a field the current
     writer always writes being absent, a version or legacy branch, an "earlier versions" fallback) must be deleted
     under decision 79: kept is 违规. A D1/D2 row kept for another reason ("needs a change outside my files", "the
     lead decides", "no tamper test") is 违规 unless that reason really makes the proposal impossible within the
     book; say which. A row kept because the proposal offers two ways or leaves the choice to the lead: give your
     recommendation as 建议 (which way and why, with `file:line`); the lead rules.
   - `BLOCKED`: check the evidence against the code (does the named test really reach the state, how), then say which
     side is wrong: the row (the state arises through a public step: name it) or the test (it reaches the state only
     through hand-written facts, a T leftover under rule sheet v2: name the line).
2. **Every hunk belongs to** a TF1 row, a TF2 restoration, a TF3 step, a TF4 step or a TF5 name. A hunk nothing asks
   for is 违规, except an import the change needs or a compile fix the book allows (§2, last paragraph).
3. **Tests** changed in your part: no green by weakening (no `skip`/`only`/`todo`, no raised timeout, no loosened
   matcher); every ledger line in your files is named by a row or step, or replaced by an assertion at least as strong
   (a weaker replacement is 会出错, an unnamed deletion 违规). New or restored tests use only rule sheet v2 forms;
   expected values are literals from the spec or a hand calculation with the working in a comment.
4. **Comments** a deletion left untrue (naming a deleted branch, field, member or function) are 不整洁.

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 行 (a row id, `tw-NN`, `TF3`, `TF4`, `TF5`) |
   问题 | 唯一改法. Classes: **会出错** (behaviour changed, or left untested, or a test that passes without exercising
   its claim: give the input and why), **违规** (against the book, the rule sheet or a spec), **不整洁** (stale
   comment, dead code or import), **建议** (optional).
2. **Per row:** one line per row of your part: `<row>: OK` or `<row>: <P>-nn, …` (P6 to P8: one line per restoration,
   step or file instead).
3. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "row", "problem",
   "fix"}]`.
4. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
