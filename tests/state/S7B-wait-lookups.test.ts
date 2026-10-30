/**
 * M-lookups (SR3 §3.5; book `7b:1195`): both indexes are registered once on the canonical SessionMessage schema with
 * exact paths and order, and the sender-session wait lookup walks past its first internal page to return the one
 * `waitAfterSend` inquiry. The due-order half is L's (R4-14 item 3) and the 2,501 `incomplete` case is not run (R4-15).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordLookupIndex } from '../../src/core/record-store/lookup-ports.js';
import {
  S7B_DUE_WAITS_LOOKUP, S7B_WAITS_BY_SENDER_SESSION_LOOKUP, SESSION_MESSAGE_RECORD_SCHEMAS,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openS7BLookupWorld, openS7BWorld, readS7BWaits } from '../helpers/S7B-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

function registrationsOf(name: string): RecordLookupIndex[] {
  return (SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []).filter(index => index.name === name);
}

it('M-lookups: both indexes are registered once with exact paths and order', () => {
  expect(registrationsOf(S7B_WAITS_BY_SENDER_SESSION_LOOKUP)).toEqual([{
    name: S7B_WAITS_BY_SENDER_SESSION_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'sender.sessionRef.sessionId', 'intent'],
    orderBy: { path: 'since', valueType: 'text' },
  }]);
  expect(registrationsOf(S7B_DUE_WAITS_LOOKUP)).toEqual([{
    name: S7B_DUE_WAITS_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'release', 'intent'],
    orderBy: { path: 'deadline', valueType: 'text' },
  }]);
});

describe.each(['memory', 'sqlite'] as const)('M-lookups waits by sender Session (%s)', (backend) => {
  it('finds the only wait after the first page and returns it as waits[0] and wait', async () => {
    const { world } = await openS7BWorld({ backend });
    worlds.push(world);
    const { sender, messages, pageBoundary } = await openS7BLookupWorld(world, { count: 101 });
    // The one wait is the 101st inquiry, one past the internal 100-row page; `pageBoundary` is the 100th.
    expect(messages).toHaveLength(101);
    expect(pageBoundary).toEqual(messages[99]);
    const waiting = messages[100]!;
    const { waits, wait } = await readS7BWaits(world, { session: sender, messageRef: waiting });
    expect(waits.map(row => row.messageRef)).toEqual([waiting]);
    expect(wait?.messageRef).toEqual(waiting);
  });
});
