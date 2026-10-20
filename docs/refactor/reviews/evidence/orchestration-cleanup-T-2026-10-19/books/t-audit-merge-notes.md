# T wave 1: how the lead merged TP and TQ (2026-10-19 22:00)

- **Copies.** TP and TQ each ran in its own copy, both at tag `t-base` (= repository commit 3a9f6d94; the two base
  trees are byte-equal). TP committed `efa65cd` ("T TP"), TQ committed `5057649` ("T TQ"), after a second short
  segment (`t-run-TQ2.md`: commit, ledger and its mapping, no item work).
- **Merge.** The merged copy starts from TP's commit. TQ's diff (`t-base..5057649`) was applied with a three-way patch.
  Two files conflicted:
  1. `tests/architecture/production-reach-allowlist.json`: merged entry by entry, keyed by `(file, name)`. An entry
     deleted by either side is dropped; an entry changed by one side takes that side's text, verbatim. No entry was
     changed by both or added by either. Result: 164 entries (base 182, TP 177, TQ 169). The merged file's diff
     against TP's version equals TQ's own diff.
  2. `tests/helpers/S5-decision-fixture.ts`: TP's version is kept. TP (TP-099 to TP-108) builds the governance rows
     through the public bootstrap and adopts the architecture catalog through
     `createArchitectureCatalogService(...).adoptInitialArchitecture`, which writes the catalog row. TQ's change to
     this file (outside TQ's whitelist) had the same purpose for TQ-091: a hand-encoded catalog row beside the
     baseline. TQ's change is therefore dropped.
- **Lead fix after the merge** (commit "lead fix", `lead-fix-r4b.diff`): `tests/work-graph/R4b-session-directory.test.ts`
  seeded a bare architecture baseline with no catalog row. After TQ-091 a current read of a bare baseline returns
  `unavailable`, which is the retired pre-catalog shape. The fix adds a current-format `ArchitectureCatalog` record
  (`since: null`, no modules) to the same trusted seed commit, so a module target still resolves to `not_found`. TQ
  reported this file (it is TP's file, so TQ was told not to edit it).
- **Checks on the merged copy:** typecheck 0, `check:architecture` OK; the bubblewrap full suite is run by the lead
  separately.
