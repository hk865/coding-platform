/** Browser-only setup through real Control commands in the server's SQLite store. */
import { randomUUID } from 'node:crypto';
import { createPersistentSqliteHarness } from '../../../dist/harness/persistent-harness.js';
import { buildDispatchClaimCommand } from '../../../dist/fixtures/dispatch-fixtures.js';
import { workContextRefFor } from '../../../dist/contracts/context-continuity.js';
import { workParticipationRefFor, directedRequestRefFor, waitConditionRefFor } from '../../../dist/contracts/coordination.js';
const projectId = 'acceptance-alpha', workspaceId = 'workspace-main', goalId = 'acceptance-demo';
const at = new Date().toISOString();
const h = await createPersistentSqliteHarness({ dir: process.argv[2], deps: { eventId: randomUUID, commandId: randomUUID, correlationId: randomUUID, clock: () => at } });
const checked = receipt => { if (receipt.status !== 'committed') throw Error(JSON.stringify(receipt)); return receipt; };
const work = workContextRefFor(projectId, workspaceId, 'browser-communication');
const part = workParticipationRefFor(projectId, workspaceId, work.workId, 'browser-part');
const runRef = { aggregateType: 'Run', projectId, goalId, runId: 'browser-communication-run' };
const role = { schemaVersion: 1, bindingId: 'gui-fixture-communication', templateId: 'gui-fixture', templateRevision: '1', bindingVersion: 1, policyRevision: 'fixture-only-v1' };
const agent = { kind: 'agent', id: 'browser-communication-agent', runRef };
const principal = { schemaVersion: 1, agentInstanceId: agent.id, workContextRef: work, participationRef: part, roleBinding: role, runRef };
const command = (commandType, aggregateId, payload, expectedRevision = 0) => {
  const id = randomUUID();
  return { commandType, commandId: id, schemaVersion: 1, aggregateId, expectedRevision, correlationId: id, submittedAt: at,
    identity: { projectId, actor: agent, agentPrincipal: principal, idempotencyKey: id }, payload };
};
try {
  if (process.argv[3] === 'cancel') {
    const wait = await h.ledger.load(waitConditionRefFor(projectId, workspaceId, 'browser-wait'));
    if (wait.status !== 'found') throw Error('wait missing');
    checked(await h.control.cancelCommunication(command('CancelCommunication', 'browser-wait', { workspaceId, target: 'wait', reason: 'browser cancellation through Control' }, wait.snapshot.revision)));
  } else {
    const goal = await h.ledger.load({ aggregateType: 'Goal', projectId, goalId });
    if (goal.status !== 'found' || !goal.snapshot.activePlanRevision) throw Error('sample plan not installed');
    const plan = await h.ledger.load(goal.snapshot.activePlanRevision);
    if (plan.status !== 'found') throw Error('plan missing');
    const taskId = plan.snapshot.tasks[0].taskId;
    checked(await h.control.claimTask(buildDispatchClaimCommand({ projectId, goalId, taskId, attemptId: 'browser-communication-attempt', runId: runRef.runId,
      commandId: randomUUID(), correlationId: randomUUID(), idempotencyKey: 'browser-communication-claim', submittedAt: at,
      roleBinding: role, declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { tokenBudget: 10000, deadline: null } })));
    const bind = command('BindWorkContext', work.workId, { workspaceId, workKind: 'task', goalId, taskId, planRef: plan.snapshot.ref, planRevision: plan.snapshot.revision, roleBindingRef: role, initialRunRef: runRef });
    bind.identity = { projectId, actor: { kind: 'system', id: 'browser-fixture' }, idempotencyKey: bind.commandId };
    checked(await h.control.bindWorkContext(bind));
    checked(await h.control.registerAgentInstance(command('RegisterAgentInstance', agent.id, { workspaceId, templateId: role.templateId, templateRevision: '1' })));
    checked(await h.control.startWorkParticipation(command('StartWorkParticipation', part.participationId, { workspaceId, workContextRef: work, agentInstanceId: agent.id, roleBinding: role, runRef })));
    const body = await h.vault.put({ contentType: 'text/plain', body: 'Please provide one optional report', ownerRef: runRef, requestedAt: at, sourceRefs: [{ kind: 'workspace', refId: workspaceId, revision: '1' }] });
    if (body.status !== 'stored') throw Error('body storage failed');
    const requestRef = directedRequestRefFor(projectId, workspaceId, 'browser-report');
    checked(await h.control.sendDirectedRequest(command('SendDirectedRequest', requestRef.requestId, { workspaceId, fromParticipationRef: part, fromRunRef: runRef,
      toWorkContextRef: work, expectedParticipationRef: part, statement: 'Optional report', statementBodyRef: body.ref, roleBinding: role })));
    checked(await h.control.registerWait(command('RegisterWait', 'browser-wait', { workspaceId, mode: 'any', ownerWorkContextRef: work,
      ownerParticipationRef: part, predecessorRunRef: runRef, conditions: [{ kind: 'request_responded', requestRef }], deadlineAt: null })));
  }
  console.log('communication fixture committed');
} finally { await h.close(); }
