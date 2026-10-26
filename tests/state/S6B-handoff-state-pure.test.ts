/**
 * The pure admission of a handoff and of a secretary archive (A5): which step refuses first when two fail, the
 * pre-check before the owner reads (`read: null`), and the accepted record each starts from. Each refusal reached
 * through the owner's real facts is the service row's; the archive pair has no service yet, so its table is here.
 */
import { describe, expect, it } from 'vitest';
import {
  admitHandoff, admitSecretaryArchive, newHandoffOperationRecord, newSecretaryArchiveOperationRecord,
} from '../../src/core/work-graph/state/session-handoff.js';

const P = 's6b-p';
const at = '2026-10-25T01:00:00.000Z';
const op = (operationId: string) => ({ aggregateType: 'CoreOperation' as const, projectId: P, operationId });
const line = (duty: string, change: object = {}) => ({ kind: 'present', archived: false, readonlyCopy: false, duty, ...change });
const handoff = (change: object = {}, read: object = {}) => ({ caller: 'host_human', trigger: 'manual', inScope: true,
  shapeProblem: null, read: { source: line('executor'), unfinished: [],
    targets: [{ kind: 'create', duty: 'executor' }, { kind: 'existing', session: line('executor') }], ...read }, ...change }) as never;
const archive = (change: object = {}, read: object = {}) => ({ caller: 'host_human', inScope: true, shapeProblem: null,
  read: { source: line('secretary'), unfinished: [], ...read }, ...change }) as never;
const blocked = (code: string, detail: string) => ({ ok: false, reason: 'guard_failed', code, detail });
const busy = { ...blocked('busy', 'the source Session has an unfinished handoff or archive operation'),
  current: [{ ref: op('h0'), revision: 2 }] };

describe('rejects: a handoff, the earlier step first', () => {
  it.each<[string, unknown, object]>([
    ['caller before scope', handoff({ caller: 'host_system', inScope: false }), blocked('forbidden', 'a manual handoff needs the Host person')],
    ['scope before shape', handoff({ inScope: false, shapeProblem: 'x' }), blocked('forbidden', "the handoff workspace is not the call's workspace")],
    ['an unknown trigger reaches the shape', handoff({ trigger: 'auto', shapeProblem: 'HandoffAction.input.trigger is not recognized' }),
      blocked('invalid', 'HandoffAction.input.trigger is not recognized')],
    ['shape before the source', handoff({ shapeProblem: 'x' }, { source: { kind: 'missing' } }), blocked('invalid', 'x')],
    ['the source before a target', handoff({}, { source: line('executor', { archived: true }), targets: [{ kind: 'existing', session: { kind: 'missing' } }] }),
      blocked('invalid', 'the source Session is archived')],
    ['a missing target before the duty', handoff({}, { source: line('unknown'), targets: [{ kind: 'existing', session: { kind: 'missing' } }] }),
      blocked('not_found', 'assignments[0].target is not a Session of the workspace')],
    ['the duty before unfinished work', handoff({}, { targets: [{ kind: 'create', duty: 'adviser' }], unfinished: busy.current }),
      blocked('invalid', "assignments[0].target's duty adviser is not the source Session's duty executor")],
  ])('%s', (_case, facts, expected) => {
    expect(admitHandoff(facts as never)).toEqual(expected);
  });
});

describe('a handoff that passes', () => {
  it.each<[string, unknown]>([
    ['the three steps before the read', handoff({ read: null })],
    ['the whole table', handoff()],
    ['a too_long handoff of the Host system', handoff({ caller: 'host_system', trigger: 'too_long' })],
  ])('passes %s', (_case, facts) => {
    expect(admitHandoff(facts as never)).toEqual({ ok: true });
  });

  it('starts at revision 1 with one progress entry per assignment and per task', () => {
    const task = (taskId: string) => ({ projectId: P, goalId: 'g1', taskId });
    const input = { workspace: { projectId: P, workspaceId: 'w' }, source: { projectId: P, sessionId: 's1' }, trigger: 'manual',
      actor: { kind: 'human', id: 'operator' }, commandId: 'c1', fingerprint: 'a'.repeat(64),
      assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: [task('a'), task('b')] },
        { target: { kind: 'existing', session: { projectId: P, sessionId: 's2' } }, tasks: [] }] };
    const transfer = (taskId: string) => ({ task: task(taskId), input: null, receipt: null });
    expect(newHandoffOperationRecord({ ref: op('h1'), at, input })).toEqual({ ref: op('h1'), revision: 1, workspaceId: 'w',
      action: { kind: 'handoff', input, progress: { stage: 'accepted', advanceGeneration: 1, fence: null, stoppedWriter: null,
        assignments: [{ successor: null, createOperation: null, createInput: null, transfers: [transfer('a'), transfer('b')] },
          { successor: null, createOperation: null, createInput: null, transfers: [] }],
        coverage: null, understanding: [], brief: null, routing: null, archiveRequest: null, noticeItemKey: null, lastRefusal: null } },
      phase: 'accepted', requestedAt: at, updatedAt: at, observation: null, failure: null });
  });
});

describe('rejects: a secretary archive', () => {
  it.each<[string, unknown, object]>([
    ['the system as caller', archive({ caller: 'host_system', inScope: false }), blocked('forbidden', 'a secretary archive needs the Host person')],
    ['another workspace', archive({ inScope: false, shapeProblem: 'x' }), blocked('forbidden', "the archive workspace is not the call's workspace")],
    ['a bad shape', archive({ shapeProblem: 'x' }, { source: { kind: 'missing' } }), blocked('invalid', 'x')],
    ['a missing source', archive({}, { source: { kind: 'missing' } }), blocked('not_found', "the source Session is not in the call's workspace")],
    ['a read-only copy', archive({}, { source: line('secretary', { readonlyCopy: true }) }), blocked('invalid', 'the source Session is a read-only copy')],
    ['another duty', archive({}, { source: line('executor'), unfinished: busy.current }),
      blocked('invalid', "the source Session's duty executor is not secretary")],
    ['unfinished work', archive({}, { unfinished: busy.current }), busy],
  ])('%s', (_case, facts, expected) => {
    expect(admitSecretaryArchive(facts as never)).toEqual(expected);
  });
});

describe('a secretary archive that passes', () => {
  it('passes, and starts at revision 1 with one item per choice', () => {
    expect(admitSecretaryArchive(archive({ read: null }))).toEqual({ ok: true });
    expect(admitSecretaryArchive(archive())).toEqual({ ok: true });
    const root = (queryJobId: string) => ({ aggregateType: 'QueryJob', projectId: P, workspaceId: 'w', queryJobId });
    const input = { source: { projectId: P, sessionId: 's1' }, choices: [{ requestRoot: root('r1'), to: null }],
      actor: { kind: 'human' as const, id: 'operator' },
      commandId: 'c2', fingerprint: 'b'.repeat(64) };
    expect(newSecretaryArchiveOperationRecord({ ref: op('a1'), workspaceId: 'w', at, input })).toEqual({ ref: op('a1'),
      revision: 1, workspaceId: 'w', action: { kind: 'secretary_archive', input, progress: { stage: 'accepted',
        advanceGeneration: 1, items: [{ requestRoot: root('r1'), input: null, outcome: null, routingRound: null, reason: null,
          cursor: null }], archiveRequest: null, lastRefusal: null } },
      phase: 'accepted', requestedAt: at, updatedAt: at, observation: null, failure: null });
  });
});
