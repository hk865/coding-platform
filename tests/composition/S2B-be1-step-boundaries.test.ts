/**
 * Slice 2B BE1 acceptance row 2B-06 (spec §5.2, entry BE1).
 *
 * The step-count boundaries: a read the read-permission Hook blocks (no
 * `tool.started`), calls the Kernel never starts after the call budget is spent,
 * a started-then-refused `shell` (sandbox unavailable and invalid arguments),
 * and a communication tool. Only started calls become steps; only `edit`/`shell`
 * can become edits (L1; F5, F6, F10, F29).
 */
import { afterEach, expect, it } from 'vitest';
import { createS2BBe1Platform, S2B_SLOW_TIMEOUT_MS, type S2BBe1PlatformFixture } from '../helpers/S2B-be1-platform-fixture.js';

const opened: S2BBe1PlatformFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

it('2B-06 a read the read-permission Hook blocks leaves no tool.started and is not a step', async () => {
  const f = await createS2BBe1Platform({
    toolNames: ['read'],
    writeScope: [],
    initialAt: '2026-10-15T10:00:00.000Z',
    workspaceFiles: { 'a.ts': 'allowed\n', 'secret.txt': 'blocked\n' },
    allowsRead: path => path !== 'secret.txt',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1-blocked', name: 'read', args: { path: 'secret.txt' } }] },
      { kind: 'text', text: '2B-06 blocked read done' },
    ],
  });
  opened.push(f);

  const record = await f.run('2b06-blocked');
  expect(record.run.status).toBe('ended');

  // The Hook refused before the call started: the Kernel has one `tool.failed`
  // (pre_execution) with no `tool.started`, so the tally is a counted zero.
  const followUp = f.scripted.requests.at(-1);
  expect(followUp?.messages.some(message => message.role === 'tool' && message.callId === 'be1-blocked')).toBe(true);
  const views = await f.readRuns();
  expect(views[0]).toMatchObject({ status: 'counted', reason: null,
    totals: { steps: 0, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true, unresolvedCalls: 0 });
}, S2B_SLOW_TIMEOUT_MS);

it('2B-06 calls the Kernel never starts after the call budget is spent are not steps', async () => {
  const f = await createS2BBe1Platform({
    toolNames: ['read'],
    writeScope: [],
    initialAt: '2026-10-15T10:00:00.000Z',
    workspaceFiles: { 'a.ts': 'budget\n' },
    maxToolCalls: 2,
    scriptedReplies: [
      { kind: 'calls', calls: [
        { callId: 'be1-budget-1', name: 'read', args: { path: 'a.ts' } },
        { callId: 'be1-budget-2', name: 'read', args: { path: 'a.ts' } },
      ] },
      { kind: 'calls', calls: [{ callId: 'be1-budget-3', name: 'read', args: { path: 'a.ts' } }] },
      { kind: 'text', text: '2B-06 budget done' },
    ],
  });
  opened.push(f);

  await f.run('2b06-budget');

  const views = await f.readRuns();
  // The two started calls are steps; the third is refused before `tool.started`
  // (the budget is spent) and is not a step and not an unresolved call.
  expect(views[0]).toMatchObject({ status: 'counted',
    totals: { steps: 2, edits: 0, editsUnknown: 0 }, unresolvedCalls: 0 });
}, S2B_SLOW_TIMEOUT_MS);

it('2B-06 a started shell refused because the sandbox is unavailable is one step and zero edits', async () => {
  const previous = process.env['CODING_AGENT_BWRAP_PATH'];
  process.env['CODING_AGENT_BWRAP_PATH'] = '/nonexistent/s2b-be1/bwrap';
  try {
    const f = await createS2BBe1Platform({
      toolNames: ['read', 'shell'],
      writeScope: ['.'],
      shell: true,
      initialAt: '2026-10-15T10:00:00.000Z',
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'be1-sandbox', name: 'shell', args: { command: 'echo hi' } }] },
        { kind: 'text', text: '2B-06 sandbox done' },
      ],
    });
    opened.push(f);

    const record = await f.run('2b06-sandbox');
    expect(record.run.status).toBe('ended');

    const followUp = f.scripted.requests.at(-1);
    expect(followUp?.messages.find(message => message.role === 'tool' && message.callId === 'be1-sandbox'))
      .toMatchObject({ result: { status: 'error', error: { code: 'sandbox_unavailable' },
        effects: { sideEffect: 'none', changedPaths: [] } } });
    const views = await f.readRuns();
    // F6/L3: the dispatcher refused the started `shell` before execution with
    // effects `none`, so no command ran: one step, zero edits, and NOT the
    // `command_ran` incompleteness reason.
    expect(views[0]).toMatchObject({ status: 'counted',
      totals: { steps: 1, edits: 0, editsUnknown: 0 }, unresolvedCalls: 0,
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false } });
  } finally {
    if (previous === undefined) delete process.env['CODING_AGENT_BWRAP_PATH'];
    else process.env['CODING_AGENT_BWRAP_PATH'] = previous;
  }
}, S2B_SLOW_TIMEOUT_MS);

it('2B-06 a started shell refused with invalid_arguments is one step and zero edits', async () => {
  const f = await createS2BBe1Platform({
    toolNames: ['read', 'shell'],
    writeScope: ['.'],
    shell: true,
    initialAt: '2026-10-15T10:00:00.000Z',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1-invalid', name: 'shell', args: { command: 123 } }] },
      { kind: 'text', text: '2B-06 invalid done' },
    ],
  });
  opened.push(f);

  await f.run('2b06-invalid');

  const followUp = f.scripted.requests.at(-1);
  expect(followUp?.messages.find(message => message.role === 'tool' && message.callId === 'be1-invalid'))
    .toMatchObject({ result: { status: 'error', error: { code: 'invalid_arguments' },
      effects: { sideEffect: 'none' } } });
  const views = await f.readRuns();
  // F6/L3: the dispatcher's `invalid_arguments` refusal carries effects `none`:
  // the started `shell` did not run, so it is one step and not `command_ran`.
  expect(views[0]).toMatchObject({ status: 'counted', totals: { steps: 1, edits: 0, editsUnknown: 0 },
    changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false } });
}, S2B_SLOW_TIMEOUT_MS);

it('2B-06 a communication tool call is one step and zero edits', async () => {
  const f = await createS2BBe1Platform({
    toolNames: ['read', 'send_session_message'],
    writeScope: [],
    initialAt: '2026-10-15T10:00:00.000Z',
    workspaceFiles: { 'a.ts': 'comm\n' },
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1-send', name: 'send_session_message',
        args: { recipient: { projectId: 'r4c-claim-project', sessionId: 'r4c-claim-session' },
          text: '2B-06 ping', intent: 'inquiry', needsReply: false } }] },
      { kind: 'text', text: '2B-06 send done' },
    ],
  });
  opened.push(f);

  await f.run('2b06-send');

  const views = await f.readRuns();
  expect(views[0]).toMatchObject({ status: 'counted', totals: { steps: 1, edits: 0, editsUnknown: 0 },
    changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false },
    recordedBy: 'run_end', unresolvedCalls: 0 });
}, S2B_SLOW_TIMEOUT_MS);
