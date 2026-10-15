// RL spec §5.2 lead measurements (A6): per-command cost with/without caps, and the observation-complete ratio.
// Run from the repository root of a copy with RL applied, with CODING_AGENT_BWRAP_PATH set:
//   node /mnt/d/cc-lead-notes/impl/rl/rl-measure.mjs > out.json
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const { ProcessSandbox } = await import(path.join(root, "vendor/coding-agent/dist/sandbox/process/process-sandbox.js"));
const { WorkspaceSandbox } = await import(path.join(root, "vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js"));
const { probeResourceCaps } = await import(path.join(root, "vendor/coding-agent/dist/public-api.js"));

const MIB = 1_048_576;
const ws = await mkdtemp(path.join(tmpdir(), "rl-measure-"));
const workspace = await WorkspaceSandbox.create(ws);
const profile = await ProcessSandbox.probe(ws, workspace);
if (!profile.available) throw new Error(`bwrap unavailable: ${profile.reason}`);
const capability = await probeResourceCaps();
const caps = { current: () => ({ memoryMaxBytes: 6144 * MIB, tasksMax: 512 }) };
const capped = new ProcessSandbox(profile, ws, workspace, { resourceCaps: caps });
const plain = new ProcessSandbox(profile, ws, workspace, {});

const run = (sandbox, command) => sandbox.execute({
  command, cwd: ".", timeoutMs: 30_000, outputLimitBytes: 64 * 1024, signal: new AbortController().signal,
});
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stats = xs => ({ n: xs.length, median: +median(xs).toFixed(1), min: +Math.min(...xs).toFixed(1), max: +Math.max(...xs).toFixed(1) });

// warm-up (fills the probe cache, loads code)
await run(capped, "true");
await run(plain, "true");

// 1. cost: `true`, capped and uncapped, 20 each, interleaved
const cappedMs = [], plainMs = [];
for (let i = 0; i < 20; i += 1) {
  let t = performance.now(); const a = await run(capped, "true"); cappedMs.push(performance.now() - t);
  if (a.resourceCaps.status !== "applied") throw new Error(`not applied: ${JSON.stringify(a.resourceCaps)}`);
  t = performance.now(); const b = await run(plain, "true"); plainMs.push(performance.now() - t);
  if (b.resourceCaps.status !== "none") throw new Error(`uncapped run reported ${JSON.stringify(b.resourceCaps)}`);
}

// 2. observation-complete ratio: 50 each of three ordinary commands, capped
const commands = ["true", "git --version", "node -e \"console.log(1)\""];
const ratio = {};
for (const command of commands) {
  let complete = 0; const ms = []; const memory = {}; const processes = {};
  for (let i = 0; i < 50; i += 1) {
    const t = performance.now(); const r = await run(capped, command); ms.push(performance.now() - t);
    if (r.resourceCaps.status !== "applied") throw new Error(`${command}: ${JSON.stringify(r.resourceCaps)}`);
    if (r.resourceCaps.observationComplete) complete += 1;
    memory[r.resourceCaps.memory] = (memory[r.resourceCaps.memory] ?? 0) + 1;
    processes[r.resourceCaps.processes] = (processes[r.resourceCaps.processes] ?? 0) + 1;
  }
  ratio[command] = { complete, of: 50, ms: stats(ms), memory, processes };
}

await rm(ws, { recursive: true, force: true });
console.log(JSON.stringify({
  when: new Date().toISOString(), node: process.version, capability,
  cost: { capped: stats(cappedMs), uncapped: stats(plainMs),
    medianExtraMs: +(median(cappedMs) - median(plainMs)).toFixed(1) },
  observationComplete: ratio,
  note: "Times from performance.now() (this WSL steps its wall clock); the quiescence wait is not exposed by the public result, so it is included in the capped end-to-end time.",
}, null, 1));
