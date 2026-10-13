# Task: K slice part B — third session: last fixes after the second review

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Two earlier
sessions implemented and fixed part B of the K slice in this copy (the read-only command tool); the work is in the
working tree (not committed). With real bubblewrap the lead ran the K tests (43 pass) and the full suite (all pass).
Codex's second review says "merge after listed fixes". This session makes exactly those fixes.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 5 and the reply of section 6.

**Work with subagents.** You are the coordinator; keep your own context small. Give group S and group T (section 3)
each to its own subagent; they write disjoint files.

## 1. Material (inside this copy, excluded from `git status`)

- `./.dsh-ref/kB-impl.md` — the first brief. Its sections 1–5 still apply (copy, spec sections, frozen sha256, L-scope,
  L-tdd, L-reach, L-interfaces, L-kernel, L-build, rules).
- `./.dsh-ref/r2/` — the second brief's material; section 2 of `/.dsh-ref/r2/brief-2.md` (the lead decisions D-IPC,
  D-GIT, D-SWITCH, D-BOUND, D-CODES, D-PROBE, D-CWD, D-DESC) still applies.
- `./.dsh-ref/r3/codex-review-2.md` — the second review. Its numbered problems 1–2 and the four "Should fix" test items
  are this session's work.
- `./.dsh-ref/tdd/` — the TDD skill.

The lead changed three things after the second session (keep them): the prepare-time guard in
`src/core/agent-runtime/execution-preparation.ts` was reverted (the existing start-time guard in
`observed-model-run.ts` stays the only one); the KE5 bwrap wrapper's loop body got a `:`; the FIFO write outcome
accepts `wrote` or `blocked`.

## 2. Lead decisions for this round (binding)

- **D-GITFILE (review problem 1, must fix).** A protected descendant is dropped when its ancestor is masked: a `.git`
  that is a file is masked (bound over by `/dev/null`), so every protected path under it is dropped. Under a readable
  `.git` directory, descendants keep their own overlays (D-GIT). When an `lstat` of a protected path fails with
  `ENOTDIR` or `ENOENT`, the path does not exist and needs no overlay. Test (KE5): a linked worktree whose `.git` is a
  file, with a Host-denied `.git/private`: an ordinary read-only command (`printf hello`) succeeds; git commands in it
  fail as before (L17).
- **D-ID (review problem 2).** The 128 KiB bound covers everything the tool produces. The call ID comes from the
  provider and is not part of that budget; the lead records this as a qualification of M11. Within that:
  - every result, including the early refusals (invalid arguments, permission, sandbox unavailable, launch failure),
    goes through the same bounding function;
  - the fixed external-change message is never shortened; trim captured output first, then paths;
  - a test shows an early refusal with an oversized input is bounded.
- **Test fixes (the review's four "Should fix" items):**
  - Host-started Work with the switch off: run a read-only Work through a real `createLocalWorkbenchHost` started from
    a configuration with `allowReadonlyCommands: false` and an explicit binding that lists the tool and
    `readonlyCommandAccess`; assert the model's tool list has no `run_readonly_command`. Write a new
    `tests/helpers/K-readonly-host-support.ts` if you need one.
  - KB-09 write-alone: assert the exact public outcome you observe (the start result and the observed Run: its status,
    outcome and the reason the existing guard gives), not only "not completed" behind an `if`.
  - Remove the constructor-coupling assertion (the read-only construction count and constructor arguments); make the
    sandbox double's behaviour depend on the options it gets and assert the public result and whether a command
    started.
  - Ordering: feed shuffled paths, including byte-order-sensitive ones (uppercase before lowercase, a multi-byte UTF-8
    name), and compare with a handwritten expected prefix.

## 3. Groups

**S — sandbox:** `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts` and generated files
(`node scripts/build-kernel-patch.mjs --write`, then `--check`); D-GITFILE; tests in
`tests/kernel/K-readonly-sandbox.test.ts` (KE5, they fail here with the sandbox kind; the lead runs them with
bubblewrap).

**T — tool and tests:** `src/core/agent-runtime/readonly-command-tool.ts`; D-ID; the four test fixes in
`tests/runtime/K-readonly-command.test.ts` and the helpers.

## 4. Rules

Test-first for every behaviour change. No git write commands; one vitest command at a time; no real model calls; no
network beyond a test's own local listener; do not touch ports 3080, 3099, 44797; probes only under `./.dsh-scratch/`,
deleted at the end. If the spec, the review and a test disagree: keep the test, stop that item, report it.

## 5. Checks

Run exactly the commands of the first brief section 8. Expected (no bubblewrap here): typecheck, check:architecture,
build and the kernel-patch check exit 0; the two K files pass except the KE5 tests (sandbox kind only); the regression
run shows only the 31 baseline sandbox-kind failures plus the KE5 tests; the frozen sha256 values hold;
`git status --short` lists only L-scope paths; `./.dsh-scratch/` deleted; no commit.

## 6. Reply

The first brief's reply format, plus **REVIEW:** for review problems 1–2 and each of the four test items: fixed / not
fixed (why), with the test name and file:symbol.
