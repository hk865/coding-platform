import './process-loader.mjs';
import { readFileSync, existsSync } from 'node:fs';
const { appendFileSync, writeFileSync } = await import('node:fs');
const { join } = await import('node:path');
const { createPersistentSqliteHarness } = await import('../../src/harness/persistent-harness.ts');
const { CodingAgentRuntime } = await import('../../src/execution/worker-runtime/coding-agent-runtime.ts');
const { LeasedWorkerRuntime } = await import('../../src/control/dispatch-engine/leased-worker-runtime.ts');
const { RuntimeDispatch } = await import('../../src/control/dispatch-engine/runtime-dispatch.ts');
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const die = boundary => { if (request.fault === boundary) process.exit(86); };
const runtime = new CodingAgentRuntime(request.runsDir, async () => ({
  configuration: { revision: 'test', provider: 'deepseek', model: 'capture', baseUrl: 'http://127.0.0.1' },
  client: { async *stream(modelRequest) {
    appendFileSync(request.counter, JSON.stringify({ pid: process.pid, requestId: modelRequest.requestId }) + '\n', { flush: true });
    die('provider_effect');
    if (request.cancelDuringProvider) {
      const id = 'cancel-during-provider';
      const canonical = await h.ledger.load(request.runRef);
      const receipt = await h.control.submitControl({ schemaVersion: 1, commandType: 'SubmitControl', commandId: id,
        identity: { projectId: request.scope.projectId, actor: { kind: 'human', id: 'user-1' }, idempotencyKey: id },
        aggregateId: id, expectedRevision: 0, correlationId: id, submittedAt: request.at,
        payload: { intent: { schemaVersion: 1, intentId: id, ...request.scope, kind: 'cancel',
          scope: { ...request.scope, goalId: request.runRef.goalId, taskId: canonical.snapshot.task.taskId, runRef: request.runRef },
          reason: 'cancel during provider', steer: null, desiredState: 'cancelled', status: 'queued', acks: [],
          resumeFromIntentRef: null, submittedAt: request.at, updatedAt: request.at } } });
      if (receipt.status !== 'committed') throw Error('cancel not committed: ' + JSON.stringify(receipt));
      await runtime.cancel(request.runRef);
    }
    yield { schemaVersion: 1, requestId: modelRequest.requestId, sequence: 1, type: 'text_delta', delta: 'process witness' };
    yield { schemaVersion: 1, requestId: modelRequest.requestId, sequence: 2, type: 'completed', reason: 'final_answer' };
  } },
}));
await runtime.init();
let h;
h = await createPersistentSqliteHarness({ dir: request.stateDir, deps: { clock: () => request.at },
  runtimePreparation: runtime, workspaceRootFor: () => request.sourceRoot,
  runtime: { capabilities: () => runtime.capabilities(), start: (envelope, access) => {
    die('before_start');
    return new LeasedWorkerRuntime({ runtime, lease: () => h.workspaceLease, vault: () => h.vault,
      materials: async () => undefined, now: () => request.at }).start(envelope, access);
  } },
});
const originalStart = h.control.startRun.bind(h.control);
h.control.startRun = async command => {
  const receipt = await originalStart(command);
  if (receipt.status === 'committed' && !receipt.replayed) die('after_start_authorization');
  return receipt;
};
const originalFact = h.control.runFact.bind(h.control);
h.control.runFact = async command => {
  if (command.payload.fact.kind === 'execution_entered' && request.entryReady) {
    writeFileSync(request.entryReady, String(process.pid));
    const deadline = Date.now() + 90_000;
    while (!existsSync(request.entryGo)) { if (Date.now() >= deadline) throw Error('execution barrier timeout'); await new Promise(r => setTimeout(r, 10)); }
  }
  if (request.markUnknownBeforeTerminal && command.payload.fact.kind === 'runtime_event' &&
      ['run_completed','run_failed','run_cancelled'].includes(command.payload.fact.event.eventType)) {
    const unknown = await originalFact({ ...command, commandId: command.commandId + '-unknown',
      identity: { ...command.identity, idempotencyKey: command.identity.idempotencyKey + '-unknown' },
      payload: { fact: { kind: 'outcome_unknown', runRef: request.runRef, reason: 'terminal handoff interrupted before receipt' } } });
    if (unknown.status !== 'committed') throw Error('unknown not committed: ' + JSON.stringify(unknown));
    return { status: 'rejected', commandId: command.commandId, code: 'after_terminal' };
  }
  const result = await originalFact(command);
  if (result.status === 'committed') {
    if (command.payload.fact.kind === 'runtime_input_bound') die('after_bind');
    if (command.payload.fact.kind === 'model_request_evidence') die('after_attempt');
    if (command.payload.fact.kind === 'runtime_event' && result.terminal) die('after_terminal');
  }
  return result;
};
const originalAuthorize = h.control.authorizeModelRequest.bind(h.control);
h.control.authorizeModelRequest = async command => {
  const result = await originalAuthorize(command);
  if (result.status === 'committed') die('after_authorize');
  return result;
};
try {
  if (request.ready) {
    writeFileSync(request.ready, String(process.pid));
    const deadline = Date.now() + 20_000;
    while (!existsSync(request.go)) { if (Date.now() >= deadline) throw Error('race barrier timeout'); await new Promise(r => setTimeout(r, 10)); }
  }
  const reconciler = new RuntimeDispatch({ ledger: h.ledger, control: h.control, outbox: { drive: trigger => h.drive(trigger) }, runtime, now: () => request.at });
  const recovery = request.recover ? await reconciler.recover([request.scope]) : null;
  const result = await h.drive({ reason: 'independent-process', maxIntents: 1 });
  const loaded = await h.ledger.load(request.runRef);
  process.stdout.write(JSON.stringify({ pid: process.pid, recovery, result, run: loaded, runtime: runtime.all().map(r => ({ status: r.status, error: r.error })) }));
} finally { await runtime.close(); await h.close(); }
