// Fixture (R3): a child Node Host for the MF3 gate-stream-error row and the MF4
// exit-after-r smoke.
//
// It warms the capability probe in the fake bwrap's `forward` mode, switches the
// fake's mode (gate-reset / exit-after-r), runs one capped command with
// 256 MiB / 64 and prints exactly one JSON line:
//   { probed, launchesBefore, launchesAfter, elapsedMs, result | error }
// `launches*` count `agent-keeper` lines in the fake systemd-run log; the
// parent asserts the execute added exactly one scope launch. `elapsedMs`
// measures the execute alone so MF4 can require settlement inside 5 s.
//
// In the DSH sandbox there is no bwrap/user session, so it prints
// { probed: { status: 'unavailable', ... } } and exits 3 (never passes by skip).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WorkspaceSandbox } from "../../vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js";
import { ProcessSandbox, probeResourceCaps } from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";

const root = process.env["RL_CHILD_ROOT"];
const command = process.env["RL_CHILD_COMMAND"];
const timeoutMs = Number(process.env["RL_CHILD_TIMEOUT_MS"] ?? "30000");
const bwrapMode = process.env["RL_CHILD_BWRAP_MODE"] ?? "gate-reset";
const bwrapPath = process.env["CODING_AGENT_BWRAP_PATH"] ?? "";
const systemdRunPath = process.env["CODING_AGENT_SYSTEMD_RUN_PATH"] ?? "";

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
if (root === undefined || command === undefined || bwrapPath === "" || systemdRunPath === "") {
  process.stderr.write("RL_CHILD_ROOT, RL_CHILD_COMMAND, CODING_AGENT_BWRAP_PATH and CODING_AGENT_SYSTEMD_RUN_PATH are required\n");
  process.exit(2);
}

function launchCount() {
  try {
    return readFileSync(path.join(path.dirname(systemdRunPath), ".log"), "utf8")
      .split("\n")
      .filter(line => line.includes("agent-keeper"))
      .length;
  } catch {
    return -1;
  }
}

const workspace = await WorkspaceSandbox.create(root);
const profile = await ProcessSandbox.probe(root, workspace);
const probed = await probeResourceCaps();
if (probed.status !== "available") {
  emit({ probed, profileAvailable: profile.available });
  process.exit(3);
}

const launchesBefore = launchCount();
writeFileSync(path.join(path.dirname(bwrapPath), ".bwrap-mode"), bwrapMode);

const sandbox = new ProcessSandbox(profile, root, workspace, {
  resourceCaps: {
    current: () => ({ memoryMaxBytes: 256 * 1024 * 1024, tasksMax: 64 }),
  },
});
const startedAt = performance.now();
try {
  const result = await sandbox.execute({
    command,
    cwd: ".",
    timeoutMs,
    outputLimitBytes: 64 * 1024,
    signal: new AbortController().signal,
  });
  emit({
    probed: { status: "available" },
    launchesBefore,
    launchesAfter: launchCount(),
    elapsedMs: performance.now() - startedAt,
    result: {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      resourceCaps: result.resourceCaps,
    },
  });
} catch (error) {
  emit({
    probed: { status: "available" },
    launchesBefore,
    launchesAfter: launchCount(),
    elapsedMs: performance.now() - startedAt,
    error: { code: error?.code ?? null, message: String(error?.message ?? error) },
  });
}
