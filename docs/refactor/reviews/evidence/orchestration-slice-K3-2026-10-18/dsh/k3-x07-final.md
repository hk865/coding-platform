**Files changed**
- `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts` (+91): one `stopCancelledScope(unitName, options?)`, called only at the post-spawn `not_started_cancelled` return (`#runCapped`); pre-spawn/uncapped returns untouched. `CODING_AGENT_SYSTEMCTL_PATH` else `/usr/bin/systemctl`, absolute-only, 5 s deadline, never throws.
- `vendor/coding-agent/dist/sandbox/process/process-sandbox.*`: regenerated only by `node scripts/build-kernel-patch.mjs --write`; `--check` passes.
- `tests/kernel/RL-06-11-stop.test.ts` (+257/−4): RL-10c now asserts, for each `not_started` iteration with a launcher invocation, that its `--unit=` is `not-found` within 5 s; existing assertions unchanged. Added K3-49 failure-branch test plus 5 sandbox helper tests.
- New `tests/helpers/RL-fake-systemctl.sh`.
- New `tests/scenarios/K3-07-real-host-kill.test.ts`, `tests/helpers/K3-07-host-child.mjs`, `tests/helpers/K3-07-support.ts`.

**Ran here vs typecheck-only**
- K3-49 / modified RL-10c: RE1, not runnable here; all 17 RE1 tests fail fast with `ENOENT /usr/bin/bwrap`. The 5 new sandbox helper tests pass.
- K3-07: only the environment gate ran (`K3-07 RE1 environment unavailable (no bubblewrap / systemd user session): ENOENT /usr/bin/bwrap`); the real kill/takeover path is unrun — lead WSL.
- `npm run typecheck`, `npm run check:architecture`, `build-kernel-patch --check`: pass. `npm run build` succeeded (needed by K3-07; gitignored `dist/`).

**Loader**: option (b), build output of `npm run build`; `vite-node` is absent. Child imports only compiled `dist/app/main.js` and `dist/app/host.js`; test fails with “run npm run build first”.

**Log seam**: none existed, so one `process.stderr.write("agent-next: scope stop failed: <unit>: <reason>\n")`; multi-line stderr is collapsed, success silent.

**UNSPECIFIED**: exported `stopCancelledScope` as the documented RE1 test seam (the caps probe cannot run here) with a test-only deadline option; K3-07's process-gone proof uses RL-08's anchored argv[0] because bwrap `--unshare-pid` makes the marker pid namespace-local (the marker still records it; the pid is also checked when host-visible); second Host runs with start-up re-drive off.