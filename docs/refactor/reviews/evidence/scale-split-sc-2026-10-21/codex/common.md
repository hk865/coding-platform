
## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This tree is the scale-test split SC (HANDOFF decision 86-6; the user decided it on 2026-10-21), built by DSH from
the book `./.lead-ref/books/sc-book.md` on `sc-base` (`20afbfa`, code identical to the lead branch `4a8a1400`).
HEAD is `efa2303`. Commits: SC1 `105ba68` (page widths and the scale batch; DSH amended into it a Goal-list seam in `views/goal-conflicts.ts`, see its reply §1.3 and §4 item 7), SC2 `efa2303` (the split of the twelve files). This is the first audit: your findings become the frozen table for rework 1
(at most three reworks, decision 80). Report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The book** `books/sc-book.md` (binding; read it in full) and `books/test-rule-sheet-v2.md` (binding for tests).
- **The inventory** `books/t-scale.out.md` (Codex's, Chinese; written before the fix round after T, so its lines may
  have moved a little; the book binds where they differ).
- **Your part:** `parts/<P>.diff` and `parts/<P>-files.txt`. The base version of every changed file is at the same
  relative path under `base/`; a new file has no base.
- **DSH's reply** (claims, not evidence): `replies/sc-reply.md`; the move check's output `replies/move-check.txt`
  (`scale-move-check.mjs`: a case of `sc-base` must appear verbatim, whitespace aside, at least as often in the daily
  file or its `.scale.test.ts`; it lists for review the hooks, headers and top-level statements of `sc-base` found in
  neither file). `OK` there is necessary, not sufficient.
- **Specs** are in the tree: `docs/refactor/design/orchestration-2026-10/slices/slice-*-SPEC.md`. The scale rows the
  split touches: 2A QA rows (`slice-2A-SPEC.md`), 2C-25 (`slice-2C-SPEC.md`), K3 B2-16 / B2-18, wiring-2 M07 / F07,
  slice-5 round 2 R2A07–09, T R-22.
- **Tests:** the lead runs the bubblewrap full suite and the scale batch separately; you do not need test results.

## What to check

**Production seams (book §3), wherever your part has them:**

1. **Default = today's constant**, and production passes nothing: every caller outside `tests/` builds the owner
   without the new field, so the default applies (name every production construction site you checked). The width
   changes only the size of one read batch: no total cap, no changed public input range (the decision queue's
   `page.limit` 1–100 with fallback 50, the archive list and the undelivered replies 1–100, the unknown-call review
   list 1–200), no changed stable-window retry. No validation code was added for a width.
2. **The path:** through the owner's existing dependencies object, narrowest path; **no** field on
   `TargetPlatformOptions`, Host config or HTTP types. B′: both `enumerateGoalCandidates` and
   `enumerateClosedGoalCandidates`, both narrowing aliases in `views/decision-read-model.ts`, both call sites. D
   reaches both the hook read and the request tool's read. F is `decisionPageLimit` only, not the anomaly-anchor
   budgets. I: every replaced `200` became `lookupPageLimit`, every replaced `100` `listPageLimit`, only in read loops
   that page to the end; the kept literals (`limit: 1`, `limit: 21`, `desc` heads, the chain lookup limit) are kept;
   `historyReadBudget` untouched; no seam H (`plan-readers.ts` Run lookups keep `LOOKUP_PAGE_LIMIT`).
3. **Mechanism (§2):** `vitest.config.ts` only gains the exclude; `vitest.scale.config.ts` has the same settings with
   the scale include; `package.json` only gains `test:scale` (exact text); `tsconfig.json` only gains the include; CI,
   `scripts/verify-isolated.mjs` and `scripts/check-boundaries.mjs` unchanged.

**The split (book §4), per file of your part:**

4. **The scale file** holds moved cases only, verbatim: same sizes, constants, backends, assertions, timeouts, names,
   fixture defaults, and no page-width injection. Every scale case of `sc-base` named in §4's table is in it (or, for
   QA-14(b), in the daily file as the book says). Each review line of the move check for your files: is it an
   intended change (say which) or a mistake?
5. **The small daily version** of each moved case: the same assertion shapes on the same behaviour; both backends
   (or the one the original used); **every read layer the case is about crosses at least two pages, and the decisive
   item is on the last page of every layer** (except where §4 says the rule does not apply); the page counts and the
   order are written by hand in a comment, and you recompute them from the sizes and widths: a wrong hand calculation
   is 会出错; expected values are literals, never a production constant or a production function; the widths are
   injected through the seam of §3 (name the injection line); the name carries the sizes. **A small case that would
   still pass if the paging were broken** (it never crosses a page in some layer, or the decisive item is on the
   first page, or the assertion does not depend on the last page) is 会出错: give the layer and the numbers.
6. **Fixtures:** existing fixtures are used; a new fixture parameter defaults to today's value, so every other test
   that uses the fixture is unchanged (`git diff` of `tests/helpers` against `base/`); no new hand-written facts, no
   converted seeds (ruling R-TF-2).
7. **No green by weakening:** no `skip`/`only`/`todo`, no raised timeout in a daily file, no loosened matcher, no
   deleted assertion that is not in the scale file verbatim.

Every hunk belongs to a seam of §3, the mechanism of §2, or a file of §4's table. A hunk nothing asks for is 违规,
except an import the change needs.

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 依据 (book section, table row, rule sheet rule
   or spec row) | 问题 | 唯一改法. Classes: **会出错** (behaviour changed, a default changed, or a small case that
   passes without exercising its claim: give the numbers and why), **违规** (against the book, the rule sheet or a
   spec), **不整洁** (stale comment, dead code or import), **建议** (optional).
2. **Per file:** one line per file of your part: `<file>: OK` or `<file>: <P>-nn, …`.
3. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "basis",
   "problem", "fix"}]`.
4. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
