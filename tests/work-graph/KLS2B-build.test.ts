/**
 * KLS-2b build rows (kls2b-build.md): the write queue's order ([2B-06], [2B-08]) and the link/flow/repair
 * file forms ([2B-09]–[2B-11]) at their own module level.
 */
import { describe, expect, it } from 'vitest';
import { createKnowledgeWriteQueue } from '../../src/core/work-graph/knowledge/write-queue.js';
import { noteFileBytes, noteKnowledgeOf, noteOfFileBytes } from '../../src/core/work-graph/notes/note-file.js';
import type { NoteBodyV1, NoteHeadSnapshot } from '../../src/contracts/note.js';

describe('KLS2B write queue', () => {
  it('KQ-1 one project runs one write at a time; another project on another folder does not wait', async () => {
    const queue = createKnowledgeWriteQueue();
    const order: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const first = queue.run('p1', ['/a'], async () => { order.push('p1-first-start'); await gate; order.push('p1-first-end'); });
    const second = queue.run('p1', ['/a'], async () => { order.push('p1-second'); });
    const other = queue.run('p2', ['/b'], async () => { order.push('p2'); });
    await other;
    expect(order).toEqual(['p1-first-start', 'p2']);
    open();
    await Promise.all([first, second]);
    expect(order).toEqual(['p1-first-start', 'p2', 'p1-first-end', 'p1-second']);
  });

  it('KQ-2 two projects on one folder take turns', async () => {
    const queue = createKnowledgeWriteQueue();
    const order: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const first = queue.run('p1', ['/shared', '/a'], async () => { await gate; order.push('p1'); });
    const second = queue.run('p2', ['/shared'], async () => { order.push('p2'); });
    open();
    await Promise.all([first, second]);
    expect(order).toEqual(['p1', 'p2']);
  });
});

const SCOPE = { workspaceId: 'ws2', mainWorkspaceId: 'ws' };
const SOURCE = { kind: 'user', principalId: 'u1' } as const;
const BASE: Omit<NoteBodyV1, 'kind' | 'anchor'> = { topic: 'Billing calls core', topicKey: 'billing calls core',
  conclusion: 'via the queue', body: 'b', extraAnchors: [], facts: [], structural: false, replaces: [], contradicts: [],
  coexistWith: [], basis: { planRevision: null, catalogRevision: null, files: [] } };

describe('KLS2B note file forms', () => {
  it('KF-1 a link keeps only its locating input; ids and paths go through the file frame and back', () => {
    const head: NoteBodyV1 & Pick<NoteHeadSnapshot, 'source'> = { ...BASE, source: SOURCE, kind: 'link',
      anchor: { kind: 'module', moduleId: 'core' },
      link: { relation: 'data', ends: { from: { kind: 'module', moduleId: 'core' },
        to: { kind: 'file', path: '/@ws:ws2/src/b.ts', symbolRequest: { language: 'typescript', name: 'b' } }, via: null },
      key: { kind: 'literal', text: 'topic' },
      evidence: [{ role: 'emit', at: { path: 'src/a.ts', symbol: { qualifiedName: 'a', range: { startLine: 1, endLine: 2 } } as never },
        fileDigest: 'd'.repeat(64), digestBasis: 'raw_bytes' },
      { role: 'receive', at: { path: '/@ws:ws2/src/b.ts', range: { startLine: 3, endLine: 4 } }, fileDigest: null,
        digestBasis: 'raw_bytes' }],
      analysisConfig: { path: null, digest: null }, verification: { status: 'verified' } } };
    const knowledge = noteKnowledgeOf(head);
    const bytes = noteFileBytes(knowledge, SCOPE);
    if (bytes.status !== 'decoded') throw new Error(bytes.reason);
    const text = new TextDecoder().decode(bytes.value);
    expect(text).toContain('"moduleId": "/@ws:ws/core"');
    expect(text).toContain('"path": "src/b.ts"');
    expect(text).not.toContain('fileDigest');
    expect(text).not.toContain('verification');
    expect(text).not.toContain('qualifiedName');
    expect(noteOfFileBytes(bytes.value, SCOPE)).toEqual({ status: 'decoded', value: knowledge });
  });

  it('KF-2 a repair keeps its ops only (no pin, no moves); a flow keeps its step ids', () => {
    const repair: NoteBodyV1 & Pick<NoteHeadSnapshot, 'source'> = { ...BASE, source: SOURCE, kind: 'repair',
      anchor: { kind: 'module', moduleId: '/@ws:ws2/svc' },
      repair: { pin: { catalogRef: { projectId: 'p' } } as never, responsibilityMoves: [], structural: false,
        ops: [{ op: 'add_path', moduleId: '/@ws:ws2/svc', path: '/@ws:ws2/src/svc' }] } };
    const bytes = noteFileBytes(noteKnowledgeOf(repair), SCOPE);
    if (bytes.status !== 'decoded') throw new Error(bytes.reason);
    const text = new TextDecoder().decode(bytes.value);
    expect(text).toContain('"moduleId": "svc"');
    expect(text).toContain('"path": "src/svc"');
    expect(text).not.toContain('pin');
    const read = noteOfFileBytes(bytes.value, SCOPE);
    expect(read.status === 'decoded' && read.value.repair).toEqual({ ops: [{ op: 'add_path', moduleId: '/@ws:ws2/svc',
      path: '/@ws:ws2/src/svc' }] });
    const flow = noteKnowledgeOf({ ...BASE, source: SOURCE, kind: 'flow', anchor: { kind: 'module', moduleId: 'core' },
      flow: { steps: [{ link: 'n1' }, { link: 'n2' }] } });
    const flowBytes = noteFileBytes(flow, SCOPE);
    if (flowBytes.status !== 'decoded') throw new Error(flowBytes.reason);
    expect(noteOfFileBytes(flowBytes.value, SCOPE)).toEqual({ status: 'decoded', value: flow });
  });
});
