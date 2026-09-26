/** Reviewer-controlled races against real stores and lifecycle writers. */
import { afterEach, describe, expect, it } from 'vitest';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { SessionLifecyclePort } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { encodeSessionRecord } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createGraphSessionFixture, lifecycleRequest, linkRequest,
  type GraphSessionFixture } from '../helpers/graph-session-fixture.js';

const fixtures: GraphSessionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function make(kind: 'memory' | 'sqlite') {
  const f = await createGraphSessionFixture(kind); fixtures.push(f); return f;
}

describe.each(['memory', 'sqlite'] as const)('A1 Session independent %s races', kind => {
  it.each(['archive', 'close'] as const)('%s restores an identical request that commits after a missed receipt lookup', async mode => {
    const f = await make(kind);
    const session = await f.createSession(`receipt-race-${mode}`);
    let submit: (service: SessionLifecyclePort) => Promise<WriteResult<unknown>>;
    if (mode === 'archive') {
      const request = await lifecycleRequest(f, session, 'identical-archive-race');
      submit = service => service.archiveSession(f.ctx, request);
    } else {
      const task = await f.seedAcceptedTask();
      const target = { kind: 'task' as const, ref: task.taskRef };
      expect(await f.lifecycle.linkSessionWork(f.ctx,
        await linkRequest(f, session, target, 'responsible', true, 'before-identical-close')))
        .toMatchObject({ status: 'committed' });
      const request = await linkRequest(f, session, target, 'responsible', false, 'identical-close-race');
      submit = service => service.linkSessionWork(f.ctx, request);
    }
    let original: WriteResult<unknown> | undefined;
    let injected = false;
    const records = { ...f.records,
      async lookupCommit(input: Parameters<typeof f.records.lookupCommit>[0]) {
        const missed = await f.records.lookupCommit(input);
        if (!injected && missed.status === 'rejected' && missed.code === 'not_found') {
          injected = true;
          original = await submit(f.lifecycle);
          expect(original.status).toBe('committed');
        }
        return missed;
      },
    };
    const raced = await submit(createSessionLifecycleService({ records, lookups: records }));
    expect(injected).toBe(true);
    expect(original).toMatchObject({ status: 'committed', replayed: false });
    expect(raced).toEqual({ ...original, replayed: true });
  });

  it('does not emit an active target card assembled from an old link head and newer closed links', async () => {
    const f = await make(kind);
    const task = await f.seedAcceptedTask();
    const target = { kind: 'task' as const, ref: task.taskRef };
    const session = await f.createSession('discovery-race');
    expect(await f.lifecycle.linkSessionWork(f.ctx,
      await linkRequest(f, session, target, 'responsible', true, 'discovery-race-open')))
      .toMatchObject({ status: 'committed' });
    const closing = await linkRequest(f, session, target, 'responsible', false, 'discovery-race-close');
    let closed = false;
    const records = { ...f.records,
      async lookup(input: Parameters<typeof f.records.lookup>[0]) {
        const page = await f.records.lookup(input);
        if (!closed && page.status === 'ready' && input.index.startsWith('session-links-by-task') && page.value.records.length > 0) {
          closed = true;
          expect(await f.lifecycle.linkSessionWork(f.ctx, closing)).toMatchObject({ status: 'committed' });
        }
        return page;
      },
    };
    const directory = createSessionDirectory({ records, lookups: records });
    const result = await directory.findSessions(f.ctx,
      { workspace: f.scope, target, includeArchived: false, page: { limit: 5 } });
    expect(closed).toBe(true);
    expect(result).toMatchObject({ status: 'rejected', code: 'source_stale' });
    // A fresh read after the race must agree that the only relation ended.
    expect(await f.sessionsPort.findSessions(f.ctx,
      { workspace: f.scope, target, includeArchived: false, page: { limit: 5 } }))
      .toMatchObject({ status: 'ready', value: { items: [] } });
  });

  it('replays an original open even when a later peer archive makes the current Session busy for opening', async () => {
    const f = await make(kind);
    const task = await f.seedAcceptedTask();
    const session = await f.createSession('replay-open-after-archive');
    const target = { kind: 'task' as const, ref: task.taskRef };
    // An investigation link does not create an unfinished responsibility that
    // would block archive. Both peer transitions use real lifecycle writers.
    const opening = await linkRequest(f, session, target, 'investigated', true, 'identical-original-open');
    let original: WriteResult<unknown> | undefined;
    let injected = false;
    const records = { ...f.records,
      async lookupCommit(input: Parameters<typeof f.records.lookupCommit>[0]) {
        const missed = await f.records.lookupCommit(input);
        if (!injected && missed.status === 'rejected' && missed.code === 'not_found') {
          injected = true;
          original = await f.lifecycle.linkSessionWork(f.ctx, opening);
          expect(original.status).toBe('committed');
          expect(await f.lifecycle.archiveSession(f.ctx,
            await lifecycleRequest(f, session, 'archive-after-original-open'))).toMatchObject({ status: 'committed' });
        }
        return missed;
      },
    };
    const raced = await createSessionLifecycleService({ records, lookups: records }).linkSessionWork(f.ctx, opening);
    expect(injected).toBe(true);
    expect(original).toMatchObject({ status: 'committed', replayed: false });
    expect(raced).toEqual({ ...original, replayed: true });
    expect(await f.sessionsPort.readSession(f.ctx, session))
      .toMatchObject({ status: 'ready', value: { record: { lifecycle: 'archived' } } });
  });

  it('deduplicates legal escaped Session IDs across differently populated relation streams and pages', async () => {
    const f = await make(kind);
    const task = await f.seedAcceptedTask();
    const target = { kind: 'task' as const, ref: task.taskRef };
    const templateRef = await f.createSession('escaped-id-template');
    const template = await f.sessionsPort.readSession(f.ctx, templateRef);
    expect(template.status).toBe('ready');
    if (template.status !== 'ready') return;
    const aliases = ['!', '\n'].map(sessionId => ({ projectId: f.projectId, sessionId }));
    // Trusted accepted-record seed: SessionRef permits any nonempty string,
    // not only today's hash-based producer IDs. Independent Kernel identities
    // are included, although graph discovery never invokes the Kernel.
    expect(await f.commitRaw(aliases.map((ref, index) => encodeSessionRecord({
      ...template.value.record,
      ref: { ...ref, aggregateType: 'Session' }, revision: 1,
      kernel: { ...template.value.record.kernel, kernelSessionId: `accepted-escaped-session-${index}` },
    })))).toMatchObject({ status: 'committed' });
    for (const session of aliases) {
      expect(await f.lifecycle.linkSessionWork(f.ctx,
        await linkRequest(f, session, target, 'responsible', true, `escaped-responsible-${session.sessionId}`)))
        .toMatchObject({ status: 'committed' });
    }
    expect(await f.lifecycle.linkSessionWork(f.ctx,
      await linkRequest(f, aliases[1]!, target, 'participates', true, 'escaped-participates')))
      .toMatchObject({ status: 'committed' });
    // Store order in the responsible stream is ! then escaped newline;
    // raw UTF-8 merge order reverses them and emits newline twice.
    const seen: string[] = [];
    let cursor: string | undefined;
    let finished = false;
    for (let page = 0; page < 6; page++) {
      const result = await f.sessionsPort.findSessions(f.ctx, { workspace: f.scope, target, includeArchived: false,
        page: { limit: 1, ...(cursor === undefined ? {} : { cursor }) } });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      seen.push(...result.value.items.map(card => card.record.ref.sessionId));
      if (result.value.nextCursor === null) { finished = true; break; }
      cursor = result.value.nextCursor;
    }
    expect(finished).toBe(true);
    expect(seen).toHaveLength(2);
    expect(new Set(seen)).toEqual(new Set(aliases.map(ref => ref.sessionId)));
  });
});
