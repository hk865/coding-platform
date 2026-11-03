import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BoardView } from '../../src/ui/runtime.js';
import { loadBoard } from './helpers/board-files.js';
import { serializeTree } from './helpers/render.js';
import { sceneView } from './helpers/e35-scene.js';

const shell = (readState: Record<string, unknown>) => {
  const board = loadBoard('TaskMap', fileURLToPath(new URL('../../src/ui/boards/', import.meta.url)));
  const view = new BoardView(board, { ...board.defaults, readState });
  return { html: serializeTree(view.render()), vals: view.instance.renderVals() as Record<string, unknown> };
};

/** E35-7: small fixes on the task map. */

describe('E35-7 small', () => {
  it('E35-7 7.1 查找 counts only stages, not the Goal’s acceptance', () => {
    /* Named mutation: count the Goal's acceptance as a stage (在 6 个阶段). */
    const { view, vals } = sceneView([]);
    view.instance.setState({ q: '验收' });
    expect(vals().qNote).toBe('8 个，在 5 个阶段');
  });

  it('E35-7 7.2 an acceptance node names （验收） once', () => {
    /* Named mutation: keep the gate suffix in the node tip. */
    expect(sceneView([]).vals().dag.nodes.find((n) => n.id === 'task:T18')!.tip).toBe('重新入队验收，待执行（验收）');
  });

  it('E35-7 7.3 resting on a node lights no line of its own', () => {
    /* Named mutation: put `hovNode === e.a || hovNode === e.b` back into the edge's is-hov. */
    const { vals } = sceneView([]);
    vals().dag.nodes.find((n) => n.id === 'task:T13')!.hover();
    expect((vals().dag as unknown as { edges: Array<{ cls: string }> }).edges.filter((e) => e.cls.includes('is-hov')).length).toBe(0);
  });

  it('E35-7 7.5 a shell with no Goal draws no empty goal square and still says the stream dropped', () => {
    /* Named mutation: draw the goal square with no Goal. */
    const { html } = shell({ status: 'empty', stale: true, staleText: '连接断开，正在重连。' });
    expect([/class="sq z10\s*"/.test(html), html.includes('连接断开，正在重连。')]).toEqual([false, true]);
  });

  it('E35-7 7.6 a shell’s view buttons are drawn as not pressed, as aria says', () => {
    /* Named mutation: the shell's view classes follow state.view again (DAG drawn pressed, aria-pressed false). */
    const { vals } = shell({ status: 'empty' });
    expect([vals.viewDagCls, vals.viewOutlineCls, vals.viewLanesCls, vals.isDag]).toEqual(['seg-btn', 'seg-btn', 'seg-btn', false]);
  });
});
