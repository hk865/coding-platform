// Fixture: a real platform Host in its own process for K3-07 (spec §5.4).
//
// Option (b) of the lead's loader ruling: `vite-node` is not installed and Node
// is v24, so this child runs the BUILD OUTPUT (`npm run build` ->
// `tsconfig.build.json` -> `dist/`). It imports compiled JS only (the platform
// `dist/app/*` and the vendored Kernel `vendor/coding-agent/dist`), never TS.
//
// The workbench CLI has no scripted-provider seam, so the child composes the
// same two production entry points `startAG2bHost` uses in process:
// `loadWorkbenchCliConfig` (dist/app/main.js) and `createLocalWorkbenchHost`
// (dist/app/host.js), and injects a tiny in-child ModelClientPort through
// `runtimeProvider` (mirroring `createScriptedModel` in
// tests/helpers/B2-runtime-fixture.ts). No network, no real model.
//
// The parent passes the real config path and the long `shell` command through
// environment variables, reads the one ready line, and SIGKILLs this process.
import { loadWorkbenchCliConfig } from "../../dist/app/main.js";
import { createLocalWorkbenchHost } from "../../dist/app/host.js";
import { ProviderRegistry } from "../../vendor/coding-agent/dist/public-api.js";
import { probeResourceCaps } from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";

const configPath = process.env["K3_07_CONFIG"];
const command = process.env["K3_07_SHELL_COMMAND"];
const publicDir = process.env["K3_07_PUBLIC_DIR"];
const secretVariable = process.env["K3_07_SECRET_VARIABLE"] ?? "K3_07_CONTROLLED_SECRET";
const secretValue = process.env["K3_07_SECRET_VALUE"] ?? "k3-07-controlled-secret-value";
if (configPath === undefined || command === undefined || publicDir === undefined) {
  process.stderr.write("K3_07_CONFIG, K3_07_SHELL_COMMAND and K3_07_PUBLIC_DIR are required\n");
  process.exit(2);
}

/**
 * One scripted Kernel reply: a single `shell` tool call carrying the parent's
 * long command, then no further answer. The run is killed while the command is
 * still sleeping, so the second answer is never reached in the intended flow;
 * hanging (rather than throwing) keeps a late call from being recorded as a
 * model error if the kill loses a race by a few milliseconds.
 */
function createScriptedModel(shellCommand) {
  let round = 0;
  const client = {
    async *stream(request, options) {
      options.signal?.throwIfAborted?.();
      const index = round++;
      if (index > 0) {
        await new Promise(() => {});
        return;
      }
      const base = { schemaVersion: 1, requestId: request.requestId };
      let sequence = 0;
      yield { ...base, sequence: ++sequence, type: "tool_call_started", callId: "k3-07-shell", name: "shell", ordinal: 0 };
      yield { ...base, sequence: ++sequence, type: "tool_arguments_delta", callId: "k3-07-shell",
        delta: JSON.stringify({ command: shellCommand, cwd: ".", timeoutMs: 120_000 }) };
      yield { ...base, sequence: ++sequence, type: "completed", reason: "tool_calls" };
    },
  };
  return client;
}

let host;
try {
  const loaded = await loadWorkbenchCliConfig(configPath);
  // One stable client per child, as `startAG2bHost` wires its scripted model:
  // the first stream yields the shell call, every later call waits forever.
  const scripted = createScriptedModel(command);
  const registry = new ProviderRegistry().register({
    id: "deepseek",
    secretEnvironmentVariable: secretVariable,
    defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => scripted,
  });
  host = await createLocalWorkbenchHost({
    ...loaded,
    publicDir,
    runtimeProvider: { registry, secretSource: { get: name => name === secretVariable ? secretValue : undefined } },
  });
  const address = await host.listen();
  // The parent uses this as the machine-condition gate for the unit assertion:
  // `probeResourceCaps` says whether a real systemd user scope can be created.
  // It is a per-process optimistic probe; the unit name in the command's
  // /proc/self/cgroup is the authoritative per-command evidence.
  const resourceCaps = await probeResourceCaps().catch(error => ({
    status: "unknown", reason: String(error?.message ?? error),
  }));
  process.stdout.write(`${JSON.stringify({ ready: true, url: address.url, resourceCaps })}\n`);
  // The listener keeps the process alive; the parent SIGKILLs it mid-command.
  await new Promise(() => {});
} catch (error) {
  process.stderr.write(`K3-07 child failed: ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}
