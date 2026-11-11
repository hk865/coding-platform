/**
 * S8B1-W: the one second-workspace world of B1-15 (the sheetthe sheet), wrapping `openXWS2AWorld`.
 *
 * The chain is public throughout: the XWS2A world's own `workspaces/open` (with `writeAllowed:true`
 * for B1), the join's coarse proposal approved through `decisions/answer` so the project catalog
 * gains `second-mod` with `src/second`, `plans/propose` + `plans/apply` for the second workspace's
 * Goal, a second-workspace executor line through `sessions/create`, the scripted model's `edit`
 * call inside a real Work Run, and `workflow/advance` in the second workspace's own scope. No
 * record, context or store is written by hand.
 */
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { S6A_WORK_ROLE } from './S6A-request-fixture.js';
import { asRecord } from './S6A-memory-fixture.js';
import { openXWS2AWorld, XWS2A_ADVISER_TOOLS, xws2aModuleInProject, type XWS2AWorld } from './XWS2A-world.js';

export const S8B1_SECOND_MODULE_ID = 'second-mod';
export const S8B1_SECOND_FILE = 'src/second/a.ts';

export type S8B1SecondWorkspaceWorld = {
  readonly world: XWS2AWorld;
  readonly ws1Scope: WorkspaceScope;
  readonly ws2Scope: WorkspaceScope;
  readonly goal: GoalRef;
  readonly run: RunRef;
  readonly filePath: string;
  readonly moduleId: string;
  close(): Promise<void>;
};

/** Open the XWS2A world, approve the coarse split and drive one real Work Run that writes the file. */
export async function openS8B1SecondWorkspaceWorld(): Promise<S8B1SecondWorkspaceWorld> {
  const world = await openXWS2AWorld({ backend: 'memory',
    secondOpenOptions: { writeAllowed: true },
    // The sheet's edit/write grant on the real Work Run: the edit tool and the workspace write root.
    adviserTools: [...XWS2A_ADVISER_TOOLS, 'write'],
    adviserWriteScope: ['.'],
    // The parent of the Work's own output exists before the Run; the file itself is the Run's edit.
    secondFiles: { 'src/second/README.md': '# S8B1 second workspace\n' } });
  try {
    await world.waitCoarseAnswered();
    await world.approveCoarse();
    // The XWS2A world's own Work Run entry: adopt the second workspace's Plan, assign the Goal to the
    // opening adviser line, script the edit and drive the Workflow in the second workspace's scope.
    const { run } = await world.workRun({ label: 's8b1', replies: [
      { kind: 'calls', calls: [{ callId: 's8b1-second-edit', name: 'edit',
        args: { mode: 'create', path: S8B1_SECOND_FILE, newText: 'export const second = 1;\n' } }] },
      { kind: 'text', text: 'S8B1: the second workspace file is written' },
    ] });
    return {
      world,
      ws1Scope: world.base.main.scope,
      ws2Scope: world.second.scope,
      goal: world.second.goal,
      run,
      filePath: S8B1_SECOND_FILE,
      // KLS-2b: the module the second workspace's Run proposed, in the project view.
      moduleId: xws2aModuleInProject(world.second.scope.workspaceId),
      close: async () => await world.close(),
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

