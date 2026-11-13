// NB-17 fixture (tests/scenarios/NETB-host-kill.test.ts), written the way K3-07-host-child.mjs is: a real Host on
// `dist/` (`npm run build` first) over the parent's startup file NETB_CONFIG and clock NETB_NOW; the in-child model's
// first answer is one `shell` call running NETB_COMMAND, every later call waits forever. The Host input
// `networkProvider` (A8): `pkg.example` resolves to 93.184.216.34, every dial goes to the parent's stub NETB_STUB_PORT.
import { connect } from "node:net";
import { loadWorkbenchCliConfig } from "../../dist/app/main.js";
import { createLocalWorkbenchHost } from "../../dist/app/host.js";
import { ProviderRegistry } from "../../vendor/coding-agent/dist/public-api.js";

const env = process.env;
let round = 0;
const client = {
  async *stream(request, options) {
    options.signal?.throwIfAborted?.();
    if (round++ > 0) return await new Promise(() => {});
    const base = { schemaVersion: 1, requestId: request.requestId };
    yield { ...base, sequence: 1, type: "tool_call_started", callId: "netb-17-shell", name: "shell", ordinal: 0 };
    yield { ...base, sequence: 2, type: "tool_arguments_delta", callId: "netb-17-shell",
      delta: JSON.stringify({ command: env.NETB_COMMAND, cwd: ".", timeoutMs: 120_000 }) };
    yield { ...base, sequence: 3, type: "completed", reason: "tool_calls" };
  },
};

try {
  const registry = new ProviderRegistry().register({
    id: "deepseek", secretEnvironmentVariable: env.NETB_SECRET_VARIABLE, defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => client,
  });
  const host = await createLocalWorkbenchHost({
    ...await loadWorkbenchCliConfig(env.NETB_CONFIG), publicDir: env.NETB_PUBLIC_DIR, now: () => env.NETB_NOW,
    runtimeProvider: { registry, secretSource: { get: name => name === env.NETB_SECRET_VARIABLE ? env.NETB_SECRET_VALUE : undefined } },
    networkProvider: {
      lookup: async name => name === "pkg.example" ? [{ address: "93.184.216.34", family: 4 }] : [],
      dial: () => connect({ host: "127.0.0.1", port: Number(env.NETB_STUB_PORT) }),
    },
  });
  process.stdout.write(`${JSON.stringify({ ready: true, url: (await host.listen()).url })}\n`);
  await new Promise(() => {});
} catch (error) {
  process.stderr.write(`NETB child failed: ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}
