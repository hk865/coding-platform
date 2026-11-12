/**
 * KLS-2c-2b owner rows (A5) for what K24–K28 leave to the pure rule: which lines and modules a plan's pin keeps
 * ([2C2-02]) and which modules a draft uses ([2C2-03]: module scopes, and planned files by their owner in the Goal's
 * workspace, projected first). `planPinOf` narrows what was read before the proposal window; the rows hand it that
 * read: workspace `ws` is the main one, the Goal is in `ws2`.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { KnowledgeLinePinV1 } from '../../src/contracts/knowledge.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { planPinOf, type PlanPinRead } from '../../src/core/work-graph/knowledge/pin.js';

const module = (moduleId: string, paths: string[]): ModuleDefinition =>
  ({ ref: { projectId: 'p', moduleId }, name: moduleId, responsibility: `own ${moduleId}`, paths, interfaces: [] });
/** Main `root` owns `.`, main `core` owns `src/core`, ws2's `svc` owns its `src/x`, ws2's `tied` and `twin` share `src/t`. */
const CATALOG: AdoptedArchitecture = { requireDag: true, dependencies: [], modules: [module('root', ['.']),
  module('core', ['src/core']), module('/@ws:ws2/svc', ['/@ws:ws2/src/x']), module('/@ws:ws2/tied', ['/@ws:ws2/src/t']),
  module('/@ws:ws2/twin', ['/@ws:ws2/src/t'])] };
const linePin = (workspaceId: string, modules: string[] | null): KnowledgeLinePinV1 => ({
  lineRef: JSON.stringify([workspaceId, '']), contentHash: '0'.repeat(64), head: null, dirty: modules !== null,
  modules: modules?.map(moduleId => ({ moduleId, paths: [], responsibility: '', contains: [], dependsOn: [] })) ?? null });
/** What the read before the window found: main dirty with root and core, ws2 dirty with svc. */
const READ: PlanPinRead = { goalWorkspaceId: 'ws2', mainWorkspaceId: 'ws',
  lines: [{ workspaceId: 'ws', pin: linePin('ws', ['core', 'root']) }, { workspaceId: 'ws2', pin: linePin('ws2', ['/@ws:ws2/svc']) }] };
const task = (moduleRef: string | null, plannedFiles?: string[]) => ({ taskId: 't', stageId: 's', title: 't',
  requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
  scope: moduleRef === null ? { kind: 'stage', stageId: 's' } : { kind: 'module', stageId: 's', moduleRef },
  ...(plannedFiles === undefined ? {} : { plannedFiles }) });
const pinned = (tasks: ReturnType<typeof task>[]) => planPinOf(READ, tasks as unknown as PlanRevisionDraft['tasks'], CATALOG)
  .lines.map(line => [JSON.parse(line.lineRef)[0], line.modules?.map(entry => entry.moduleId) ?? null]);

describe('[2C2-02]/[2C2-03] the plan pin keeps the Goal line and the used modules\' lines', () => {
  it.each([
    { name: 'a main module scope: both lines, main narrowed to it', tasks: [task('core')],
      lines: [['ws', ['core']], ['ws2', []]] },
    { name: 'no module used: only the Goal line, its modules narrowed to none', tasks: [task(null)],
      lines: [['ws2', []]] },
    { name: 'a planned file in the Goal workspace is owned there, not by the main `.`', tasks: [task(null, ['src/x/a.ts'])],
      lines: [['ws2', ['/@ws:ws2/svc']]] },
    { name: 'a tied or unowned planned file adds no module', tasks: [task(null, ['src/t/a.ts', 'docs/a.md'])],
      lines: [['ws2', []]] },
    { name: 'a module the catalog lacks is left to the module fact', tasks: [task('ghost')],
      lines: [['ws2', []]] },
  ])('$name', ({ tasks, lines }) => {
    expect(pinned(tasks)).toEqual(lines);
  });

  it('a clean line keeps its null modules', () => {
    const clean: PlanPinRead = { ...READ, lines: [{ workspaceId: 'ws', pin: linePin('ws', null) }, READ.lines[1]!] };
    expect(planPinOf(clean, [task('core')] as unknown as PlanRevisionDraft['tasks'], CATALOG).lines.map(line => line.modules))
      .toEqual([null, []]);
  });
});
