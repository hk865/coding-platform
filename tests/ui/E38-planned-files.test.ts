import { describe, expect, it } from 'vitest';
import { adaptTaskMapDetail, type TaskMapSummaryRead } from '../../src/ui/adapters/task-map.js';
import { sceneData, sceneView, type Row } from './helpers/e35-scene.js';

/** E38-R10 (spec §3.4, §3.6): a Task's planned files in the detail's 架构. The adapter's rows, tags and
 * `plannedFileCount` are a pure table (A5); the 架构 summary and the rows' squares and tag classes are the working
 * board's, on the E3-5 scene (E36-1, E35-4 4.9). E3-7 has landed: `uncommitted` is passed as `null`, its value for
 * "not read" (task-map.ts:761, E37-U3 没读), so no tag carries +a −d and `filesNote` is '' (spec §3.6 seam). */
const summaryOf = (task: Record<string, unknown>, taskId = 't') =>
  ({ section: 'summary', task: { task: { taskId }, ...task } }) as unknown as TaskMapSummaryRead;
const catalog = { modules: [{ ref: { moduleId: 'core' }, name: '核心', paths: ['src/core'] }], containment: { parentOf: [] } };
const CORE = [{ projectId: 'p', moduleId: 'core' }];
const X = 'src/core/x.ts';
const Y = 'src/core/y.ts';
const Z = 'src/core/z.ts';
const W = 'lib/w.ts';
/** `actualFiles` as `graph/detail` sends it (ExecutedFileV1: runRef, path, certainty). */
const ran = (...files: Array<[string, 'definite' | 'possible', string?]>) =>
  ({ availability: 'available', value: files.map(([path, certainty, runId = 'r1']) => ({ runRef: { runId }, path, certainty })) });
const detailOf = (task: Record<string, unknown>, state: string, taskId = 't') =>
  adaptTaskMapDetail(summaryOf(task, taskId), [], null, catalog, state, '', null, '', [], null, null)!;

/* Named mutations (the row's, spec §7 R10): with a list, 不在计划里 is still judged by module (清单外，在模块里: z reads
   实际改过); with a list, the planned module's row is still written (只计划 gets one more row). Each cell names its own below. */
describe('E38-R10 the adapter: planned files in 架构 (spec §3.4, §3.6)', () => {
  it.each([
    /* 只计划. Named mutation: in src/ui/adapters/task-map.ts the planned-module loop (base :805) still runs when the
       Task has a list: a first row { path: '', name: '核心', certainty: 'planned', tag: '计划要改' }; red at the files toEqual. */
    ['只计划', { plannedFiles: [X, Y], plannedModules: CORE }, [{ crumb: '核心', files: [
      { path: X, name: 'x.ts', certainty: 'planned', tag: '计划要改' }, { path: Y, name: 'y.ts', certainty: 'planned', tag: '计划要改' }] }], 2],
    /* 计划且改过. Named mutation: an executed file on the list is tagged without the “计划要改 · ” prefix (x reads
       实际改过); red at the files toEqual. */
    ['计划且改过', { plannedFiles: [X, Y], plannedModules: CORE, actualFiles: ran([X, 'definite']) }, [{ crumb: '核心', files: [
      { path: X, name: 'x.ts', certainty: 'definite', tag: '计划要改 · 实际改过' }, { path: Y, name: 'y.ts', certainty: 'planned', tag: '计划要改' }] }], 2],
    /* 计划且可能改过. Named mutation: the list's prefix branch writes the definite word whatever the certainty (x reads
       计划要改 · 实际改过); red at the files toEqual. */
    ['计划且可能改过', { plannedFiles: [X], actualFiles: ran([X, 'possible']) }, [{ crumb: '核心', files: [
      { path: X, name: 'x.ts', certainty: 'possible', tag: '计划要改 · 可能改过' }] }], 1],
    /* 清单外，在模块里. Named mutation: with a list, 不在计划里 is still judged by module (base :836, z is in the
       planned module core): z reads 实际改过; red at the files toEqual. */
    ['清单外，在模块里', { plannedFiles: [X], plannedModules: CORE, actualFiles: ran([Z, 'definite']) }, [{ crumb: '核心', files: [
      { path: X, name: 'x.ts', certainty: 'planned', tag: '计划要改' }, { path: Z, name: 'z.ts', certainty: 'definite', tag: '实际改过 · 不在计划里' }] }], 1],
    /* 清单外，可能改过 (ruling 12: x's row is there too). Named mutation: 不在计划里 still needs a planned module (base
       :836's `planned.size > 0`, “a plan without modules says nothing”): z reads 可能改过; red at the files toEqual. */
    ['清单外，可能改过', { plannedFiles: [X], actualFiles: ran([Z, 'possible']) }, [{ crumb: '核心', files: [
      { path: X, name: 'x.ts', certainty: 'planned', tag: '计划要改' }, { path: Z, name: 'z.ts', certainty: 'possible', tag: '可能改过 · 不在计划里' }] }], 1],
    /* 两条记录. Named mutation: a listed file takes the certainty of its first executed record (an `executed.find`
       instead of base :815-:822's “one definite makes it 实际改过”): x reads possible, 计划要改 · 可能改过; red at the files toEqual. */
    ['两条记录', { plannedFiles: [X], actualFiles: ran([X, 'possible', 'r1'], [X, 'definite', 'r2']) }, [{ crumb: '核心', files: [
      { path: X, name: 'x.ts', certainty: 'definite', tag: '计划要改 · 实际改过' }] }], 1],
    /* 不归模块. Named mutation: a listed file in no catalog module is grouped under the prototype's
       当前架构里还没有（计划新建） (prototype:3379; spec §3.6 and Q23 keep 未归入模块); red at the files toEqual. */
    ['不归模块', { plannedFiles: [W] }, [{ crumb: '未归入模块', files: [{ path: W, name: 'w.ts', certainty: 'planned', tag: '计划要改' }] }], 1],
    /* 没写清单 (E3-6 unchanged). Named mutation: the planned-module row is dropped for every Task, a list or not (the
       loop at base :805 removed): only z is left; red at the files toEqual. At the base the files sentence is green and
       the plannedFileCount sentence red (the field does not exist yet). */
    ['没写清单', { plannedFiles: [], plannedModules: CORE, actualFiles: ran([Z, 'definite']) }, [{ crumb: '核心', files: [
      { path: '', name: '核心', certainty: 'planned', tag: '计划要改' }, { path: Z, name: 'z.ts', certainty: 'definite', tag: '实际改过' }] }], 0],
  ])('E38-R10 %s', (_, task, files, count) => {
    const detail = detailOf(task, 'running');
    expect(detail.files).toEqual(files);
    /* Named mutation (count): plannedFileCount counts the rows at certainty planned, not the list (计划且改过 reads 1,
       计划且可能改过 and 两条记录 read 0, 没写清单 reads 1 for the module row); red here. */
    expect(detail.plannedFileCount).toBe(count);
  });
});

describe('E38-R10 the board: the 架构 summary, squares and tag classes (spec §3.6)', () => {
  /** The working board with T13's detail adapted from `task`; T13's node state set to `st` in the map and the detail. */
  const archOf = (task: Record<string, unknown>, st: string) => {
    const data = sceneData();
    data.tasks.find((entry) => entry.id === 'T13')!.st = st;
    Object.assign(data, { detailFor: 'T13', detail: detailOf(task, st, 'T13') });
    const { view, vals } = sceneView([], data);
    view.instance.setState({ sel: 'task:T13' });
    return vals().det as unknown as { archSum: string; arch: Array<{ crumb: string; files: Row[] }> };
  };

  it.each([
    /* Named mutation: in src/ui/boards/TaskMap.dc.html the actual sentence is still chosen by a row with a path
       (base :3051 `f.path !== ''`): the planned rows have paths, so this reads 计划要改 2 个文件 · 实际改过／可能改过（现在）;
       red at the archSum toBe. */
    ['2 planned, no actual row, pending', { plannedFiles: [X, Y] }, 'pending', '计划要改 2 个文件 · 还没开始改'],
    /* Named mutation: the idle sentence is written whatever the node state (running reads … · 还没开始改); red at the archSum toBe. */
    ['2 planned, no actual row, running', { plannedFiles: [X, Y] }, 'running', '计划要改 2 个文件'],
    /* Named mutation: with a list the summary stops at 计划要改 n 个文件 and drops the actual sentence; red at the archSum toBe. */
    ['2 planned, one definite row', { plannedFiles: [X, Y], actualFiles: ran([X, 'definite']) }, 'running', '计划要改 2 个文件 · 实际改过／可能改过（现在）'],
    /* Named mutation: the count is written with no list too (计划要改 0 个文件 · 实际改过／可能改过（现在）); red at the
       archSum toBe. Green at the base: unchanged from E3-5. */
    ['0 planned, one definite row', { actualFiles: ran([Z, 'definite']) }, 'running', '实际改过／可能改过（现在）'],
  ])('E38-R10 the summary with %s', (_, task, st, sum) => {
    expect(archOf(task, st).archSum).toBe(sum);
  });

  it('E38-R10 a planned-only row has no square and a plain tag; a planned row also changed has the actual square and tag is-act', () => {
    /* Named mutation: the board gives a square to every row with a path (`f.path === '' ? '' : …` for base :3048's
       `f.certainty === 'planned'`): y gets sq z8 s-pending; red at the toEqual. */
    const files = archOf({ plannedFiles: [X, Y], actualFiles: ran([X, 'definite']) }, 'running').arch.flatMap((group) => group.files);
    expect(files.map((file) => [file.path, file.sq, file.tagCls])).toEqual([[X, 'sq z8 s-satisfied', 'tag is-act'], [Y, '', 'tag']]);
  });
});
