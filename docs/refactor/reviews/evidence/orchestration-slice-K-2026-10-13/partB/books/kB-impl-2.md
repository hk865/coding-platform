# Task: K slice part B — second session: fix round after the acceptance review

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. An earlier session
implemented part B of the K slice in this copy (the read-only command tool); its work is in the working tree (not
committed). The lead ran its tests with real bubblewrap (all 26 pass) and the full suite (all pass), and Codex reviewed
it. The review found defects. This session fixes them. Everything you need is in this message and in files of this copy.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
Earlier runs lost all their work that way: they started subagents and then ended the turn.
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- No notification wakes you after your turn ends.
- End your turn only after the checks of section 6 and the reply of section 7.

**Work with subagents.** You are the coordinator; keep your own context small. Do not read the spec, the code or the
tests yourself. Give each group of section 4 to its own subagent.

## 1. Where the material is (all inside this copy, not committed, excluded from `git status`)

- `./.dsh-ref/kB-impl.md` — the first session's brief. Its sections 1–5 (copy, spec sections, frozen sha256, lead
  decisions L-scope, L-tdd, L-reach, L-interfaces, L-kernel, L-build, rules) still apply, except where this message
  says otherwise.
- `./.dsh-ref/tdd/` — the TDD skill (SKILL.md, tests.md, mocking.md).
- `./.dsh-ref/r2/codex-review.md` — the acceptance review: findings 1–7, the error-code note, the KB-row test table and
  the per-file TDD assessment. **Every "must fix" and "should fix" item there is to be fixed, as decided in section 2.**
- `./.dsh-ref/r2/first-report.md` — the first session's reply.
- The frozen spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md` (its sha256 is unchanged).

Every subagent reads, in order: the TDD skill; `./.dsh-ref/kB-impl.md` sections 1–5; section 2 of this message; its
group block below; the review items its block names; the spec sections they cite; then the code.

## 2. Lead decisions for this round (binding; they settle the review's open points)

- **D-IPC (review finding 1).** Before each read-only launch, every Unix socket and FIFO found under the workspace root
  is masked: bind `/dev/null` read-only over it, the same way protected files are hidden today. Find them with the walk
  the workspace snapshot already does if it sees file types; otherwise with one bounded `lstat` walk that skips the
  protected directories. A socket or FIFO created while the command runs is not covered; that residual is the same as
  the existing `shell` sandbox and is recorded by the lead, not fixed here. Test (KE5, real bubblewrap): a FIFO and a
  listening Unix socket in the workspace are not usable from the command (opening the FIFO for writing fails or
  blocks without reaching the host reader within the timeout; connecting to the socket fails), and the host-side
  listener receives nothing.
- **D-GIT (finding 2).** In `read_only`, drop a protected path only when an ancestor is masked (an empty tmpfs or
  `/dev/null`). Under an ancestor that stays readable (`.git`, which is bound read-only so git can read it), keep every
  descendant's own overlay. Test (KE5): a Host-denied `.git/private` (and a denied file under it) is not readable,
  while `git log` still works.
- **D-SWITCH (finding 3).** `allowReadonlyCommands: false` narrows every runtime binding of that workspace at the Host's
  common resolution boundary, at startup and on every settings rebuild: the tool and `readonlyCommandAccess` are
  removed whatever a binding lists. Test (KE6): a Host started from a configuration with the switch off and an explicit
  binding that lists the tool and `readonlyCommandAccess: 'all_except_denied'` does not show the tool to a Query or a
  read-only Work.
- **D-BOUND (finding 4).** The bound applies to the complete serialized result, not only `output`.
  - The error message is short and fixed: `workspace_changed_during_readonly_command: the workspace was changed by
    another writer during the command; the changed paths are in the output` (no path list in the message).
  - If the named paths (up to 100, byte order) do not fit the 128 KiB budget together with the rest of the result, name
    fewer, still the first ones in byte order, and add the rest to `externalChangedPathsOmitted`. This amends L15's
    "100 paths" to "up to 100 paths, fewer when the 128 KiB result bound needs it" (the lead records it as spec §9 M11).
  - Captured output is trimmed first, then paths, then nothing else; the result always validates.
  - Tests (KE6): long paths (100 paths of about 1.5 KiB each) give a complete result of at most 128 KiB with fewer named
    paths and the right omitted count; the expected named paths come from a handwritten byte-ordered list, not from the
    code's sort.
- **D-CODES (the error-code note).** The frozen Kernel enum has no `forbidden` and no
  `workspace_changed_during_readonly_command`. Keep the compatible codes and add a stable marker:
  - permission changed: `code: 'permission_denied'`, message starting `forbidden:`;
  - external change: `code: 'execution_failed'`, `retryable: false`, the fixed message above, and a JSON output item
    `{ reason: 'workspace_changed_during_readonly_command', externalChangedPaths, externalChangedPathsOmitted, ... }`.
  - The lead records this as spec §9 M10. Tests assert the code, the message prefix and the JSON `reason`.
- **D-PROBE (finding 5).** `probe` and the read-only canary use the actual options of the sandbox that will run (the
  protected and read-only paths, the executable), and the canary always exercises both `--ro-bind-fd` and
  `--remount-ro` (mount a scratch tmpfs and remount it read-only when no protected directory exists). The cache key
  stays the configuration. Test (KE5): bwrap present but without one of the two options gives `sandbox_unavailable`
  and starts nothing (KB-06's second half; use a small wrapper script under `./.dsh-scratch/` that behaves like a bwrap
  without the option, passed as `bwrapPath`).
- **D-CWD (finding 6).** Validate the cwd against what the sandbox will use: resolve it once, require a directory, and
  pass the validated relative path; then, inside the sandbox command, check with a cheap `pwd -P`-style guard that the
  process is under `/workspace` before running the user command, and fail with `invalid_arguments` otherwise. Do not
  pass any host-root fd into the sandbox. Test (KE5): a cwd that is a regular file is rejected before launch.
- **D-DESC (finding 7).** The tool description says: a subprocess timeout keeps the captured output; a cancellation or
  the dispatcher's own timeout replaces it; `.git` is readable but read-only; Host-denied paths are hidden.

## 3. Order

1. Wave 1, in parallel: group **S** (sandbox, Kernel patch) and group **T** (tool, wiring, Host).
2. Self-check: one read-only reviewer per group, fresh context: the four questions of the first brief section 7, and
   for each review item of its group in `./.dsh-ref/r2/codex-review.md`: fixed or not, with file:line.
3. Fixes from the self-check, then the checks of section 6 once.

## 4. Groups

**S — the read-only process sandbox.**
- Production: `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts` and its generated files
  (`node scripts/build-kernel-patch.mjs --write`, then `--check`).
- Items: D-IPC, D-GIT, D-PROBE, D-CWD; review KB rows 04, 05 (emit output before the timeout and before the
  cancellation, and assert it is retained), 06.
- Tests: `tests/kernel/K-readonly-sandbox.test.ts` (add or rewrite; KE5). These tests need real bubblewrap and fail here
  with the sandbox kind; write them anyway and report them; the lead runs them outside.

**T — the tool, its wiring and the Host grant.**
- Production: `src/core/agent-runtime/readonly-command-tool.ts`, `observed-model-run.ts`, `query-preparation.ts`,
  `query-execution.ts`, `execution-driver.ts`, `execution-preparation.ts`, `execution-contracts.ts`; `src/app/host.ts`,
  `src/app/runtime-configuration.ts`.
- Items: D-SWITCH, D-BOUND, D-CODES, D-DESC; review KB rows 07 (read the Work history through the public reader and
  assert the saved call and output), 08 (the real Host switch with an explicit binding), 09 (grant `shell`, `edit` and
  `write` too, and verify they stay excluded or are publicly rejected), 10 (complete-result bound, long paths,
  independently specified byte-ordered prefix).
- Test hygiene from the review's per-file assessment: remove the implementation-coupled assertions it names (Runtime
  test lines about constructor modes, the internal forwarding assertion); move the Host-helper test and the direct
  tool/dispatcher construction to the KE6 entry or delete them where the KE6 tests already cover them; complete the
  Work cases with `observeRun` where they assert execution outcomes; stop importing private Runtime helpers to decode
  history where a public reader exists.
- Tests: `tests/runtime/K-readonly-command.test.ts` and `tests/helpers/K-readonly-work-support.ts` (rewrite as needed;
  KE6).

## 5. Rules

- Test-first for every behaviour change (first brief section 5 rule 1). For test-only rewrites keep a log: old test,
  what was wrong, new test, its result.
- No git write commands; one vitest command at a time; no real model calls; no network beyond the local listener a
  KE5 test itself opens; do not touch ports 3080, 3099, 44797; probes only under `./.dsh-scratch/`, deleted at the end.
- If the spec, the review and a frozen or existing test disagree: keep the test, stop that item, and report it under
  UNSPECIFIED with the three texts.

## 6. Checks

Run exactly the commands of the first brief section 8.

Expected (this sandbox, no bubblewrap):
- typecheck, check:architecture, build and the kernel-patch check exit 0.
- The two K files: every test passes except the KE5 tests, which fail only with the sandbox kind.
- The regression run: only the 31 sandbox-kind failures of `DSH-BASELINE.md` plus the KE5 tests, no other failure.
- The sha256 values of the first brief section 3 hold; `git diff --stat slice-base -- tests` lists only the new K files;
  `git status --short` lists only L-scope paths; `./.dsh-scratch/` deleted; no commit.

## 7. Reply

The reply format of the first brief section 9, plus:
- **REVIEW:** for each review finding 1–7, the error-code note and each KB-row action: fixed / not fixed (why), with
  the test name and file:symbol.
