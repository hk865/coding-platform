/**
 * S8E L2 W-shape (sheet §6.2): the link draft's L1 shape through the public
 * person `notes/write` route. Each draft is wrong in exactly one place, and the
 * assertion is the bare reason token (or the frozen `field.path` form).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LinkDraftV1, LinkEvidenceV1, NoteDraftV1 } from '../../src/contracts/note.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const K1 = S8E_LINKS.K1;
const K3 = S8E_LINKS.K3;
const K5 = S8E_LINKS.K5;

const clone = <T>(value: T): T => structuredClone(value);

/** A K1/K3/K5 link with one top-level or payload field replaced. */
function linkDraft(spec: typeof K1, patch: Partial<LinkDraftV1> = {},
  link: Partial<LinkDraftV1['link']> = {}): NoteDraftV1 {
  const draft = s8eLinkDraft(spec, patch);
  return { ...draft, link: { ...draft.link, ...link } } as NoteDraftV1;
}

const generalDraft = (): NoteDraftV1 => ({
  kind: 'pitfall', topic: 'shape', conclusion: 'shape conclusion', body: 'a body',
  anchor: { kind: 'module', moduleId: 'runtime' }, extraAnchors: [], facts: [], basisFiles: [],
  structural: false, replaces: [], contradicts: [], coexistWith: [],
});

const linkWithoutPayload = (): NoteDraftV1 => {
  const draft = s8eLinkDraft(K1) as unknown as Record<string, unknown>;
  delete draft['link'];
  return draft as unknown as NoteDraftV1;
};

const symbolEvidence = (path: string, language = 'typescript'): LinkEvidenceV1 =>
  ({ role: 'emit', at: { path, symbolRequest: { language, name: 'runModel' } } });

const nineEvidence = (): LinkEvidenceV1[] =>
  Array.from({ length: 9 }, () => clone(K1.evidence[0]!));

const k1ToModule = (): NoteDraftV1 => linkDraft(K1, {
  extraAnchors: [{ kind: 'module', moduleId: 'wg' }, K1.via!],
});
const k1ViaModule = (): NoteDraftV1 => linkDraft(K1, {
  extraAnchors: [K1.to, { kind: 'module', moduleId: 'contracts' }],
});

const CASES: { name: string; reason: string; draft: () => NoteDraftV1 }[] = [
  { name: 'link_anchor_count: no extra anchors', reason: 'link_anchor_count',
    draft: () => linkDraft(K1, { extraAnchors: [] }) },
  { name: 'link_anchor_count: three extra anchors', reason: 'link_anchor_count',
    draft: () => linkDraft(K1, { extraAnchors: [K1.to, K1.via!, { kind: 'file', path: 'src/compose.ts' }] }) },
  { name: 'link_anchor_count: injects with one extra anchor', reason: 'link_anchor_count',
    draft: () => linkDraft(K1, { extraAnchors: [K1.to] }) },
  { name: 'link_anchor_kind: via is a module', reason: 'link_anchor_kind', draft: k1ViaModule },
  { name: 'link_anchor_kind: to is a module for injects', reason: 'link_anchor_kind', draft: k1ToModule },
  { name: 'evidence_count: none', reason: 'evidence_count',
    draft: () => linkDraft(K1, {}, { evidence: [] }) },
  { name: 'evidence_count: nine', reason: 'evidence_count',
    draft: () => linkDraft(K1, {}, { evidence: nineEvidence() }) },
  { name: 'evidence_roles: use and register for injects', reason: 'evidence_roles',
    draft: () => linkDraft(K1, {}, { evidence: [
      { role: 'use', at: K1.evidence[0]!.at }, { role: 'register', at: K1.evidence[1]!.at },
    ] }) },
  { name: 'evidence_roles: K3 register only', reason: 'evidence_roles',
    draft: () => linkDraft(K3, {}, { evidence: [{ role: 'register', at: K3.evidence[0]!.at }] }) },
  { name: 'link_key_mismatch: injects carries a key', reason: 'link_key_mismatch',
    draft: () => linkDraft(K1, {}, { key: { kind: 'literal', text: 'wg.audit' } }) },
  { name: 'link_key_mismatch: K3 without a key', reason: 'link_key_mismatch',
    draft: () => { const draft = linkDraft(K3) as LinkDraftV1; delete draft.link.key; return draft; } },
  { name: 'link_key_invalid: literal contains a newline', reason: 'link_key_invalid',
    draft: () => linkDraft(K3, {}, { key: { kind: 'literal', text: 'wg.\naudit' } }) },
  { name: 'link_key_invalid: 513 code points', reason: 'link_key_invalid',
    draft: () => linkDraft(K3, {}, { key: { kind: 'literal', text: 'a'.repeat(513) } }) },
  { name: 'link_key_invalid: symbol key language is python', reason: 'link_key_invalid',
    draft: () => linkDraft(K3, {}, { key: { kind: 'symbol', anchor: { kind: 'file', path: 'src/wg/audit.ts',
      symbolRequest: { language: 'python', name: 'audit' } } } }) },
  { name: 'link_key_invalid: symbol key anchor is a module', reason: 'link_key_invalid',
    draft: () => linkDraft(K3, {}, { key: { kind: 'symbol',
      anchor: { kind: 'module', moduleId: 'runtime' } } as never }) },
  { name: 'link_key_invalid: symbol key file anchor lacks symbolRequest', reason: 'link_key_invalid',
    draft: () => linkDraft(K3, {}, { key: { kind: 'symbol',
      anchor: { kind: 'file', path: 'src/wg/audit.ts' } } as never }) },
  { name: 'structural_not_allowed', reason: 'structural_not_allowed',
    draft: () => linkDraft(K1, { structural: true }) },
  { name: 'payload_kind_mismatch: pitfall carries link', reason: 'payload_kind_mismatch',
    draft: () => ({ ...generalDraft(), link: clone(K1) as never } as NoteDraftV1) },
  { name: 'payload_kind_mismatch: link without link', reason: 'payload_kind_mismatch',
    draft: linkWithoutPayload },
  { name: 'evidence_invalid: at gives symbolRequest and range', reason: 'evidence_invalid: link.evidence[0].at',
    draft: () => linkDraft(K1, {}, { evidence: [
      { role: 'use', at: { path: 'src/runtime/run.ts',
        symbolRequest: { language: 'typescript', name: 'runModel' }, range: { startLine: 1, endLine: 1 } } },
      K1.evidence[1]!,
    ] }) },
  { name: 'evidence_invalid: range end before start', reason: 'evidence_invalid: link.evidence[1].at.range',
    draft: () => linkDraft(K1, {}, { evidence: [
      K1.evidence[0]!, { role: 'wire', at: { path: 'src/compose.ts', range: { startLine: 8, endLine: 7 } } },
    ] }) },
  { name: 'evidence_invalid: symbolRequest language is python on a .ts file',
    reason: 'evidence_invalid: link.evidence[0].at.symbolRequest',
    draft: () => linkDraft(K1, {}, { evidence: [
      { role: 'use', at: { path: 'src/runtime/run.ts',
        symbolRequest: { language: 'python', name: 'runModel' } } }, K1.evidence[1]!,
    ] }) },
  { name: 'evidence_invalid: symbolRequest on a .py evidence file',
    reason: 'evidence_invalid: link.evidence[0].at.symbolRequest',
    draft: () => linkDraft(K5, {}, { evidence: [
      symbolEvidence('src/robot/teleop.py', 'python'),
      { role: 'receive', at: { path: 'src/robot/drive.py', range: { startLine: 2, endLine: 2 } } },
    ] }) },
  { name: 'anchor_invalid: to language is python', reason: 'anchor_invalid: extraAnchors[0]',
    draft: () => linkDraft(K1, { extraAnchors: [
      { kind: 'file', path: 'src/wg/permit.ts',
        symbolRequest: { language: 'python', name: 'authorize' } }, K1.via!,
    ] }) },
];

describe('S8E L2 W-shape: the link draft shape through notes/write', () => {
  let world: S8ESemanticWorld;
  beforeAll(async () => { world = await openS8ESemanticWorld({ scribeTasks: 1 }); }, 120_000);
  afterAll(async () => { await world?.close(); });

  it.each(CASES)('$name', async ({ reason, draft }) => {
    const write = await world.writePerson(draft());
    expect(write.status).toBe('rejected');
    if (write.status !== 'rejected') return;
    expect(write.code).toBe('invalid');
    expect(write.reason).toBe(reason);
  });
});
