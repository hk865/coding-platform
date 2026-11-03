/**
 * A Run's notes on files on the real Host. The note owners read the workspace to check a file (the anchor exists, its
 * symbol, a basis file's digest, a note's freshness), and the Host authorizes a workspace read only for its own principal; these
 * are read-only checks the platform makes for the Agent, so a Run's note on an existing file is accepted, checked and
 * read back as current, and its author stays the Run.
 *
 * Every state comes from public steps: the request world with the scribe bindings (`openS6ARequestWorld`, with
 * `look_graph` merged into the scribe's Host grant), the project scribe's governance, Plan and line (`seedS6BScribe`),
 * and the scribe's real Run driven by `workflow/advance`, whose scripted model calls the real `record_note` and
 * `look_graph`. The results are read through `notes/list` and the tool results the Run's model received.
 */
import { describe, expect, it } from 'vitest';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { openS6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { seedS6BScribe } from '../helpers/S6B1-fixture.js';

const FILE = { kind: 'file', path: 'src/module.ts' } as const;
const pitfall = (extra: Record<string, unknown> = {}) => ({ op: 'write', kind: 'pitfall', topic: 'sf2-file',
  conclusion: 'SF2 file pitfall', body: 'SF2 body', anchor: FILE, ...extra });
const lookup = (anchor: { kind: 'file'; path: string }) => ({ memory: { v: 1, op: 'lookup', anchor } });
/** A successful tool result carrying one JSON value. */
const json = (value: unknown) => ({ result: { status: 'success', output: [{ kind: 'json', value }] } });

/** A fresh world whose project scribe runs one real Run: one scripted reply per call, then a text answer. */
async function scribeRun(calls: readonly { name: string; args: Record<string, unknown> }[]) {
  const world = await openS6ARequestWorld({ backend: 'memory', scribe: true,
    extraBindings: [{ binding: { id: 's6a-scribe-binding' } as WorkbenchRuntimeBinding, mergeTools: ['look_graph'] }] });
  try {
    const scribe = await seedS6BScribe(world);
    world.scriptReplies([...calls.map((call, index) => ({ kind: 'calls' as const,
      calls: [{ callId: `sf2-${String(index)}`, ...call }] })), { kind: 'text', text: 'SF2 done' }]);
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: scribe.goal, flowId: 'sf2-run',
      sessionHint: scribe.line.ref, kind: 'select_work', taskId: scribe.nextTask().taskId });
    const messages = world.model.lastRequest()?.messages ?? [];
    const results = calls.map((_, index) => messages.find(message => message.role === 'tool'
      && message.callId === `sf2-${String(index)}`));
    const listed = await scribe.main.route('notes/list', { anchor: FILE, state: 'accepted', limit: 100, cursor: null });
    return { results, listed };
  } finally { await world.close(); }
}

describe('SF2 a Run note on a file', () => {
  it('a real scribe Run records a pitfall on an existing file: accepted under that anchor, written by the Run', async () => {
    const { listed } = await scribeRun([{ name: 'record_note', args: pitfall() }]);
    expect(listed).toMatchObject({ status: 'ready', value: { items: [{ kind: 'pitfall', conclusion: 'SF2 file pitfall',
      anchor: FILE, storedState: 'accepted', source: { kind: 'agent', duty: 'scribe' } }] } });
  });

  it('the record_note check of that new note reads the file: same, fresh, current', async () => {
    const { results } = await scribeRun([{ name: 'record_note', args: pitfall() }]);
    expect(results[0]).toMatchObject(json({ write: { status: 'accepted' }, check: {
      observedFiles: [{ path: 'src/module.ts', outcome: 'same' }], freshness: 'fresh', currentEligible: true } }));
  });

  it('a Run note with an existing basis file is accepted', async () => {
    const { results } = await scribeRun([{ name: 'record_note', args: pitfall({ basisFiles: ['tsconfig.json'] }) }]);
    expect(results[0]).toMatchObject(json({ write: { status: 'accepted' } }));
  });

  it('a Run lookup of the note on the file shows it fresh and current', async () => {
    const { results } = await scribeRun([{ name: 'record_note', args: pitfall() },
      { name: 'look_graph', args: lookup(FILE) }]);
    expect(results[1]).toMatchObject(json({ status: 'ready', value: { items: [{ conclusion: 'SF2 file pitfall',
      freshness: 'fresh', currentEligible: true }] } }));
  });

  it('a Run lookup of an existing file with no note answers an empty page', async () => {
    const { results } = await scribeRun([{ name: 'look_graph', args: lookup({ kind: 'file', path: 'tsconfig.json' }) }]);
    expect(results[0]).toMatchObject(json({ status: 'ready', value: { items: [] } }));
  });

  it('after nine Run notes on missing files, a Run note on a symbol of an existing file is accepted', async () => {
    const missing = Array.from({ length: 9 }, (_, index) => ({ name: 'record_note', args: pitfall({
      topic: `sf2-missing-${String(index)}`, anchor: { kind: 'file', path: `src/missing-${String(index)}.ts` } }) }));
    const { results } = await scribeRun([...missing, { name: 'record_note', args: pitfall({
      anchor: { ...FILE, symbolRequest: { language: 'typescript', name: 'ag2bMarker' } } }) }]);
    expect(results[9]).toMatchObject(json({ write: { status: 'accepted' } }));
  });
});
