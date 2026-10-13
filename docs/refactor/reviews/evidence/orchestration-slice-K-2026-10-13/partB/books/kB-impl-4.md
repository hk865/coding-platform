# Task: K slice part B — fourth session: two last fixes after the third review

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Three earlier
sessions implemented and fixed part B of the K slice in this copy (the read-only command tool); the work is in the
working tree (not committed). With real bubblewrap the lead ran the 48 K-B tests and the full suite (281 files, 6,022
tests): all pass. Codex's third review says "merge after listed fixes": one sandbox race and one test double. This
session makes exactly those two fixes.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 300`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 5 and the reply of section 6.

**Work with subagents.** You are the coordinator; keep your own context small. Give group S and group T (section 3)
each to its own subagent; they write disjoint files.

## 1. Material (inside this copy, excluded from `git status`)

- `./.dsh-ref/kB-impl.md` — the first brief. Its sections 1–5 still apply.
- `./.dsh-ref/r2/brief-2.md` section 2 and `./.dsh-ref/r3/brief-3.md` section 2 (the third brief: D-GITFILE, D-ID and the four test fixes) still applies.
- `./.dsh-ref/r4/codex-review-3.md` — the third review. Its findings 1 and 2 are this session's work.
- `./.dsh-ref/tdd/` — the TDD skill.

Keep every lead change from earlier rounds (the reverted prepare-time guard, the KE5 loop `:`, the FIFO outcome, the
KB-09 test as it is now).

## 2. Lead decisions for this round (binding)

- **D-ONECHECK (review finding 1, must fix).** In one execution, classify `.git` and every protected path exactly once
  (one `lstat` each), before building the bubblewrap arguments. The mount plan (which paths are masked, which overlays
  are kept, which descendants are dropped) and the IPC scan's skip decisions are all derived from that one snapshot;
  no later `lstat`/`stat` of the same path decides anything. Put the derivation in one pure function inside the
  patch file (for example `planReadonlyMounts(snapshot)`), called by both the mount loop and the IPC scan.
  - Why this is safe: if a path changes type between the snapshot and the moment bubblewrap mounts, bubblewrap itself
    refuses the bind and exits 1. The lead checked this with the real bwrap in WSL: binding `/dev/null` over a
    directory ("Can't create file … Is a directory"), an overlay under a path that is now a file ("Not a directory"),
    and a directory bind over a file all fail. The tool reports that as the existing launch failure. It never runs
    with a denied path readable.
  - Tests (test-first): (a) a pure test of the planning function: `.git` classified as a file → `.git` masked and every
    protected descendant of `.git` dropped from the overlays; `.git` classified as a directory → descendant overlays
    kept, and the IPC scan skips exactly the subtrees the plan masks (no more, no fewer); a protected path
    classified missing (`ENOENT`/`ENOTDIR`) → no overlay. Hand-written snapshots, hand-written expected plans.
    (b) KE5 (real bwrap; it fails here with the sandbox kind, the lead runs it): build the arguments from a snapshot
    taken while `.git` is a file, then turn `.git` into a directory with `private/secret` before launching, and assert
    the command fails (launch failure) and `secret` is never printed. If the code structure makes (b) impossible
    without a test-only hook in production code, do not add the hook: write (b) as the closest public-path test you
    can, and report UNSPECIFIED with the reason.
- **D-DOUBLE (review finding 2, should fix).** The runtime test's sandbox double keeps the options its instance was
  constructed with; its `execute` refuses (as the real sandbox would refuse an unsupported configuration) when those
  options are not the read-only options the command needs, including a wrong `workspaceMode`. Assert only public
  results and whether a command started; no assertion on constructor call counts or arguments. Show that changing the
  tool's constructor options (for example `workspaceMode`) would make a test fail: write that check as a temporary
  probe under `./.dsh-scratch/`, run it once, report the result, delete it.

## 3. Groups

**S — sandbox:** `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts` and generated files
(`node scripts/build-kernel-patch.mjs --write`, then `--check`); D-ONECHECK; tests in
`tests/kernel/K-readonly-sandbox.test.ts`.

**T — test double:** `tests/runtime/K-readonly-command.test.ts` and helpers; D-DOUBLE. No production change.

## 4. Rules

Test-first for the behaviour change. No git write commands; one vitest command at a time; no real model calls; no
network beyond a test's own local listener; do not touch ports 3080, 3099, 44797; probes only under `./.dsh-scratch/`,
deleted at the end. If the spec, the review and a test disagree: keep the test, stop that item, report it.

## 5. Checks

Run exactly the commands of the first brief section 8. Expected (no bubblewrap here): typecheck, check:architecture,
build and the kernel-patch check exit 0; the two K files pass except the KE5 tests (sandbox kind only); the regression
run shows only the 31 baseline sandbox-kind failures plus the KE5 tests; the frozen sha256 values hold;
`git status --short` lists only L-scope paths; `./.dsh-scratch/` deleted; no commit.

## 6. Reply

The first brief's reply format, plus **REVIEW:** for findings 1 and 2: fixed / not fixed (why), with the test names
and file:symbol, and the D-DOUBLE probe result.
