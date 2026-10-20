/**
 * B2-12 (L19a, K8-6) recognition order/matching (F-046): the recognizer's
 * no-I/O rows call the exported pure `createCommandRecognizer` directly with
 * built records/requests.
 *
 * Moved out of `B2-12-recognition.test.ts`, whose shared recognizer wired a
 * workspace read for every row. These rows never read a workspace, so no
 * `readWorkspace` port is passed at all; the digests are hand-computed with
 * `node:crypto` from the spec's own rules (L19a: hash the normalised command
 * text; a comparison key is sha256 of the JSON words array), never taken from a
 * production constant or another program's output.
 */
import { describe, expect, it } from 'vitest';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import { ctx, keyOf, record, request, sha } from '../helpers/B2-12-recognition-fixture.js';

// No readWorkspace: each row below is decided from the built records/requests
// alone (the recognizer's optional reader is only for `package.json` expansion).
const recognize = createCommandRecognizer({});

describe('rework 1 item 2 / B2-12 recognition (pure)', () => {
  it('picks the first (record createdAt, alias) hit, not the later exact hit', async () => {
    const early = record({ runId: 'run-early', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: sha('migrate && cleanup'),
        actions: [{ text: 'migrate', sha256: keyOf(['migrate']) }] }] });
    const late = record({ runId: 'run-late', createdAt: '2026-01-02T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: sha('migrate') }] });
    const result = await recognize(ctx, { records: [late, early], requests: [], command: 'migrate',
      cwd: '.', maxPackageReads: 2 });
    expect(result).toMatchObject({ status: 'ready', value: {
      reviewRunId: 'run-early', alias: 1, match: { kind: 'action', action: { text: 'migrate' } },
    } });
  });

  it('interleaves every record\'s aliases: equal createdAt takes the lowest alias across records', async () => {
    // Same createdAt and input order [early, late]. early.alias 2 matches by
    // action; late.alias 1 matches exactly. The old record-then-alias order
    // returned early.alias 2; the flattened (createdAt, alias, ref key) order
    // must return late.alias 1.
    const early = record({ runId: 'run-early', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [
        { alias: 1, commandSha256: sha('cleanup') },
        { alias: 2, commandSha256: sha('migrate && cleanup'),
          actions: [{ text: 'migrate', sha256: keyOf(['migrate']) }] },
      ] });
    const late = record({ runId: 'run-late', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: sha('migrate') }] });
    const result = await recognize(ctx, { records: [early, late], requests: [], command: 'migrate',
      cwd: '.', maxPackageReads: 2 });
    expect(result).toMatchObject({ status: 'ready', value: {
      reviewRunId: 'run-late', alias: 1, match: { kind: 'exact' } } });
  });

  it('prefers exact over action within the same entry', async () => {
    const only = record({ runId: 'run-1', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [{ alias: 2, commandSha256: sha('migrate'),
        actions: [{ text: 'migrate', sha256: keyOf(['migrate']) }] }] });
    const result = await recognize(ctx, { records: [only], requests: [], command: 'migrate',
      cwd: '.', maxPackageReads: 2 });
    expect(result).toMatchObject({ status: 'ready', value: { alias: 2, match: { kind: 'exact' } } });
  });

  it('matches a stored declared form for that record and alias', async () => {
    const only = record({ runId: 'run-1', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: sha('npm run db:migrate') }] });
    const declared = request({ runId: 'run-1', alias: 1,
      declaredForms: [{ sha256: sha('custom rewrite'), text: 'custom rewrite' }] });
    const result = await recognize(ctx, { records: [only], requests: [declared], command: 'custom rewrite',
      cwd: '.', maxPackageReads: 2 });
    expect(result).toMatchObject({ status: 'ready', value: {
      reviewRunId: 'run-1', alias: 1, match: { kind: 'declared' } } });
  });

  it('still returns an earlier action hit over a later declared form', async () => {
    const early = record({ runId: 'run-early', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: sha('x'),
        actions: [{ text: 'migrate', sha256: keyOf(['migrate']) }] }] });
    const late = record({ runId: 'run-late', createdAt: '2026-01-02T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: sha('y') }] });
    const declared = request({ runId: 'run-late', alias: 1,
      declaredForms: [{ sha256: sha('migrate'), text: 'migrate' }] });
    const result = await recognize(ctx, { records: [early, late], requests: [declared],
      command: 'migrate', cwd: '.', maxPackageReads: 2 });
    expect(result).toMatchObject({ status: 'ready', value: { reviewRunId: 'run-early', match: { kind: 'action' } } });
  });
});
