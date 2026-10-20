/**
 * Slice 4C-2 session A NE5 (memory-material wiring): through the REAL
 * composition root (`createTargetPlatform`, memory store), the project
 * understanding and norm a user wrote reach the notes context extension used by
 * the execution-context assembly. The same real read feeds
 * `createExecutionPreparation.prepare`; this file reaches the ONE
 * `readMemoryMaterial` owner through the public `graphContext.readContextFacts`
 * with `includeInputs: true`, the flag only the assembly path sets (§11.7).
 */
import { expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture } from '../helpers/S4A-note-fixture.js';

function common(anchor: NoteDraftV1['anchor']): Pick<NoteDraftV1, 'anchor' | 'extraAnchors' | 'facts' | 'basisFiles'
  | 'structural' | 'replaces' | 'contradicts' | 'coexistWith'> {
  return { anchor, extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [] };
}

function projectUnderstanding(conclusion: string): NoteDraftV1 {
  return { ...common({ kind: 'project' }), kind: 'understanding', topic: '现状', conclusion,
    sections: { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' } };
}

function projectConvention(conclusion: string): NoteDraftV1 {
  return { ...common({ kind: 'project' }), kind: 'convention', topic: '路径', conclusion, body: '都用 POSIX 路径' };
}

function goalPitfall(goalId: string, conclusion: string): NoteDraftV1 {
  return { ...common({ kind: 'goal', goalId }), kind: 'pitfall', topic: '坑',
    conclusion, body: '工作执行里的坑' };
}

async function writeUser(f: S4ANoteFixture, note: NoteDraftV1): Promise<string> {
  const result = await f.write(f.ctx(), note, note.anchor.kind === 'goal' ? note.anchor.goalId : null);
  return result.status;
}

it('S4C2 NE5 the real composition gives the notes extension the project understanding and norm', async () => {
  const f = await createS4ANoteFixture('memory');
  try {
    expect(await writeUser(f, projectUnderstanding('项目当前理解：走 POSIX 路径'))).toBe('accepted');
    expect(await writeUser(f, projectConvention('项目规范：都用 POSIX 路径'))).toBe('accepted');
    expect(await writeUser(f, goalPitfall('s4a-goal', '目标上的坑'))).toBe('accepted');

    // Only the assembly path (`includeInputs`) pays for the material.
    const assembly = await f.platform.graphContext.readContextFacts(f.ctx(), {
      goalRef: f.goalRef, planRef: f.planRef, focusTaskIds: ['t1'], includeInputs: true,
    });
    expect(assembly.status).toBe('ready');
    if (assembly.status !== 'ready') throw Error(`readContextFacts was not ready: ${JSON.stringify(assembly)}`);
    const notes = assembly.value.extensions.notes;
    expect(notes.availability).toBe('available');
    expect(notes.understanding.rows.map(row => row.conclusion))
      .toContain('项目当前理解：走 POSIX 路径');
    expect(notes.understanding.rows.some(row => row.scope === 'project')).toBe(true);
    expect(notes.understanding.norms.map(row => row.conclusion))
      .toContain('项目规范：都用 POSIX 路径');
    expect(notes.general.map(row => row.conclusion)).toContain('目标上的坑');

    // Ruling 9 (item A): a Query read (`includeInputs: false`) still reaches the
    // material but skips the related scope and the general part; the general
    // note must not appear even though the default (undefined) would read it.
    const query = await f.platform.graphContext.readContextFacts(f.ctx(), {
      goalRef: f.goalRef, planRef: f.planRef, focusTaskIds: ['t1'], includeInputs: false,
    });
    expect(query.status).toBe('ready');
    if (query.status !== 'ready') throw Error('the Query readContextFacts was not ready');
    const queryNotes = query.value.extensions.notes;
    expect(queryNotes.availability).toBe('available');
    expect(queryNotes.general).toEqual([]);
    expect(queryNotes.understanding.rows.map(row => row.conclusion))
      .toContain('项目当前理解：走 POSIX 路径');
    expect(queryNotes.understanding.norms.map(row => row.conclusion))
      .toContain('项目规范：都用 POSIX 路径');

    const look = await f.platform.graphContext.readContextFacts(f.ctx(), {
      goalRef: f.goalRef, planRef: f.planRef, focusTaskIds: ['t1'],
    });
    expect(look.status).toBe('ready');
    if (look.status !== 'ready') throw Error('readContextFacts was not ready');
    expect(look.value.extensions.notes.availability).toBe('not_implemented');
  } finally { await f.close(); }
});
