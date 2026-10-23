# PC-2: four fixture patches for rework 2 (Codex writes fixtures; the lead checks and freezes them)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact. Your answer **contains the patches** as unified diffs against this tree;
the lead applies them after review.

This tree is PC-2 at `af84802` (see `.lead-ref/`). Your own audit (`.lead-ref/` has the inputs; your reports are the
J, T and Q parts of audit 1) found four rows that the frozen fixtures cannot carry. The lead deferred them to rework 2
and asks you for the smallest fixture changes. The rows and your own suggested fixes:

- **J-04 (Query history capture).** `openPC2QueryHistoryFixture` (`tests/helpers/PC2-pack-fixture.ts` ~405–430) spies
  the Runtime port after `create-platform.ts` ~1511 has copied it for the Workflow (~1774), so `startQuery` is never
  captured. Your fix: capture the `deps.runtime` that the `createWorkflow` factory actually receives (wrap the factory
  while the platform is built, then restore it), install the existing capture/busy spy on that object's `startQuery`,
  and bind `actualStart` from the same object. No production change.
- **J-06 (K3 non-empty seed).** `openPCK3ReviewFixture` (`tests/helpers/PC-platform-fixture.ts` ~561) creates the
  pending review in a Session whose source Run blocks on its first turn, so a K3 seed is always empty. Add a mode that
  first runs one public turn to the end in the source Session, then creates the blocked Run in the same Session, then
  claims the review round in a new Session (as `B2-crr-world.ts` ~141–149 does for the empty case). Default unchanged.
- **J-08 (all four budget sections omitted, through preparation).** Add `contextResidentBytes` to `PCOptions` and pass
  it through to WP2 (`tests/helpers/WP2-platform-support.ts` ~96, ~735). Default unchanged.
- **J-09 / T-08 (read + edit + shell through preparation to request).** An explicit writable option that sets the
  Role's `writeScope: 'workspace'`, the Host's `writeScope: ['.']` and `shellWorkspaceAccess: 'all_except_denied'`
  (`WP2-platform-support.ts` ~560, ~734; production check `execution-preparation.ts` ~424), default unchanged, so a
  test can select `read`, `write`, `shell` through the permission `tools` and reach a real request.

Rules for the patches:
1. **Fixtures only:** `tests/helpers/PC2-pack-fixture.ts`, `tests/helpers/PC-platform-fixture.ts`,
   `tests/helpers/WP2-platform-support.ts` (say if another helper must change, and why). No production file.
2. **Every existing caller unchanged:** each new option defaults to today's behaviour; name every current caller of a
   function you change (search `tests/`) and say why it is unaffected.
3. **No injection point the product lacks:** each mode goes through the public steps the platform already has; no
   hand-written facts, no database writes, no new product permission (no `read_source`, C9).
4. For each patch: the diff; the callers checked; the row it unblocks and the test steps a rework would write with it
   (in one short paragraph each); what could go wrong.

## Answer

1. One section per row (J-04, J-06, J-08, J-09): the diff in a fenced ` ```diff ` block, then the points of rule 4.
2. Any row you now think needs no fixture change, with the reason.
3. One last line: `补丁 n 个，涉及文件 n 个`.
