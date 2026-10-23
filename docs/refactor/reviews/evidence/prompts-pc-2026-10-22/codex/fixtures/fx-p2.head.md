# Write the PC-2 test fixtures (read only: give the files in your answer)

The tree at `D:\cxt\pc1a-r1` (your working directory) is the lead branch with PC-1a after rework 1 (`dd89733`; K and
C of PC-1, audited and passed). **PC-1b** (groups P, S, R) is being built now; write against the names PC-1's frozen
book freezes for it: `D:\cc-lead-notes\impl\pc\pc1-book.md` §4's seams block and rulings 14–30. PC-1's frozen platform
fixture is `D:\cc-lead-notes\impl\pc\fixtures\PC-platform-fixture.ts` (it will be at `tests/helpers/` in the tree
PC-2 starts from). W's commit `87f16ba` (ten tool factories take `texts?`) is the patch
`D:\cc-lead-notes\codex2\pc\w-87f16ba.patch`.

The **frozen PC-2 task book** (v4) follows below. Its §5.1 names two fixtures; DSH writes the PC-2 rows (§5.2) against
them; the lead checks and freezes them, and DSH may not edit them. Do not change any file; no tests, builds, git or
network. Give each complete new file in your answer in its own fenced block, ready to save as
`tests/helpers/PC2-pack-fixture.ts` and `tests/helpers/PC2-host-fixture.ts`.

They will not typecheck until PC-1b and PC-2's groups meet the books' seams. Write them against:
- the names that exist in the tree now;
- for PC-1b, only the names PC-1's book freezes; for PC-2, only the names the PC-2 book v4 freezes (§3 rulings and
  their TypeScript blocks). Where the book leaves a name to construction, take a parameter or a callback instead of
  guessing an import.

Import only what the existing tests import: public steps of the platform (Host, routes, the Runtime's public port,
WorkGraph commands through their public services) and the existing test helpers, including
`PC-platform-fixture.ts`. Never read the database to check a fact, never call a real model, never touch the network.

## What the fixtures must give (book §5.1)

Reuse the existing helpers rather than re-building a platform; name the one you reuse for each item (candidates:
`PC-platform-fixture.ts`, `K3-35-continuation-fixture.ts`, `K3-proposal-round.ts`, `K3-review-card-fixture.ts`,
`RL-query-fixture.ts`, `S2B-be1-platform-fixture.ts`, `WP2-platform-support.ts`, the Host fixtures under
`tests/app/`).

`PC2-pack-fixture.ts`:
1. Hand-written small packs as plain objects for A's pure tests (`PromptPackChainEntryV1[]` chains): a parent and a
   child; one pack broken in each way of PC-02 and PC-22 (identity, strings incl. a fixed key, templates, slots,
   section order, tools incl. `shell`, an empty description, a missing and an extra `list_files.prefix`); a pack with
   a different legal order. The same packs written as directories under a given `prompts/` root for H's tests.
2. Byte snapshots of every file of a pack directory, taken before and after a step, and a comparison helper.
3. A real K3 shrink reached through public steps (Work prepare of an unknown-call review round whose review section
   is shrunk), with a reminder after the review in the frozen order.
4. A Query history derivation for the reminder rule: a Query with `sessionBasis`, and one without basis on a Session
   with a completed history.
5. A PE8 injection: a pack whose required slot renders empty at preparation.
6. PE9 public-entry negative inputs: a wrong range, a duplicated text, and a non-tail success, each through the
   execution entry.

`PC2-host-fixture.ts`:
7. A Host on a temporary data directory with settings enabled; token and same-origin requests to the settings
   routes and the six `prompts/*` routes; preset or broken packs; the captured HTTP status and body.
8. Both directory relations for PC-23: a settings or `prompts/` directory inside a workspace root, configured and
   restored; an equal path; a symlink. Also a pack whose real directory leaves `prompts/` through a link.
9. A restart of the same Host data directory (PC-05).

Keep the two files under about 900 lines together. After the files, list each export with its signature, which
existing helper it reuses, and every place where you were unsure of a name (with the declaration you used, or the
book line you followed).

---

# The PC-2 book (v4, frozen)
