/**
 * S8E L2 W-write (sheet §6.2): K1–K7 through both frozen entry layers and the
 * E-27/E-33/E-35/E-37/E-38 write cases through the person `notes/write` route.
 *
 * E1 is the real scribe Work Run: the scripted model calls the real
 * `record_note` inside `driveWorkflow`'s `select_work` (the world's
 * `writeAgent`, `tests/helpers/S8E-semantic-world.ts`), and the Kernel-delivered
 * `{write, check}` is the receipt. E2 is the person `notes/write` route. Both
 * layers run the same assertion body, so K1–K7 are not duplicated. After SF2 an
 * agent's file-anchor write goes through the real workspace reader; no principal
 * is faked and no product code is changed.
 *
 * L3 readback halves (now produced by the L3 read model):
 * - stored `link.ends`/`link.evidence`/`link.analysisConfig` are carried by
 *   `NoteItemV1.link` from `src/core/work-graph/notes/note-read-model.ts`.
 * - `check.linkVerification` is produced by
 *   `src/core/work-graph/views/note-views.ts` (`checkItem`).
 * The assertions below read them through the public owner (`notes.readNote`) and,
 * for K6's module attribution, through the Host's `architecture/semantic-links`
 * route (that field exists only on the semantic item).
 *
 * The program-build counter (`counters()`/`builds()`, 8E-2 §4.1 :708) and the
 * read and second-tier faults (:712) come from the world's ONE delegating
 * wrapper around the real `createNoteCheck` export: it proxies the shared
 * `noteWorkspace`, so the write-time evidence gate and the read-time check use
 * the same counter/faults, and `close()` restores both. 8E-2 G: E-37 (8E-2
 * :814; 8E :752) opens its own world; E-38 (:815; 8E :753) also reads the
 * link back after `run.ts` line 10 changes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { LinkDraftV1, LinkEvidenceV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { SemanticLinkV1, SemanticPageV1, SemanticScopeV1 } from '../../src/contracts/semantic-layer.js';
import type {
  NoteCheckV1, NoteItemV1, WriteNoteEnvelopeV1, WriteNoteResult,
} from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ELinkName, type S8ESemanticWorld,
  type S8EWorkspaceReadFault,
} from '../helpers/S8E-semantic-world.js';

type AcceptedWrite = Extract<WriteNoteResult, { status: 'accepted' | 'pending_review' | 'staged' }>;

const acceptedWrite = (envelope: WriteNoteEnvelopeV1): AcceptedWrite => {
  const write = envelope.write;
  if (write.status === 'rejected') throw new Error(`write rejected: ${write.code}/${write.reason}`);
  if (write.status !== 'accepted') throw new Error(`write was not accepted: ${write.status}`);
  return write;
};

/** The public owner read of the just-written note: `notes.readNote` with the Host's real context. */
const itemOf = async (world: S8ESemanticWorld, noteId: string): Promise<NoteItemV1> => {
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId });
  if (read.status !== 'ready') throw new Error(`the note ${noteId} was not readable: ${read.status}`);
  return read.value;
};

/** The write envelope's check, narrowed past the owner's `unavailable` arm. */
const checkOf = (envelope: WriteNoteEnvelopeV1): NoteCheckV1 => {
  const check = envelope.check;
  if (!('noteId' in check)) throw new Error(`the write check is unavailable: ${check.reason}`);
  return check;
};

/** The Host route's semantic page (the module's attribution is only on this read). */
const semanticPage = async (world: S8ESemanticWorld, scope: SemanticScopeV1):
Promise<SemanticPageV1<SemanticLinkV1>> => {
  const result = await world.route('architecture/semantic-links', { scope, cursor: null, limit: 100 });
  const read = result as ReadResult<SemanticPageV1<SemanticLinkV1>>;
  if (read.status !== 'ready') throw new Error(`the semantic read was not ready: ${JSON.stringify(result)}`);
  return read.value;
};

const fileEnd = (path: string) => ({ kind: 'file' as const, path });
const tsEnd = (path: string, name: string) =>
  ({ kind: 'file' as const, path, symbolRequest: { language: 'typescript', name } });
const pythonEnd = (path: string, name: string) =>
  ({ kind: 'file' as const, path, symbolRequest: { language: 'python' as const, name } });

/**
 * The stored payload literals of K2–K7 from the frozen W-write row (sheet §6.2,
 * rulings :2270): the relation, the raw `via` end (null when absent) and the key.
 * K1 has its own ends assertion below.
 */
const K2_K7_LITERALS = {
  K2: {
    relation: 'callback',
    via: { kind: 'file', path: 'src/contracts/hooks.ts',
      symbolRequest: { language: 'typescript', name: 'onSelected' } },
    key: null,
  },
  K3: { relation: 'calls', via: null, key: { kind: 'literal', text: 'wg.audit' } },
  K4: { relation: 'data', via: null, key: { kind: 'literal', text: 'reports/latest.json' } },
  K5: { relation: 'message', via: null, key: { kind: 'literal', text: '/cmd_vel' } },
  K6: { relation: 'spawns', via: null, key: { kind: 'literal', text: 'drive_node' } },
  K7: { relation: 'data', via: null, key: { kind: 'literal', text: 'overload-key' } },
} as const;

/** A link draft with the given ends, key and evidence; all other fields are the row's empty shape. */
function linkDraft(input: {
  topic: string; conclusion: string; from: LinkDraftV1['anchor']; to: LinkDraftV1['extraAnchors'][number];
  via?: LinkDraftV1['extraAnchors'][number] | null; key: LinkDraftV1['link']['key'];
  evidence: LinkEvidenceV1[]; relation?: LinkDraftV1['link']['relation'];
}): LinkDraftV1 {
  const extraAnchors = input.via === undefined || input.via === null ? [input.to] : [input.to, input.via];
  return {
    kind: 'link', topic: input.topic, conclusion: input.conclusion,
    anchor: input.from, extraAnchors,
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    body: '',
    link: { relation: input.relation ?? 'data',
      ...(input.key === undefined ? {} : { key: input.key }), evidence: input.evidence },
  };
}

/** The two frozen entry layers of the W-write row: the real Run and the person route. */
type WriteVia = 'E1' | 'E2';

/** The shared assertion body: both layers must produce the same stored link. */
async function assertLinkWrite(world: S8ESemanticWorld, name: S8ELinkName,
  envelope: WriteNoteEnvelopeV1): Promise<AcceptedWrite> {
  const write = acceptedWrite(envelope);
  expect(write.version).toBe(1);
  expect(write.noteId.length).toBeGreaterThan(0);
  expect(write.warnings).toEqual([]);
  const item = await itemOf(world, write.noteId);
  expect(item.kind).toBe('link');
  expect(item.storedState).toBe('accepted');
  expect(item.link?.verification).toEqual({ status: 'verified' });
  expect(checkOf(envelope).linkVerification).toEqual({ status: 'verified' });

  if (name === 'K1') {
    expect(item.link?.ends).toEqual({
      from: S8E_LINKS.K1.from, to: S8E_LINKS.K1.to, via: S8E_LINKS.K1.via,
    });
    expect(item.link?.evidence[1]?.at).toEqual({
      path: 'src/compose.ts', range: { startLine: 7, endLine: 7 },
    });
    expect(item.link?.analysisConfig).toEqual({ path: null, digest: null });
  }
  if (name !== 'K1') {
    const literal = K2_K7_LITERALS[name];
    expect(item.link?.relation).toBe(literal.relation);
    expect(item.link?.ends.via).toEqual(literal.via);
    expect(item.link?.key).toEqual(literal.key);
  }
  if (name === 'K5') {
    expect(item.anchor).not.toHaveProperty('symbol');
    expect(item.extraAnchors[0]).not.toHaveProperty('symbol');
  }
  if (name === 'K6') {
    const page = await semanticPage(world, { kind: 'module', moduleId: 'launch' });
    const k6 = page.items.find(candidate => candidate.noteId === write.noteId);
    expect(k6?.from.moduleId).toBe('launch');
    expect(k6?.to.anchor).toEqual({ kind: 'module', moduleId: 'robot' });
    expect(k6?.relation).toBe('spawns');
    expect(k6?.key).toEqual({ kind: 'literal', text: 'drive_node' });
  }
  if (name === 'K7') {
    // `declarationRanges` is a workspace `SourceHit` field; the stored
    // locators keep the resolved name range of each of K7's four slots.
    const from = item.anchor;
    const to = item.extraAnchors[0];
    expect(from.kind === 'file' ? from.symbol?.range : undefined).toEqual({ startLine: 1, endLine: 1 });
    expect(to !== undefined && to.kind === 'file' ? to.symbol?.range : undefined)
      .toEqual({ startLine: 1, endLine: 1 });
    expect(item.link?.evidence[0]?.at.symbol?.range).toEqual({ startLine: 1, endLine: 1 });
    expect(item.link?.evidence[1]?.at.symbol?.range).toEqual({ startLine: 1, endLine: 1 });
  }
  return write;
}

/** One K1–K7 write through `via`: the real Run's `record_note` or the person route. */
async function writeLinkVia(world: S8ESemanticWorld, via: WriteVia, name: S8ELinkName,
  label: string): Promise<WriteNoteEnvelopeV1> {
  if (via === 'E2') return await world.writePersonEnvelope(s8eLinkDraft(S8E_LINKS[name]));
  // A distinct topic keeps the two layers independent on the same anchor: the
  // same-topic gate is not part of this row.
  const written = await world.writeAgent(s8eLinkDraft(S8E_LINKS[name], { topic: `E1-${name}` }), { label });
  if (written.envelope === null) throw new Error(`the ${name} agent write returned no {write, check}`);
  return written.envelope;
}

describe('S8E L2 W-write: K1–K7 and the evidence cases through notes/write', () => {
  let world: S8ESemanticWorld;

  beforeAll(async () => { world = await openS8ESemanticWorld({ scribeTasks: 7 }); }, 120_000);
  afterAll(async () => { await world?.close(); });

  const writeRows = (['E1', 'E2'] as const).flatMap(via =>
    (['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7'] as const).map(name => [via, name] as const));

  it.each(writeRows)(
    '%s %s is accepted, version 1, no warning; the receipt names the note id',
    async (via: WriteVia, name: S8ELinkName) => {
      world.linkCheck.reset();
      const envelope = await writeLinkVia(world, via, name, `W-write-${via}-${name}`);
      await assertLinkWrite(world, name, envelope);
    }, 60_000);

  it('spawns with an interface "to": an entry outside the interface path is accepted', async () => {
    const draft = linkDraft({
      topic: 'spawns-interface', conclusion: 'bringup launches the robot drive node',
      relation: 'spawns',
      from: fileEnd('launch/bringup.launch.py'),
      to: { kind: 'interface', moduleId: 'robot', interfaceId: 'drive' },
      key: { kind: 'literal', text: 'drive_node' },
      evidence: [
        { role: 'launch', at: { path: 'launch/bringup.launch.py' } },
        { role: 'entry', at: { path: 'src/robot/setup.py' } },
      ],
    });
    world.linkCheck.reset();
    const write = acceptedWrite(await world.writePersonEnvelope(draft));
    expect(write.version).toBe(1);
    expect(write.warnings).toEqual([]);
  }, 60_000);

  it('E-27 Python injects: accepted with both warnings and version 1', async () => {
    const draft = linkDraft({
      topic: 'E-27', conclusion: 'drive main starts teleop through Publisher',
      relation: 'injects',
      from: pythonEnd('src/robot/drive.py', 'main'),
      to: pythonEnd('src/robot/teleop.py', 'start'),
      via: pythonEnd('src/robot/ports.py', 'Publisher'),
      key: null,
      evidence: [
        { role: 'use', at: { path: 'src/robot/drive.py', range: { startLine: 1, endLine: 2 } } },
        { role: 'wire', at: { path: 'src/robot/teleop.py', range: { startLine: 1, endLine: 2 } } },
      ],
    });
    world.linkCheck.reset();
    const envelope = await world.writePersonEnvelope(draft);
    const write = acceptedWrite(envelope);
    expect(write.version).toBe(1);
    expect(write.warnings).toEqual(['symbol_unresolved', 'evidence_unverifiable']);
    const item = await itemOf(world, write.noteId);
    expect(item.link?.verification).toEqual({ status: 'unverifiable', reason: 'language_unsupported' });
    expect(checkOf(envelope).linkVerification).toEqual({ status: 'unverifiable', reason: 'language_unsupported' });
  }, 60_000);

  it('E-27 unreadable end files keep the language verdict and both warnings', async () => {
    // The three Python end files cannot be read from the working tree (the
    // existence probe, maxBytes:1, is left alone). The extension says
    // language_unsupported before any read (F44), so the write keeps
    // symbol_unresolved plus evidence_unverifiable; reading first would answer
    // analyzer_unavailable and drop symbol_unresolved (8E-2 §4.4 :875).
    const draft = linkDraft({
      topic: 'E-27-ends-unreadable', conclusion: 'drive main starts teleop through Publisher',
      relation: 'injects',
      from: pythonEnd('src/robot/drive.py', 'main'),
      to: pythonEnd('src/robot/teleop.py', 'start'),
      via: pythonEnd('src/robot/ports.py', 'Publisher'),
      key: null,
      evidence: [
        { role: 'use', at: { path: 'src/robot/drive.py', range: { startLine: 1, endLine: 2 } } },
        { role: 'wire', at: { path: 'src/robot/teleop.py', range: { startLine: 1, endLine: 2 } } },
      ],
    });
    world.linkCheck.reset();
    world.linkCheck.faultReads(request => request.version.kind === 'working_tree' && request.maxBytes > 1
      && ['src/robot/drive.py', 'src/robot/teleop.py', 'src/robot/ports.py'].includes(request.path)
      ? { status: 'rejected', code: 'unavailable', reason: 'the end files cannot be read' }
      : null);
    let envelope: WriteNoteEnvelopeV1;
    try {
      envelope = await world.writePersonEnvelope(draft);
    } finally {
      world.linkCheck.faultReads(null);
    }
    const write = acceptedWrite(envelope);
    expect(write.warnings).toEqual(['symbol_unresolved', 'evidence_unverifiable']);
    // The stored language_unsupported verdict is L3's readback half.
  }, 60_000);

  it('E-33 bus.ts three same-file endpoints: accepted with no warning', async () => {
    const draft = linkDraft({
      topic: 'E-33', conclusion: 'bus select calls onSelected through the same file',
      relation: 'callback',
      from: fileEnd('src/runtime/bus.ts'),
      to: tsEnd('src/runtime/bus.ts', 'select'),
      via: tsEnd('src/runtime/bus.ts', 'onSelected'),
      key: null,
      evidence: [
        { role: 'wire', at: { path: 'src/wire2.ts', range: { startLine: 3, endLine: 3 } } },
        { role: 'use', at: { path: 'src/runtime/bus.ts',
          symbolRequest: { language: 'typescript', name: 'select' } } },
      ],
    });
    world.linkCheck.reset();
    const envelope = await world.writePersonEnvelope(draft);
    const write = acceptedWrite(envelope);
    expect(write.version).toBe(1);
    expect(write.warnings).toEqual([]);
    const item = await itemOf(world, write.noteId);
    expect(item.link?.verification).toEqual({ status: 'verified' });
    expect(checkOf(envelope).linkVerification).toEqual({ status: 'verified' });
  }, 60_000);

  it('E-35 first: K3 [0] on the JSON register line is accepted with evidence_unverifiable',
    async () => {
      const draft = s8eLinkDraft(S8E_LINKS.K3, { topic: 'E-35-json' });
      draft.link.evidence[0] = { role: 'register',
        at: { path: 'config/handlers.json', range: { startLine: 1, endLine: 1 } } };
      world.linkCheck.reset();
      const envelope = await world.writePersonEnvelope(draft);
      const write = acceptedWrite(envelope);
      expect(write.version).toBe(1);
      expect(write.warnings).toEqual(['evidence_unverifiable']);
      const item = await itemOf(world, write.noteId);
      expect(item.link?.verification).toEqual({ status: 'unverifiable', reason: 'language_unsupported' });
      expect(checkOf(envelope).linkVerification).toEqual({ status: 'unverifiable', reason: 'language_unsupported' });
    }, 60_000);

  it.each<[string, (target: S8ESemanticWorld) => void, Record<string, unknown>]>([
    ['content read failure', target => {
      target.linkCheck.faultReads(request => request.path === 'config/handlers.json'
        && request.version.kind === 'working_tree'
        ? { status: 'rejected', code: 'unavailable', reason: 'the JSON working tree cannot be read' }
        : null);
    }, { status: 'unchecked', reason: 'unavailable' }],
  ])('E-35 %s: a non-TS register evidence is accepted with evidence_unverifiable', async (topic, install, check) => {
    // The write keeps the non-TS evidence's language verdict (language_unsupported
    // before the failed read, never analyzer_unavailable). The check after the
    // write is a first-tier read; the read fault also hits its batch read, so an
    // unreadable JSON file reads unchecked/unavailable (8E-2 R5 :357, :359;
    // r-start-rulings 6).
    const draft = s8eLinkDraft(S8E_LINKS.K3, { topic });
    draft.link.evidence[0] = { role: 'register',
      at: { path: 'config/handlers.json', range: { startLine: 1, endLine: 1 } } };
    world.linkCheck.reset();
    install(world);
    let envelope: WriteNoteEnvelopeV1;
    try {
      envelope = await world.writePersonEnvelope(draft);
    } finally {
      world.linkCheck.faultReads(null);
      world.linkCheck.reset();
    }
    const write = acceptedWrite(envelope);
    expect(write.status).toBe('accepted');
    expect(write.version).toBe(1);
    expect(write.warnings).toEqual(['evidence_unverifiable']);
    expect(checkOf(envelope).linkVerification).toEqual(check);
  }, 60_000);

  it('E-35 second: changing the JSON line away from the key is evidence_missing at [0]', async () => {
    await writeFile(join(world.root, 'config/handlers.json'),
      '{"wg.other": "src/wg/audit.ts#audit"}\n', 'utf8');
    const draft = s8eLinkDraft(S8E_LINKS.K3, { topic: 'E-35-missing' });
    draft.link.evidence[0] = { role: 'register',
      at: { path: 'config/handlers.json', range: { startLine: 1, endLine: 1 } } };
    const envelope = await world.writePersonEnvelope(draft);
    expect(envelope.write.status).toBe('rejected');
    if (envelope.write.status !== 'rejected') return;
    expect(envelope.write.code).toBe('invalid');
    expect(envelope.write.reason).toBe('evidence_missing');
    expect(envelope.write.evidenceIndexes).toEqual([0]);
  }, 60_000);

  const PENDING = { status: 'unchecked', reason: 'refs_pending' };

  /** E3: the link's read-time verification on the project page, and the read's program builds (8E-2 :800). */
  async function readLink(target: S8ESemanticWorld, noteId: string): Promise<[unknown, number]> {
    const before = target.linkCheck.builds();
    const item = (await semanticPage(target, { kind: 'project' })).items.find(candidate => candidate.noteId === noteId);
    if (item === undefined) throw new Error(`${noteId} is not on the project page`);
    return [item.verification, target.linkCheck.builds() - before];
  }

  /** E6: one `architecture/semantic-links/check` of one link (8E-2 §2.0 :250–252), and the check's builds. */
  async function checkLink(target: S8ESemanticWorld, ref: { noteId: string; version: number }): Promise<[unknown, number]> {
    const before = target.linkCheck.builds();
    const result = await target.route('architecture/semantic-links/check', { items: [ref] }) as
      { status: string; value?: { items: { verification: unknown }[] } };
    if (result.status !== 'ready' || result.value === undefined) {
      throw new Error(`the check was not ready: ${JSON.stringify(result)}`);
    }
    return [result.value.items[0]?.verification, target.linkCheck.builds() - before];
  }

  it('E-37 K1 written while the second tier fails: refs_pending until a check that works verifies it',
    async () => {
      // 8E-2 :814 (G2 :434, G4 :436; R5 :347, :359; R7 :375): the second tier fails at
      // write, so K1 is stored unverifiable/analyzer_unavailable; its ends still have
      // locators (single file). A check that fails is not kept; one that works builds 1.
      const own = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        own.linkCheck.faultVerify(() => ({ status: 'rejected', code: 'unavailable', reason: 'the second tier is down' }));
        const envelope = await own.writePersonEnvelope(s8eLinkDraft(S8E_LINKS.K1, { topic: 'E-37' }));
        const write = acceptedWrite(envelope);
        expect(write.version).toBe(1);
        expect(write.warnings).toEqual(['evidence_unverifiable']);
        const item = await itemOf(own, write.noteId);
        expect([item.anchor, ...item.extraAnchors].map(end => end.kind === 'file' ? end.symbol?.qualifiedName : end.kind))
          .toEqual(['runModel', 'authorize', 'beforeCall']);
        expect(item.link?.evidence.map(entry => entry.fileDigest === null)).toEqual([false, false]);
        // Mutation (8E-2 :814): R5 reads the stored analyzer_unavailable as unverifiable → this is red.
        expect(checkOf(envelope).linkVerification).toEqual({ status: 'unchecked', reason: 'refs_pending' });
        const ref = { noteId: write.noteId, version: write.version };
        expect(await readLink(own, ref.noteId)).toEqual([PENDING, 0]);
        expect(await checkLink(own, ref)).toEqual([{ status: 'unchecked', reason: 'unavailable' }, 0]);
        expect(await readLink(own, ref.noteId)).toEqual([PENDING, 0]);
        own.linkCheck.faultVerify(null);
        expect(await checkLink(own, ref)).toEqual([{ status: 'verified' }, 1]);
        expect(await readLink(own, ref.noteId)).toEqual([{ status: 'verified' }, 0]);
      } finally {
        await own.close();
      }
    }, 180_000);

  it('E-37 an unavailable selector is not checked as the whole file', async () => {
    // An evidence selector whose file cannot be read (the working-tree read of
    // run.ts fails; the existence probe, maxBytes:1, is left alone) is not
    // checked as the whole file: run.ts loses its literal here, and the
    // unreadable [0] must stay unverifiable (accepted), never a whole-file scan
    // that turns into evidence_missing (8E-2 §4.4 :878).
    const runPath = join(world.root, 'src/runtime/run.ts');
    const original = await readFile(runPath, 'utf8');
    await writeFile(runPath, original.replace('reports/latest.json', 'reports/other.json'), 'utf8');
    const fault: S8EWorkspaceReadFault = request =>
      request.path === 'src/runtime/run.ts' && request.version.kind === 'working_tree' && request.maxBytes > 1
        ? { status: 'rejected', code: 'unavailable', reason: 'the working tree cannot be read' }
        : null;
    try {
      const accepted = linkDraft({
        topic: 'E-37-not-whole-file', conclusion: 'saveReport emits reports/latest.json for loadReport',
        from: fileEnd('src/runtime/run.ts'),
        to: fileEnd('src/wg/permit.ts'),
        key: { kind: 'literal', text: 'reports/latest.json' },
        evidence: [
          { role: 'emit', at: { path: 'src/runtime/run.ts',
            symbolRequest: { language: 'typescript', name: 'saveReport' } } },
          { role: 'receive', at: { path: 'src/wg/permit.ts', range: { startLine: 5, endLine: 7 } } },
        ],
      });
      world.linkCheck.reset();
      world.linkCheck.faultReads(fault);
      let envelope: WriteNoteEnvelopeV1;
      try {
        envelope = await world.writePersonEnvelope(accepted);
      } finally {
        world.linkCheck.faultReads(null);
      }
      const write = acceptedWrite(envelope);
      expect(write.warnings).toEqual(['evidence_unverifiable']);

      // The same unavailable [0] must stay out of evidenceIndexes: only the
      // definite miss at [1] is reported.
      const missing = linkDraft({
        topic: 'E-37-not-whole-file-missing', conclusion: 'saveReport emits reports/latest.json for loadReport',
        from: fileEnd('src/runtime/run.ts'),
        to: fileEnd('src/wg/permit.ts'),
        key: { kind: 'literal', text: 'reports/latest.json' },
        evidence: [
          { role: 'emit', at: { path: 'src/runtime/run.ts',
            symbolRequest: { language: 'typescript', name: 'saveReport' } } },
          { role: 'receive', at: { path: 'src/wg/permit.ts', range: { startLine: 1, endLine: 1 } } },
        ],
      });
      world.linkCheck.reset();
      world.linkCheck.faultReads(fault);
      let rejected: WriteNoteEnvelopeV1;
      try {
        rejected = await world.writePersonEnvelope(missing);
      } finally {
        world.linkCheck.faultReads(null);
      }
      expect(rejected.write.status).toBe('rejected');
      if (rejected.write.status !== 'rejected') return;
      expect(rejected.write.reason).toBe('evidence_missing');
      expect(rejected.write.evidenceIndexes).toEqual([1]);
    } finally {
      await writeFile(runPath, original, 'utf8');
    }
  }, 60_000);

  it('W-write an unavailable working-tree read keeps the evidence unverifiable', async () => {
    // run.ts cannot be read from the working tree (the anchor existence probe
    // uses maxBytes:1 and is left alone) and there is no captured text to keep:
    // the receipt says evidence_unverifiable, never verified (8E-2 §4.4 :879).
    const draft = s8eLinkDraft(S8E_LINKS.K1, { topic: 'W-write-worktree-unavailable' });
    world.linkCheck.reset();
    world.linkCheck.faultReads(request => request.path === 'src/runtime/run.ts'
      && request.version.kind === 'working_tree' && request.maxBytes > 1
      ? { status: 'rejected', code: 'unavailable', reason: 'the working tree cannot be read' }
      : null);
    let envelope: WriteNoteEnvelopeV1;
    try {
      envelope = await world.writePersonEnvelope(draft);
    } finally {
      world.linkCheck.faultReads(null);
    }
    const write = acceptedWrite(envelope);
    expect(write.warnings).toEqual(['evidence_unverifiable']);
    // The readback: [0] has no digest, and the "from" end runModel, unreadable
    // too, is stored as a plain file anchor (G2 :434, G3 :435).
    const item = await itemOf(world, write.noteId);
    expect(item.link?.evidence[0]?.fileDigest).toBeNull();
    expect(item.anchor).not.toHaveProperty('symbol');
  }, 60_000);

  it('W-write a TS evidence file the working tree does not have is evidence_missing [1]', async () => {
    // Row 6 of the sheet's result table collects every definite miss: a file
    // that is not in the working tree is one (8E-2 §4.4 :880).
    const draft = s8eLinkDraft(S8E_LINKS.K1, { topic: 'W-write-gone-up' });
    draft.link.evidence[1] = { role: 'wire', at: { path: 'src/gone.ts',
      symbolRequest: { language: 'typescript', name: 'compose' } } };
    world.linkCheck.reset();
    const write = (await world.writePersonEnvelope(draft)).write;
    expect(write.status).toBe('rejected');
    if (write.status !== 'rejected') return;
    expect(write.reason).toBe('evidence_missing');
    expect(write.evidenceIndexes).toEqual([1]);
  }, 60_000);

  it('W-write an evidence file the working tree no longer has is evidence_missing [1]', async () => {
    // compose.ts reads not_found from the working tree (its existence probe,
    // maxBytes:1, is left alone). The spec's workspace table: a working-tree
    // not_found at write time means this evidence is not found (8E-2 §4.4 :880).
    const draft = s8eLinkDraft(S8E_LINKS.K1, { topic: 'W-write-gone-tree-up' });
    world.linkCheck.reset();
    world.linkCheck.faultReads(request => {
      if (request.path !== 'src/compose.ts' || request.maxBytes <= 1) return null;
      if (request.version.kind === 'working_tree') {
        return { status: 'rejected', code: 'not_found', reason: 'the file is not in the working tree' };
      }
      return null;
    });
    let envelope: WriteNoteEnvelopeV1;
    try {
      envelope = await world.writePersonEnvelope(draft);
    } finally {
      world.linkCheck.faultReads(null);
    }
    const write = envelope.write;
    expect(write.status).toBe('rejected');
    if (write.status !== 'rejected') return;
    expect(write.reason).toBe('evidence_missing');
    expect(write.evidenceIndexes).toEqual([1]);
  }, 60_000);

  it('E-38 literal-only data: accepted, verified write, builds 0; run.ts line 10 changed reads broken [0]', async () => {
    const draft = linkDraft({
      topic: 'E-38', conclusion: 'saveReport writes the report loadReport reads',
      from: fileEnd('src/runtime/run.ts'),
      to: fileEnd('src/wg/permit.ts'),
      key: { kind: 'literal', text: 'reports/latest.json' },
      evidence: [
        { role: 'emit', at: { path: 'src/runtime/run.ts', range: { startLine: 9, endLine: 11 } } },
        { role: 'receive', at: { path: 'src/wg/permit.ts', range: { startLine: 5, endLine: 7 } } },
      ],
    });
    world.linkCheck.reset();
    const envelope = await world.writePersonEnvelope(draft);
    const write = acceptedWrite(envelope);
    expect(write.version).toBe(1);
    expect(write.warnings).toEqual([]);
    // Mutation (G4 :436, ruling 9): the gate always calls the second tier → { builds: 1 }, red.
    expect(world.linkCheck.counters()).toEqual({ builds: 0 });
    const item = await itemOf(world, write.noteId);
    expect(item.link?.analysisConfig).toEqual({ path: null, digest: null });
    expect(item.link?.verification).toEqual({ status: 'verified' });
    expect(checkOf(envelope).linkVerification).toEqual({ status: 'verified' });
    // 8E :753's read half: run.ts line 10 names another path; the E3 read is broken at [0] (R5 rule 2 :350).
    const runPath = join(world.root, 'src/runtime/run.ts');
    const original = await readFile(runPath, 'utf8');
    await writeFile(runPath, original.replace("  write('reports/latest.json', '{}');",
      "  write('reports/other.json', '{}');"), 'utf8');
    try {
      world.linkCheck.reset();
      expect((await readLink(world, write.noteId))[0]).toEqual({ status: 'broken', missing: [0] });
      expect(world.linkCheck.counters()).toEqual({ builds: 0 });
    } finally {
      await writeFile(runPath, original, 'utf8');
    }
  }, 60_000);
});

/**
 * The similar-note header of a link is the frozen link form. The E2
 * `notes/write` envelope runs `checkNotes({ withSimilar: true })` for the note
 * it just wrote, so one person write of a general note with K1's conclusion on
 * K1's anchor lists K1 as a similar item (`src/app/core-routes.ts:861–864`).
 */
describe('S8E L3 similar-note header: a link similar item carries 注入 and the "to" end', () => {
  let world: S8ESemanticWorld;

  beforeAll(async () => { world = await openS8ESemanticWorld({ scribeTasks: 1 }); }, 120_000);
  afterAll(async () => { await world?.close(); });

  it('the similar header equals the frozen link format with both ends', async () => {
    const k1 = acceptedWrite(await world.writePersonEnvelope(s8eLinkDraft(S8E_LINKS.K1)));
    // Same anchor, same conclusion, a different topic so the same-topic gate
    // does not exclude the pair from the similar list.
    const general: NoteDraftV1 = {
      kind: 'pitfall', topic: 'similar-link-header', conclusion: S8E_LINKS.K1.conclusion,
      anchor: { kind: 'file', path: 'src/runtime/run.ts' },
      extraAnchors: [], facts: [], basisFiles: [], structural: false,
      replaces: [], contradicts: [], coexistWith: [], body: 'The same conclusion as K1.',
    };
    const envelope = await world.writePersonEnvelope(general);
    acceptedWrite(envelope);
    const similar = checkOf(envelope).similar ?? [];
    const item = similar.find(candidate => candidate.noteId === k1.noteId);
    expect(item).toBeDefined();
    expect(item?.header).toBe('联系·注入(src/runtime/run.ts#runModel→src/wg/permit.ts#authorize)：runModel authorizes through beforeCall');
  }, 120_000);
});
