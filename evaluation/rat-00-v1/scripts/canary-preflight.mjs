import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const projectRoot = path.join(root, ".local/evaluation/rat-00/kernel-baseline");
const harness = await import(pathToFileURL(path.join(projectRoot, "benchmarks/harness/benchmark-harness.mjs")));
const tasksRoot = path.join(projectRoot, "benchmarks/tasks");
const outputRoot = path.resolve(process.argv[2] ?? path.join(root, ".local/evaluation/rat-00/canary"));
const results = [];
for (const [id, mode, expected] of [["base", "base", "unresolved"], ["oracle", "oracle", "resolved"], ["near-miss", "near-miss", "unresolved"], ["oracle-repeat", "oracle", "resolved"]]) {
  const run = await harness.runReplayBaseline({projectRoot, tasksRoot, outputRoot, runId: id, mode});
  for (const result of run.results) {
    assert.equal(result.status, expected, `${id}:${result.taskId}`);
    assert.equal(result.metrics.modelRequestCount, 0);
  }
  results.push({variant: id, expected, outputRoot: run.outputRoot, trials: run.results});
}
const boundary = [];
for (const task of await harness.loadBenchmarkTasks(tasksRoot)) {
  const prepared = await harness.prepareWorkspace(task, "base");
  try {
    const visible = [...(await harness.snapshot(prepared.workspace)).keys()].sort();
    const expected = [...(await harness.snapshot(path.join(task.taskRoot, task.task.variants.base))).keys()].sort();
    assert.deepEqual(visible, expected);
    assert(!visible.some(name => /(^|\/)(oracle|near-miss|hidden_tests|evaluator-only|UPSTREAM.json)(\/|$)/.test(name)));
    boundary.push({taskId: task.task.taskId, status: "PASS", visibleFiles: visible, instructionOutsideWorkspace: true, hiddenMountRuntimeCheck: "environment-report"});
  } finally { await rm(prepared.root, {recursive: true, force: true}); }
}
const report = {schemaVersion: 1, kind: "evaluator-preflight-only", officialModelTrials: 0, kernelRevision: await harness.currentRevision(projectRoot), taskCount: 4, variants: 4, checks: 16, status: "PASS", results, boundary};
await mkdir(outputRoot, {recursive: true});
await writeFile(path.join(outputRoot, "preflight.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({status: report.status, checks: report.checks, modelCalls: 0, outputRoot}));
