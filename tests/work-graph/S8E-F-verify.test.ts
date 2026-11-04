/**
 * 8E-2 R F-verify (8E-2 §4.3 :800): the first-tier read (E3
 * `architecture/semantic-links`; `architecture/semantic-flows` for E-46) and the
 * "check once" route E6 `architecture/semantic-links/check` (R13 :421, shape
 * §2.0 :250–252), on the one S8E semantic world (8E §5.2 :604–711).
 *
 * Rows and the spec lines their expectations come from:
 * - E-31 (8E-2 :810; 8E :746): doubtful after line 10 changes (R5 :355), the check,
 *   R7's in-memory verdict on the next reads (:371–376); wire2.ts is not in K1's gate (R5 :346).
 * - E-46 (8E-2 :818; 8E :761): one check of three links builds one program (R6 :364).
 * - E2-05 (:829), E2-22 (:847), E2-33 (:864): an agent write (E1) over the §4.2
 *   files (:720–726, :740–744, :747–773), touched (:796), read doubtful, checked verified.
 * - E2-23c (:850), E2-23d (:851): the wire5.ts write (:737–739), edited, read, checked, read.
 * - E2-30 (:861): the file changes while `verify` is held (R7 :374), then R5 rule 2 (:350).
 * "建 n" is the second-tier builds of that one step (:800, §4.1 :708), taken around the
 * step with `world.linkCheck.builds()`. The verification literals are the §2.0 :145–149
 * union, hand-written. One world per `it` (R7 :372 keeps verdicts per Host).
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type {
  LinkDraftV1, LinkEvidenceV1, LinkKeyV1, NoteDraftAnchorV1, NoteDraftV1,
} from '../../src/contracts/note.js';
import type { SemanticFlowV1, SemanticLinkV1, SemanticPageV1 } from '../../src/contracts/semantic-layer.js';
import { openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ESemanticWorld } from '../helpers/S8E-semantic-world.js';

type Ref = { noteId: string; version: number };
/** One item of the check route's reply (§2.0 :252); declared here, the base has no type for the route. */
type CheckedV1 = { noteId: string; version: number; verification: unknown };

const VERIFIED = { status: 'verified' };
const PENDING = { status: 'unchecked', reason: 'refs_pending' };
const broken = (...missing: number[]) => ({ status: 'broken', missing });
const BEGIN = 'export const begin = (id: string) => runModel(access, id);';

const at = (path: string, startLine: number, endLine = startLine): LinkEvidenceV1['at'] =>
  ({ path, range: { startLine, endLine } });
const fileEnd = (path: string): NoteDraftAnchorV1 => ({ kind: 'file', path });
const tsEnd = (path: string, name: string, line?: number): NoteDraftAnchorV1 => ({ kind: 'file', path,
  symbolRequest: { language: 'typescript', name, ...(line === undefined ? {} : { range: { startLine: line, endLine: line } }) } });

/** A link draft (as `S8E-L2-link-write.test.ts:99–113`). */
function linkDraft(topic: string, relation: LinkDraftV1['link']['relation'],
  ends: { from: NoteDraftAnchorV1; to: NoteDraftAnchorV1; via?: NoteDraftAnchorV1 },
  key: LinkKeyV1 | null, evidence: LinkEvidenceV1[]): LinkDraftV1 {
  return { kind: 'link', topic, conclusion: `${topic} conclusion`, anchor: ends.from,
    extraAnchors: ends.via === undefined ? [ends.to] : [ends.to, ends.via],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: '',
    link: { relation, key, evidence } };
}

/** calls: run.ts `dispatch` → permit.ts `onPicked`, key 'wg.audit'; [0] register at `path:line`; [1] use as K3. */
const pickedCalls = (topic: string, path: string, line: number): LinkDraftV1 => linkDraft(topic, 'calls',
  { from: tsEnd('src/runtime/run.ts', 'dispatch'), to: tsEnd('src/wg/permit.ts', 'onPicked') },
  { kind: 'literal', text: 'wg.audit' },
  [{ role: 'register', at: at(path, line) }, structuredClone(S8E_LINKS.K3.evidence[1]!)]);

/** A flow draft (as `S8E-F-flow-read.test.ts:44–51`); the anchor is K1's "from", every flow's first step. */
const flowDraft = (topic: string, steps: readonly Ref[]): Extract<NoteDraftV1, { kind: 'flow' }> => ({
  kind: 'flow', topic, conclusion: `${topic} conclusion`, anchor: S8E_LINKS.K1.from, extraAnchors: [], facts: [],
  basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: '',
  flow: { steps: steps.map(step => ({ link: step.noteId })) },
});

/** A new §4.2 file, written verbatim, each line ending in `\n`. */
const putFile = (world: S8ESemanticWorld, path: string, lines: readonly string[]) =>
  writeFile(join(world.root, path), lines.join('\n') + '\n', 'utf8');
/** "碰一下" (:796): append `// touched` and its newline, 11 bytes. */
const touch = (world: S8ESemanticWorld, path: string) => appendFile(join(world.root, path), '// touched\n', 'utf8');
/** "第 n 行改成 X": replace 1-based lines and write the file back. */
async function setLines(world: S8ESemanticWorld, path: string, lines: Readonly<Record<number, string>>) {
  const target = join(world.root, path);
  const text = (await readFile(target, 'utf8')).split('\n');
  for (const [line, replacement] of Object.entries(lines)) text[Number(line) - 1] = replacement;
  await writeFile(target, text.join('\n'), 'utf8');
}

/** E2 person write (A1): `accepted` or the row stops; the ref comes from the receipt. */
async function personWrite(world: S8ESemanticWorld, draft: NoteDraftV1): Promise<Ref> {
  const write = await world.writePerson(draft);
  if (write.status !== 'accepted') throw new Error(`${draft.topic} was not accepted: ${JSON.stringify(write)}`);
  return { noteId: write.noteId, version: write.version };
}

/** E1 agent write (A1): the Kernel-delivered receipt must be `accepted`; "写 verified" is its write-time check. */
async function agentWrite(world: S8ESemanticWorld, draft: LinkDraftV1, label: string): Promise<Ref> {
  const envelope = (await world.writeAgent(draft, { label })).envelope;
  if (envelope === null) throw new Error(`E1 ${label}: the record_note result carried no {write, check}`);
  if (envelope.write.status !== 'accepted') throw new Error(`E1 ${label}: ${JSON.stringify(envelope.write)}`);
  const ref = { noteId: envelope.write.noteId, version: envelope.write.version };
  expect(envelope.check).toMatchObject({ noteId: ref.noteId, linkVerification: VERIFIED });
  return ref;
}

/** E3: the link's read-time verification on the project page (as `pageOf`), with the step's builds. */
async function readV(world: S8ESemanticWorld, ref: Ref): Promise<[unknown, number]> {
  const before = world.linkCheck.builds();
  const read = await world.route('architecture/semantic-links',
    { scope: { kind: 'project' }, cursor: null, limit: 100 }) as ReadResult<SemanticPageV1<SemanticLinkV1>>;
  if (read.status !== 'ready') throw new Error(`the semantic read was not ready: ${JSON.stringify(read)}`);
  const item = read.value.items.find(candidate => candidate.noteId === ref.noteId);
  if (item === undefined) throw new Error(`${ref.noteId} is not on the project page`);
  return [item.verification, world.linkCheck.builds() - before];
}

/** E3 flows: the named flows on the project page, in the given order. */
async function readFlows(world: S8ESemanticWorld, refs: readonly Ref[]): Promise<SemanticFlowV1[]> {
  const read = await world.route('architecture/semantic-flows',
    { scope: { kind: 'project' }, cursor: null, limit: 50 }) as ReadResult<SemanticPageV1<SemanticFlowV1>>;
  if (read.status !== 'ready') throw new Error(`the flows read was not ready: ${JSON.stringify(read)}`);
  return refs.map(ref => {
    const flow = read.value.items.find(candidate => candidate.noteId === ref.noteId);
    if (flow === undefined) throw new Error(`the flow ${ref.noteId} is not on the project page`);
    return flow;
  });
}

/** E6: one `architecture/semantic-links/check` call; `ready` or the row stops; the reply items and the step's builds. */
async function checkOnce(world: S8ESemanticWorld, refs: readonly Ref[]): Promise<[CheckedV1[], number]> {
  const before = world.linkCheck.builds();
  const result = await world.route('architecture/semantic-links/check', { items: refs }) as
    { status: string; value?: { items: CheckedV1[] } };
  if (result.status !== 'ready' || result.value === undefined) {
    throw new Error(`the check was not ready: ${JSON.stringify(result)}`);
  }
  return [result.value.items, world.linkCheck.builds() - before];
}

/** E2-05, E2-22, E2-33: the §4.2 files, an E1 write (verified), touch, read refs_pending, check verified with one build. */
async function touchedThenChecked(files: Readonly<Record<string, readonly string[]>>, draft: LinkDraftV1,
  label: string, touched: string): Promise<void> {
  const world = await openS8ESemanticWorld({ scribeTasks: 1 });
  try {
    for (const [path, lines] of Object.entries(files)) await putFile(world, path, lines);
    const link = await agentWrite(world, draft, label);
    await touch(world, touched);
    expect((await readV(world, link))[0]).toEqual(PENDING);
    expect(await checkOnce(world, [link])).toEqual([[{ ...link, verification: VERIFIED }], 1]);
  } finally {
    await world.close();
  }
}

const WIRE5 = ["import { onPicked } from './wg/permit.js';", "export const table = { 'wg.audit': onPicked };"];

describe('8E-2 R F-verify: the first-tier read and the check route', () => {
  it('E-31 verified twice; doubtful after line 10; the check is kept in memory; wire2.ts is outside the gate',
    async () => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        const k1 = await personWrite(world, s8eLinkDraft(S8E_LINKS.K1));
        expect(await readV(world, k1)).toEqual([VERIFIED, 0]);
        expect(await readV(world, k1)).toEqual([VERIFIED, 0]);
        await setLines(world, 'src/compose.ts', { 10: BEGIN });
        expect(await readV(world, k1)).toEqual([PENDING, 0]);
        expect(await checkOnce(world, [k1])).toEqual([[{ ...k1, verification: VERIFIED }], 1]);
        expect(await readV(world, k1)).toEqual([VERIFIED, 0]);
        await setLines(world, 'src/wire2.ts', { 2: "import { onPicked as picked } from './wg/permit.js';" });
        expect(await readV(world, k1)).toEqual([VERIFIED, 0]);
      } finally {
        await world.close();
      }
    }, 180_000);

  it('E-46 both flows unchecked while K1–K3 are doubtful; one check of three builds once; both flows fresh after',
    async () => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        const [k1, k2, k3] = [await personWrite(world, s8eLinkDraft(S8E_LINKS.K1)),
          await personWrite(world, s8eLinkDraft(S8E_LINKS.K2)), await personWrite(world, s8eLinkDraft(S8E_LINKS.K3))];
        const flows = [await personWrite(world, flowDraft('E-46-a', [k1, k2])),
          await personWrite(world, flowDraft('E-46-b', [k1, k3]))];
        await setLines(world, 'src/compose.ts', { 10: BEGIN });
        for (const flow of await readFlows(world, flows)) {
          expect(flow).toMatchObject({ freshness: 'unchecked', currentEligible: false });
          expect(flow.steps.map(step => step.item?.verification)).toEqual([PENDING, PENDING]);
        }
        expect((await checkOnce(world, [k1, k2, k3]))[1]).toBe(1);
        for (const flow of await readFlows(world, flows)) {
          expect(flow).toMatchObject({ freshness: 'fresh', currentEligible: true });
        }
      } finally {
        await world.close();
      }
    }, 180_000);

  it('E2-05 authorize only as a property (p.authorize) reads refs_pending, not broken; the check verifies', async () => {
    await touchedThenChecked({ 'src/wire3.ts': [
      "import type { Access } from './contracts/access.js';",
      "export function wire(p: typeof import('./wg/permit.js')): Access {",
      '  return {',
      '    beforeCall: p.authorize,',
      '  };',
      '}',
    ] }, s8eLinkDraft(S8E_LINKS.K1, { topic: 'E2-05', link: { relation: 'injects', key: null,
      evidence: [structuredClone(S8E_LINKS.K1.evidence[0]!), { role: 'wire', at: at('src/wire3.ts', 4) }] } }),
    'e2-05', 'src/wire3.ts');
  }, 180_000);

  it.each([
    { cell: '1', evidence: 'src/use-gate.ts', to: tsEnd('src/wg/gate2.ts', 'Gate'),
      via: tsEnd('src/contracts/access.ts', 'beforeCall'), use: 3, wire: [2, 3], files: {
        'src/wg/gate2.ts': ["import type { Access } from '../contracts/access.js';",
          'export class Gate implements Access {', '  async beforeCall(id: string): Promise<void> { void id; }', '}'],
        'src/use-gate.ts': ["import { Gate } from './wg/gate2.js';", 'const gate = new Gate();',
          'export const go = (id: string) => gate.beforeCall(id);'] } },
    { cell: '2', evidence: 'src/use-child.ts', to: tsEnd('src/wg/base.ts', 'Child'),
      via: tsEnd('src/wg/base.ts', 'beforeCall', 2), use: 3, wire: [2, 3], files: {
        'src/wg/base.ts': ['export class Base {', '  beforeCall(id: string): void { void id; }', '}',
          'export class Child extends Base {', '  override beforeCall(id: string): void { void id; }', '}'],
        'src/use-child.ts': ["import { Child } from './wg/base.js';", 'const child = new Child();',
          'export const go = (id: string) => child.beforeCall(id);'] } },
    { cell: '3', evidence: 'src/use-ab.ts', to: tsEnd('src/wg/pair.ts', 'AB'),
      via: tsEnd('src/wg/pair.ts', 'beforeCall', 1), use: 2, wire: [1, 2], files: {
        'src/wg/pair.ts': ["export interface A { beforeCall(id: string): void; kind: 'a'; }",
          "export interface B { beforeCall(id: string): void; kind: 'b'; }", 'export type AB = A | B;'],
        'src/use-ab.ts': ["import type { AB } from './wg/pair.js';",
          'export const go = (ab: AB, id: string) => ab.beforeCall(id);'] } },
  ])('E2-22 cell $cell: a member call through a class, a subclass or a union reads refs_pending; the check verifies',
    async ({ cell, evidence, to, via, use, wire, files }) => {
      await touchedThenChecked(files, linkDraft(`E2-22-${cell}`, 'injects', { from: fileEnd(evidence), to, via }, null,
        [{ role: 'use', at: at(evidence, use) }, { role: 'wire', at: at(evidence, wire[0]!, wire[1]) }]),
      `e2-22-${cell}`, evidence);
    }, 180_000);

  it.each([
    { row: 'E2-23c', lines: { 2: "export const table = { 'wg.audit': box.onPicked };" },
      checked: { status: 'unverifiable', reason: 'analyzer_unavailable' }, after: PENDING, afterBuilds: null },
    { row: 'E2-23d', lines: { 1: "import { authorize } from './wg/permit.js';",
      2: "export const table = { 'wg.audit': onPicked, name: String(authorize) };" },
    checked: broken(0), after: broken(0), afterBuilds: 0 },
  ])('$row wire5.ts edited: refs_pending; the check answers once; the next read follows R7',
    async ({ row, lines, checked, after, afterBuilds }) => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        await putFile(world, 'src/wire5.ts', WIRE5);
        const link = await agentWrite(world, pickedCalls(row, 'src/wire5.ts', 2), row.toLowerCase());
        await setLines(world, 'src/wire5.ts', lines);
        expect((await readV(world, link))[0]).toEqual(PENDING);
        expect(await checkOnce(world, [link])).toEqual([[{ ...link, verification: checked }], 1]);
        const [again, built] = await readV(world, link);
        expect(again).toEqual(after);
        if (afterBuilds !== null) expect(built).toBe(afterBuilds);
      } finally {
        await world.close();
      }
    }, 180_000);

  it('E2-30 compose.ts changes while verify is held: the check is not kept; the next read is broken [0]',
    async () => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      let release = (): void => undefined;
      try {
        const k3 = await personWrite(world, s8eLinkDraft(S8E_LINKS.K3));
        await touch(world, 'src/compose.ts');
        expect(await readV(world, k3)).toEqual([PENDING, 0]);
        const gate = world.linkCheck.holdVerify();
        release = gate.release;
        const checking = checkOnce(world, [k3]);
        const first = await Promise.race([gate.entered.then(() => 'entered'), checking.then(() => 'answered')]);
        if (first !== 'entered') throw new Error('E2-30: the check answered before verify was held');
        await setLines(world, 'src/compose.ts', { 9: "handlers.set('wg.other', audit);" });
        gate.release();
        expect(await checking).toEqual([[{ ...k3, verification: { status: 'unchecked', reason: 'unavailable' } }], 1]);
        expect(await readV(world, k3)).toEqual([broken(0), 0]);
      } finally {
        release();
        await world.close();
      }
    }, 180_000);

  it('E2-33 onPicked imported through hub.ts export *: refs_pending after the touch; the check verifies', async () => {
    await touchedThenChecked({
      'src/wg/hub.ts': ["export * from './permit.js';"],
      'src/wire6.ts': ["import { onPicked } from './wg/hub.js';", "export const table = { 'wg.audit': onPicked };"],
    }, pickedCalls('E2-33', 'src/wire6.ts', 2), 'e2-33', 'src/wire6.ts');
  }, 180_000);
});
