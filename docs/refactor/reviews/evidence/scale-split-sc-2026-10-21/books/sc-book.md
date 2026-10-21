# Task: split the scale tests into a daily small version and a scale batch (lead, 2026-10-21)

You are working in a copy of the repository (the current directory): the lead branch after the fix round after T,
tagged `sc-base`. This is a NEW session. Read this book first, in full. Report anything you cannot understand before
you start (decision 56). **Finish within 300 minutes** (the run stops at 330). **This run is headless: when your turn
ends, the whole run ends. Do not end your turn while a subagent has not reported back** (wait with `sleep 300`, then
`list_agents`).

Work in coordinator mode (`./.dsh-ref/coordinator-mode.md`): subagents change the code; you split, brief, check the
reports, run the final checks and write the reply.

## 1. What this is

The slowest test files are scale tests: they build thousands of records on both storage backends (memory and SQLite)
to prove that an old cap is gone and that paging reads everything. The five slowest take a third of the suite's time.
On 2026-10-21 the user decided (HANDOFF decision 86-6): **split them.**

- **The scale batch** keeps every scale case exactly as it is: same sizes, same backends, same assertions, same
  timeouts, and **no page-width injection** (so it also proves the production defaults). It lives in files named
  `tests/**/<name>.scale.test.ts`, has its own vitest config and runs with `npm run test:scale`, once before each slice
  merge.
- **The daily suite** (`npm test`, also CI) runs a small version of the same case: same assertions on the same
  behaviour, both backends, with small internal page widths injected so every read layer still crosses pages.

Codex's read-only inventory is `./.dsh-ref/t-scale.out.md` (Chinese). It was written on the tree before the fix round
after T, so its `file:line` references may have moved by a few lines; find code by the symbol it names. It is the
source for §3 (seams) and §4 (per file). Where this book and the inventory differ, this book binds.

Binding background: the test rule sheet v2 (`./.dsh-ref/test-rule-sheet-v2.md`); root `AGENTS.md` rule 4. Do not edit
`docs/` (the lead writes the docs and the spec notes), `vendor/coding-agent/dist`, or the lock files.

## 2. The mechanism (group SC1, part 1)

1. `vitest.config.ts`: add `'tests/**/*.scale.test.ts'` to `exclude` (keep the rest unchanged).
2. New `vitest.scale.config.ts`: the same settings, `include: ['tests/**/*.scale.test.ts']`, the default exclude.
3. `package.json` scripts: add `"test:scale": "vitest run --config vitest.scale.config.ts --maxWorkers=1"`. The
   `test` script stays. (A script line does not change the lock files.)
4. `tsconfig.json` `include`: add `vitest.scale.config.ts` next to `vitest.config.ts`.
5. Nothing else in CI, `scripts/verify-isolated.mjs` or `scripts/check-boundaries.mjs` changes: they run `test`.

## 3. The page-width seams (group SC1, part 2)

Internal read-batch widths become parameters (the inventory's table "需要的生产接缝", rows A–G, plus B′ and I below).
Rules:

- **Default = today's constant** (the spec value). Production passes nothing and keeps the default; the scale batch
  injects nothing. A width controls only the size of one read batch: no total cap comes back, every public input range
  stays as it is (they differ: the decision queue's `page.limit` is 1–100 and falls back to 50, the archive list and the
  undelivered replies 1–100, the unknown-call review list 1–200), and the stable-window retries keep their meaning.
- **Thread it through the owner's existing dependencies object**, the narrowest path from where the test builds that
  owner to the read (`create…(deps)` and the reader's deps type). **Every one of the twelve worlds builds its readers
  in test helpers** (`owners(f, …)` in `tests/helpers/S5-application-support.ts`, `realDecisionQueue`, the fixtures):
  inject there. **Do not add a field to `TargetPlatformOptions`** and do not touch Host config or HTTP types. If a case
  can only be reached through `createTargetPlatform`, that case is BLOCKED: report it.
- The seams:
  - **A** `lookupAll(…, { pageLimit })` (`persistence/lookup-all.ts`), default 200;
  - **B** in `views/decision-read-model.ts`: `sourcePageLimit` (default 200) and `lookupPageLimit` (default 200), the
    latter for every path through A **and** for both candidate enumerations (B′);
  - **B′** `enumerateGoalCandidates` **and** `enumerateClosedGoalCandidates` in `tasks/plan-readers.ts` each get a third
    parameter `options?: { lookupPageLimit?: number }` that reaches `readLookupKeys` (give `readLookupKeys` an optional
    `limit`, default `LOOKUP_PAGE_LIMIT`). The decision read model calls them through two narrowing aliases,
    `enumerateCandidates` and `enumerateClosedCandidates` (`views/decision-read-model.ts`, near the top), each typed
    as a two-parameter function: add the optional third parameter to both aliases, and pass B's `lookupPageLimit` at
    both call sites (the live and the closed enumeration of the queue). Nothing else in `plan-readers.ts`: the Run
    lookups that share `LOOKUP_PAGE_LIMIT` (seam H) stay as they are;
  - **C** `lookupPageLimit` of `PlanningQuestionReaderDeps` (`tasks/planning-question-reader.ts`), default 200;
  - **D** `taskRequestPageLimit` (`tasks/command-rerun-request-service.ts`), default 200; it must reach both the hook
    read and the request tool's read (the latter goes through A);
  - **E** `orderedPageLimit` (`views/automatic-rework-notices.ts`, to `readOrderedToEnd`), default 200;
  - **F** `decisionPageLimit` (`views/context-extensions.ts`), default 100; not the anomaly-anchor 100/25 budgets in the
    same file;
  - **G** one `readPageLimit` for both inner layers of `views/undelivered-reply-notices.ts`, default 100 (split it only
    if a small case must tell the two layers apart; say so in the reply);
  - **I** in `views/work-line-reader.ts`: two widths, replacing the literal `limit: 200` / `limit: 100` **only in read
    loops that page to the end** (the active-Session list, the anchor and pickup-Run reads, the message scans the line
    counts use). The mapping goes by the literal, not by the kind of read: every replaced `200` becomes
    `lookupPageLimit` (default 200), every replaced `100` becomes `listPageLimit` (default 100), so no default changes.
    The archive list is not a seam: `readArchivedPage` reads one page with the public `page.limit`, and the test's
    own loop pages to the end. A literal that is a single read with a meaning (`limit: 1`,
    `limit: 21` for the closed-task history, `direction: 'desc'` heads, `VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT`) stays;
    list each literal you changed and each you kept, with the reason. `historyReadBudget` is a budget, not a width.
- **No validation code** for these widths (trusted test input).
- **No seam H** (the canonical task facts' Run lookup width): QA-17 (`S2A-queue-goal-runs.test.ts`) is not split.
- After SC1 every existing test still passes unchanged: nothing is injected yet.

## 4. The split (group SC2): twelve files

For each file below:

1. **Move each scale case verbatim** into the sibling `<name>.scale.test.ts`: its `it`/`describe`, the `beforeAll`
   world it uses (a copy, or a helper both files import), its imports. Do not change a size, an assertion, a backend
   loop, a timeout or a name. Non-scale cases of the same file stay in `<name>.test.ts`. A file whose every case is a
   scale case keeps no case in its daily file except the small versions.
2. **Write the small version** of each moved case in `<name>.test.ts`:
   - the same assertion shapes on the same behaviour, both backends (a case that ran on one backend only keeps that
     backend);
   - sizes chosen so **every read layer the case is about crosses at least two pages**, with **the decisive item on
     the last page** of every layer (the inventory's "建议" column gives a size for most cases: use it unless it fails
     this rule; §4's table names the cases where the last-page rule does not apply). Page counts that follow from the
     data size (QA-05's and QA-14's 101 pages, for example) are recomputed by hand for the small data; **only B2-16's
     structural "exactly 3 pages" stays 3**. Write each layer's order and page split in a comment;
   - inject the small widths through the seam (§3); never import a production constant or call a production function
     to compute an expected value: write the expected value as a literal with the hand calculation in a comment
     (rule sheet v2);
   - name it after the original with the sizes, e.g. `QA-05 (small: 5 cards, page 2) …`;
   - **use the file's existing fixtures** (ruling R-TF-2 of the fix round: a fixture's hand-written seeds are a known
     leftover, listed by the lead under decision 86-3; do not convert them and do not add new hand-written facts). If
     a fixture fixes a size, give it a parameter whose default is today's value.
3. Expected run time: each small daily file should take seconds to tens of seconds (the inventory's "预计时间后").

| file (under `tests/`) | scale cases (inventory section) | seams |
|---|---|---|
| `work-graph/S2A-notices-overbound.test.ts` | QA-10(ii) (§1). The directory read covers the **whole workspace directory** (the base fixture's Sessions, the created ones and the responder), not only the Sessions this world creates: write the full directory order by hand and put the one valid Session last in it; put the valid reply last in the reply layer and the valid source item last in the source layer. If the fixture cannot place them, give it a naming or order parameter | A, B, G |
| `work-graph/S2A-queue-derived-cards.test.ts` | QA-07, QA-09(i): one shared world (§2) | B, C |
| `work-graph/S2C-lines-scale.test.ts` | 2C-25 (1)–(4): one shared world (§3). `historyReadBudget` is not a page width: the small world crosses pages through seam I (active Sessions, archive, message scans) and the archive `page.limit`; (3) and (4) are hand-calculated for the default budget and for an exhausted budget; in (2) the expected order is hand-computed from a controlled clock, not read back from the store | I |
| `work-graph/S2A-queue-bounds.test.ts` | QA-04, QA-05, QA-06 (§4). QA-06 (201 Goals): the small version crosses at least two pages of the Goal list; the "decisive item last" rule does not apply (the case asserts that the read is not rejected and the cause card is right) | A, B |
| `runtime/B2-401-world.test.ts` | B2-16, F-032, B2-18: one shared world (§5); small R = 5, width 2 → exactly 3 pages, the one allow on the last page | D (+ A on the request path) |
| `app/S2A-decision-routes.test.ts` | QA-14(a) (§6). The route bindings read through `owners(f, …)` (`tests/helpers/S5-application-support.ts`): inject A and B there, the same widths for the success and the failure binding. QA-14(b), the read-failure case, needs no scale: it moves to a small world in the daily file and is not copied into the scale file | A, B |
| `work-graph/unknown-call-review-list.test.ts` | only the 205-record case (§7); the public `page.limit` is enough. Small: 5 records, page 2 → pages of 2, 2, 1, and a third read that ends the list (assert its end, as the original asserts the end after its second page) | existing |
| `work-graph/S2A-queue-request-candidates.test.ts` | QA-09(ii) (§8): the direct card read goes through A, the queue's candidate enumeration through B′ | A, B′ |
| `work-graph/S5R2-queue-history.test.ts` | R2A07/08 (201 Goals) and R2A09 (5,001 cards) (§11); keep their read-only and zero-model assertions in the small versions. R2A07/08: cross at least two Goal-list pages; the "decisive item last" rule does not apply | A, B |
| `work-graph/WP2-undelivered-notices.test.ts` | M07 (5,000 and 5,001) (§13). Small: an exact multiple of the width and one more, e.g. 4 and 5 replies with every inner and outer width 2 (2 full pages; then 2 full pages and a third with one item); write the page counts | G |
| `work-graph/S2A-notices-attempt.test.ts` | L11, 201 requeues assembled once (§18); small: 3 requeues, ordered width 2 and source width 2 → the ordered read happens exactly 2 times (a repeated assembly would make it 4) | B, E |
| `work-graph/WP2-context-extensions.test.ts` | F07 tail Task card (100 candidates) and F07 5,000/5,001 (§19); keep the three focus readings. The queue inside is built locally (`realDecisionQueue`): inject A there for the message scan, and B′ where the candidate case needs its inner layer to cross pages | F, A, B′ |

Not split (the inventory recommends "保持"): `S2A-queue-goal-runs` (QA-17, no seam H), `K3-review-workflow-rows`,
`invariants-fuzz`, `A7-control`, `B2-09-crr-owner`, `UCR-settle-review`, `S3-graph-context`,
`K3-26-unknown-call-review-storage`, `A8-host-restart`, `A11-no-progress`, `S2C-K-archive-tags-checks` (22 tasks is
the logical break point), `A2-reconcile-runtime`, `A8-host-restart-paused`.

## 5. Order and splitting

1. **Phase 1:** one subagent does SC1 (§2, §3); typecheck, `check:architecture` and the existing tests of every owner
   it touched stay green. Commit `SC1 page widths and the scale batch`.
2. **Phase 2, after phase 1 has reported, in parallel, disjoint files** (split by fixture):
   - S2A-queue-bounds, S2A-decision-routes, S5R2-queue-history, S2A-queue-request-candidates;
   - S2A-notices-overbound, S2A-notices-attempt, WP2-undelivered-notices;
   - S2A-queue-derived-cards, WP2-context-extensions;
   - S2C-lines-scale, unknown-call-review-list, B2-401-world.
   **At most three subagents run tests at the same time.** A subagent that needs a fixture another one owns reports;
   you serialize.
3. **Do not run the scale files** (they take up to 25 minutes each; the lead runs the scale batch with bubblewrap).
   Check that they are collected: `npx vitest list --config vitest.scale.config.ts` lists every moved case, and
   `npx vitest list` no longer lists any `.scale.test.ts` file.
4. Commit `SC2 scale tests split`.

**Never get green by weakening:** no `skip`, `todo` or `only`, no raised timeouts in daily files, no weakened
assertion.

**This environment.** No `rg` (use `grep -rn`); `python3 -I` for scripts. There is no bubblewrap in your sandbox: a
test failing only with `ENOENT … bwrap` or "sandbox unavailable" is an environment failure; list it, the lead runs it.
Run vitest with `--maxWorkers=2`; run the typecheck as `flock ./.typecheck.lock npm run typecheck` (never two at once).

## 6. Close-out (one subagent, nobody else running tests)

1. `flock ./.typecheck.lock npm run typecheck`, `npm run check:architecture`, `npm run build`: all 0.
2. The daily versions of the twelve files, and the tests of every owner SC1 changed (`grep -rln`), in batches; paste
   each file's duration from the vitest summary.
3. `npx vitest list --config vitest.scale.config.ts | wc -l` and the list of scale files.
4. `node ./.dsh-ref/scale-move-check.mjs sc-base HEAD > ./.dsh-ref/out/move-check.txt`: exit 0, last line ending
   `OK`. It parses the twelve pairs and fails when a case of `sc-base` is not found verbatim (whitespace aside) at
   least as often in the daily file or its `.scale.test.ts`, when a scale file has no case, or when a scale file has a
   case that is not at `sc-base` (a scale file holds moved cases only). It also lists, for review, every hook,
   `describe` header, top-level `for` header and other top-level statement (constants, helpers, imports) of
   `sc-base` found in neither file at HEAD. **The scale file keeps the original constants, backends and fixture
   defaults; the small values live only in the daily file.** So a review line means either an intended change (a
   hook moved into a helper, an import no longer needed) or a mistake: explain each one in the reply. `OK` is
   necessary, not sufficient: the lead checks which cases went where against §4's table, and the fixture defaults
   against `git diff sc-base HEAD -- tests/helpers`.

**Commits** in this copy: stage only the group's files by path (`git add -A -- <files>`), check
`git diff --cached --stat`, then `git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<msg>"`. Never stage
`.dsh-ref/`, `.dsh-scratch/` or `.typecheck.lock`. Then `git diff --shortstat sc-base HEAD`.

**Reply** (plain Chinese) in `./.dsh-ref/out/sc-reply.md`:
1. SC1: the mechanism files; per seam the owner, the parameter, its default, the path from the test helper that
   builds the owner; for seam I every `limit` literal changed and every one kept, with the reason;
2. SC2: per file the moved cases, the small cases with their sizes and the hand calculation of each page count, the
   seams injected, the fixture parameters added, the daily duration before (from `./.dsh-ref/per-file.tsv`) and after;
3. checks: commands and pass/fail counts; environment failures; the move check's last line;
4. anything the book got wrong; HANDOFF if you stop early (done, half done, not started).

Before you end, delete `./.dsh-scratch/` (the directory too).
