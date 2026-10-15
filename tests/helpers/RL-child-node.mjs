// Fixture: a child Node Host that runs one capped ProcessSandbox command for the
// Host-death rows (RL-08, RL-08b, RL-09, RL-09b).
//
// Item 8 (spec §5.2 RE1 convention, §5.2 row notes): the capability probe is
// cached per Host process, so this child warms it in its own process before the
// parent switches the fake's mode. It prints one ready line
// (`{"probed":{...}}`), exits 3 when the probe is not available, then waits for
// one stdin line before it executes. The parent SIGSTOPs/SIGKILLs this process;
// the sandboxed command writes the scope's /proc/self/cgroup into the workspace
// identity file, from which the parent reads the unit name.
import { WorkspaceSandbox } from "../../vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js";
import { ProcessSandbox, probeResourceCaps } from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";

const root = process.env["RL_CHILD_ROOT"];
const command = process.env["RL_CHILD_COMMAND"];
const timeoutMs = Number(process.env["RL_CHILD_TIMEOUT_MS"] ?? "60000");
if (root === undefined || command === undefined) {
  process.stderr.write("RL_CHILD_ROOT and RL_CHILD_COMMAND are required\n");
  process.exit(2);
}

const workspace = await WorkspaceSandbox.create(root);
const profile = await ProcessSandbox.probe(root, workspace);
const probed = await probeResourceCaps();
process.stdout.write(`${JSON.stringify({ probed })}\n`);
if (probed.status !== "available") process.exit(3);

// Wait for the parent's one `go` line; only then run the command.
await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", () => { resolve(); });
});

const sandbox = new ProcessSandbox(profile, root, workspace, {
  resourceCaps: {
    current: () => ({ memoryMaxBytes: 256 * 1024 * 1024, tasksMax: 64 }),
  },
});
try {
  const result = await sandbox.execute({
    command,
    cwd: ".",
    timeoutMs,
    outputLimitBytes: 64 * 1024,
    signal: new AbortController().signal,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, exitCode: result.exitCode, resourceCaps: result.resourceCaps })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, message: String(error?.message ?? error) })}\n`);
}
