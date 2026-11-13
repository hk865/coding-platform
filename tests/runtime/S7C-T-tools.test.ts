/**
 * T-member-work, T-tool-sets and the Work withdraw grant (book-7c.md:1385–1386).
 *
 * T-member-work (H-03 Work): the fixed worker's offered set has no
 * `create_member`; the same tool name without the boolean grant is `forbidden`;
 * with it the owner answers `needs_decision`/`created`; the next Run of the
 * same Session after the grant narrows is `forbidden`.
 *
 * T-tool-sets (L20/L18): each duty's offered set carries ack/respond, `hand_off`
 * only for executor/adviser, and `withdraw_session_message` only where
 * `send_session_message` is granted; a Work sender withdraws its own message
 * and a foreign one is refused. The real started manifest read is T+L2 (C28),
 * so the sets are read through the selection functions.
 */
import { describe, expect, it } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { HandoffRequestPort } from '../../src/core/agent-runtime/handoff-tools.js';
import {
  finalToolNamesOf, selectWorkToolGroup, type FinalToolListInputV1,
} from '../../src/core/agent-runtime/tool-group-assembly.js';
import type { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { openS7CToolWorld } from '../helpers/S7C-t-fixture.js';
import { seedS7ASenders } from '../helpers/S7A-fixture.js';
import { rlJsonPart } from '../helpers/RL-re2-support.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';

const EXECUTOR_ROLE = platformRoleProfile('executor').template;
const WORK_TOOL_INPUT: Omit<FinalToolListInputV1, 'callKind' | 'selected'> = {
  noteAdmission: { class: 'none' }, reviewPhase: null, hasBlockedCommands: false,
  reviewSource: false, frozenSource: false, materialTools: false,
  owners: { mailbox: true, decisionMessages: true, applicationReceipt: true, sessions: true,
    plans: true, graph: true, notes: true, unknownCallReviews: true, commandRerunRequests: true,
    memberCreation: true, reworkRequests: true, recheckRequests: true },
  readonlyCommand: { requested: false, access: undefined, allowsReadWholeWorkspace: false },
};

const finalNames = (callKind: 'work' | 'query', selected: readonly string[]): string[] => {
  const result = finalToolNamesOf({ ...WORK_TOOL_INPUT, callKind, selected });
  if (!result.ok) throw new Error(`the final tool list refused the selection: ${result.rejection.reason}`);
  return result.value;
};

/* AGTP-4 (AGT+ ruling §3; §1 item 2): one command tool per Run. A Run that selects `shell` does not also get the
 * read-only command; a Run without `shell` does. Today red on the "without shell" row: `finalToolNamesOf` still
 * gates the name on `FinalToolListInputV1.readOnly` (false here), so the writable/no-shell case gets nothing. The
 * package deletes that field and gates only on `!wanted.has('shell')`. */
describe('T-tool-sets: one command tool per Run', () => {
  it.each([
    ['without shell', ['read', 'run_readonly_command'], true],
    ['with shell', ['read', 'run_readonly_command', 'shell'], false],
  ] as const)('AGTP-4 %s: run_readonly_command is offered only when shell is absent', (_label, selected, expected) => {
    const result = finalToolNamesOf({ ...WORK_TOOL_INPUT, callKind: 'work', selected,
      readonlyCommand: { requested: true, access: 'all_except_denied', allowsReadWholeWorkspace: true } });
    if (!result.ok) throw new Error(`AGTP-4 refused the selection: ${result.rejection.reason}`);
    expect(result.value.includes('run_readonly_command')).toBe(expected);
  });
});

describe('T-member-work: the fixed worker and the create_member grant', () => {
  it('refuses create_member without the createMember grant while the tool name stays offered', async () => {
    const world = await openS7CToolWorld({ duty: 'executor', grantTools: ['read', 'create_member'],
      createMember: false });
    try {
      const task = world.tasks[1]!;
      await world.world.scripted.script(world.line, [{ kind: 'calls', calls: [{ callId: 't-member-no-grant',
        name: 'create_member', args: { duty: 'executor', scope: { kind: 'task', task },
          reason: 'S7C T no grant' } }] }, { kind: 'text', text: 'S7C T no grant answer' }]);
      const started = await world.start();
      expect(started.offeredToolNames).toContain('create_member');
      expect(rlJsonPart(started.result ?? undefined)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally {
      await world.world.close();
    }
  });

  it('creates or asks the person once createMember is granted', async () => {
    const world = await openS7CToolWorld({ duty: 'executor', grantTools: ['read', 'create_member'],
      createMember: true });
    try {
      const task = world.tasks[1]!;
      await world.world.scripted.script(world.line, [{ kind: 'calls', calls: [{ callId: 't-member-granted',
        name: 'create_member', args: { duty: 'executor', scope: { kind: 'task', task },
          reason: 'S7C T with grant' } }] }, { kind: 'text', text: 'S7C T with grant answer' }]);
      const started = await world.start();
      const value = rlJsonPart(started.result ?? undefined) as { status?: string; cardKey?: string;
        session?: { sessionId?: string } } | undefined;
      expect(['needs_decision', 'created']).toContain(value?.status);
      if (value?.status === 'needs_decision') {
        expect(value.cardKey).toEqual(expect.any(String));
        expect(value.cardKey!.length).toBeGreaterThan(0);
      } else {
        expect(value?.session?.sessionId).toEqual(expect.any(String));
      }
    } finally {
      await world.world.close();
    }
  });

  it('refuses the next Run of the same Session after narrowGrant narrowed the grant', async () => {
    const world = await openS7CToolWorld({ duty: 'executor', grantTools: ['read', 'create_member'],
      createMember: true });
    try {
      await world.start();
      world.narrowGrant();
      const task = world.tasks[1]!;
      await world.world.scripted.script(world.line, [{ kind: 'calls', calls: [{ callId: 't-member-narrowed',
        name: 'create_member', args: { duty: 'executor', scope: { kind: 'task', task },
          reason: 'S7C T narrowed' } }] }, { kind: 'text', text: 'S7C T narrowed answer' }]);
      const started = await world.start();
      expect(started.offeredToolNames).toContain('create_member');
      expect(rlJsonPart(started.result ?? undefined)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally {
      await world.world.close();
    }
  });
});

describe('T-tool-sets: the duty offered sets', () => {
  const executorGrant = ['hand_off', 'send_session_message', 'ack_session_message',
    'respond_session_message', 'withdraw_session_message'];
  const adviserGrant = ['hand_off', 'ack_session_message', 'respond_session_message'];
  const scribeGrant = ['ack_session_message', 'respond_session_message'];
  const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['executor', executorGrant],
    ['adviser', adviserGrant],
    ['scribe', scribeGrant],
  ];

  it.each(cases)('assembles the %s offered set with ack/respond and withdraw only with send', (_duty, grant) => {
    const names = finalNames('work', grant);
    expect(names).toEqual(expect.arrayContaining(['ack_session_message', 'respond_session_message']));
    expect(names.includes('withdraw_session_message')).toBe(names.includes('send_session_message'));
  });

  it('keeps hand_off a Work-only name in the final offered set', () => {
    expect(finalNames('work', ['hand_off'])).toContain('hand_off');
    expect(finalNames('query', ['hand_off'])).not.toContain('hand_off');
  });

  it('registers hand_off only with both the port and the formal duty', async () => {
    const opened = await openS7CToolWorld({ duty: 'executor', grantTools: ['read', 'create_member'],
      createMember: true });
    try {
      const started = await opened.start();
      const context = started.context;
      if (context === null) throw new Error('the fixture captured no real Work context');
      const port: HandoffRequestPort = async () => ({ status: 'accepted',
        operation: { aggregateType: 'CoreOperation', projectId: 's7c-t-project', operationId: 'op-t02' } });
      const select = (handoffs: HandoffRequestPort | undefined, duty: 'executor' | 'adviser' | undefined) =>
        selectWorkToolGroup({ selected: ['hand_off'], mailbox: undefined,
          sessions: opened.world.platform.sessions, plans: opened.world.platform.plans, context,
          sessionRef: opened.line.ref, runRef: started.run, goalRef: opened.goal,
          requestIdForCall: () => 'trusted-command-1',
          ...(handoffs === undefined ? {} : { handoffs }), ...(duty === undefined ? {} : { duty }) });
      const selected = select(port, 'executor');
      expect(selected.ok).toBe(true);
      if (!selected.ok || selected.value === null) throw new Error('the hand_off selection was refused');
      expect(selected.value.names).toEqual(['hand_off']);
      expect(selected.value.create(null as unknown as WorkspaceSandbox).map(tool => tool.name))
        .toEqual(['hand_off']);
      const noPort = select(undefined, 'executor');
      expect(noPort.ok).toBe(false);
      if (noPort.ok) throw new Error('a hand_off selection without the port was accepted');
      expect(noPort.rejection).toMatchObject({ code: 'unsupported' });
      const noDuty = select(port, undefined);
      expect(noDuty.ok).toBe(false);
      if (noDuty.ok) throw new Error('a hand_off selection without the duty was accepted');
      expect(noDuty.rejection).toMatchObject({ code: 'unsupported' });
    } finally {
      await opened.world.close();
    }
  });
});

describe('T-tool-sets: the Work withdraw grant', () => {
  it('commits the sender\'s own withdraw and refuses a foreign message', async () => {
    const world = await openS7CToolWorld({ duty: 'adviser', createMember: true,
      grantTools: ['send_session_message', 'withdraw_session_message'] });
    try {
      const foreign = await seedS7ASenders(world.world);
      const recipient = (await world.world.createWorkSession('s7c-t-withdraw-recipient')).ref;
      await world.world.scripted.script(world.line, [{ kind: 'calls', calls: [{ callId: 't-withdraw-send',
        name: 'send_session_message', args: { recipient, text: 'S7C T withdraw me', intent: 'notify' } }] },
      { kind: 'text', text: 'S7C T send answer' }]);
      const sent = await world.start();
      const sentValue = rlJsonPart(sent.result ?? undefined) as { status?: string; value?: SessionMessage } | undefined;
      expect(sentValue?.status).toBe('committed');
      const own: SessionMessageRef = sentValue!.value!.ref;

      await world.world.scripted.script(world.line, [{ kind: 'calls', calls: [
        { callId: 't-withdraw-own', name: 'withdraw_session_message', args: { messageRef: own } },
        { callId: 't-withdraw-foreign', name: 'withdraw_session_message',
          args: { messageRef: foreign.messages[0].ref } },
      ] }, { kind: 'text', text: 'S7C T withdraw answer' }]);
      const withdrawn = await world.start();
      expect(withdrawn.offeredToolNames).toContain('send_session_message');
      expect(withdrawn.offeredToolNames).toContain('withdraw_session_message');

      expect(rlJsonPart(withdrawn.results.find(result => result.callId === 't-withdraw-own')))
        .toMatchObject({ status: 'committed' });
      expect(rlJsonPart(withdrawn.results.find(result => result.callId === 't-withdraw-foreign')))
        .toMatchObject({ status: 'rejected', code: 'forbidden' });
      const read = valueOf<SessionMessage>((await world.world.post('messages/read',
        plain(S6A_SCOPE, own))).body, 'ready', 'the withdrawn own message');
      expect(read.withdrawnAt).toEqual(expect.any(String));
    } finally {
      await world.world.close();
    }
  });
});

describe('T-member-work: the fixed worker', () => {
it('offers no create_member to the M world fixed worker', async () => {
  const target = await openS7C1World();
  try {
    if (target.plan === null) throw new Error('the M world Goal has no adopted Plan');
    const fixedTask = {
      taskId: 's7c-t-fixed-worker', title: 'S7C T fixed worker', requirementLevel: 'required' as const,
      taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
      scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const,
    };
    const task: TaskTriple = { projectId: target.goal.projectId, goalId: target.goal.goalId,
      taskId: fixedTask.taskId };
    const draft = draftFrom(target.plan, 's7c-t-fixed-plan', plan => ({ ...plan,
      tasks: [...plan.tasks, fixedTask],
      assignments: [...(plan.assignments ?? []), { taskId: fixedTask.taskId,
        role: EXECUTOR_ROLE.templateId, instruction: 'S7C T fixed worker' }],
      obligations: plan.obligations.map(obligation => ({ ...obligation,
        taskIds: [...obligation.taskIds, fixedTask.taskId] })) }));
    const proposed = valueOf<{ ref: unknown; revision: number }>(await target.main.post('plans/propose',
      graphWrite(S6A_SCOPE, { goalRef: target.goal, basedOn: target.plan.ref, draft,
        reason: { text: 'S7C T fixed worker', sources: [] } }, 's7c-t-fixed-propose')),
    'committed', 'the fixed worker Plan proposal');
    valueOf(await target.main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
    }, 's7c-t-fixed-apply')), 'committed', 'the fixed worker Plan adoption');

    await target.world.scripted.script(target.lines.fixed,
      [{ kind: 'text', text: 'S7C T fixed worker answer' }]);
    const claimInput = await advanceUntil(target.world.ag2b, { schemaVersion: 1, goalRef: target.goal,
      flowId: 's7c-t-fixed-worker', sessionHint: target.lines.fixed.ref, kind: 'select_work',
      taskId: task.taskId }, 'claim_task');
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(target.world.ag2b, claimInput, { stopBefore: 'claim_task', receipts });
    const requests = await target.world.scripted.requests(target.lines.fixed);
    const offered = requests[0]?.tools.map(tool => tool.name) ?? [];
    expect(offered).not.toContain('create_member');
  } finally {
    await target.close();
  }
});
});
