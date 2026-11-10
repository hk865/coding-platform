/**
 * B1-06 and B1-08..10 of the frozen test sheet (`darr-b1-tests.frozen.md` §2.2): the current
 * Goal's actual changes through the public `architecture/change-scope` route.
 *
 * The definite/incomplete worlds are real Hosts with the scripted model (`S8B1-change-scope-world.ts`):
 * the AG2b Work Run writes `src/ag2b-result.txt`, a second Goal of the same project has its own
 * Run writing `src/ag2b-other.txt`, a starting Run has no activity, and the second Goal with no
 * Run is empty. B1-15 lives in the same file (the frozen sheet names this file): the XWS2A
 * second-workspace chain. The route body is `{scope,input}`; a bare `{goalRef}` is refused.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AG2B_SCOPE } from '../helpers/AG2b-collaboration-fixture.js';
import {
  changeScopeOfBody, openS8B1DefiniteWorld, openS8B1NoRunWorld, openS8B1StartingWorld,
  postS8B1ChangeScope, postS8B1ChangeScopeOn,
  type S8B1ChangeScope, type S8B1DefiniteWorld, type S8B1StartingWorld,
} from '../helpers/S8B1-change-scope-world.js';
import { openS8B1SecondWorkspaceWorld,
  type S8B1SecondWorkspaceWorld } from '../helpers/S8B1-second-workspace-world.js';

const definite: S8B1DefiniteWorld[] = [];
const starting: S8B1StartingWorld[] = [];
const second: S8B1SecondWorkspaceWorld[] = [];
afterEach(async () => {
  for (const handle of second.splice(0).reverse()) await handle.close();
  for (const handle of starting.splice(0).reverse()) await handle.close();
  for (const handle of definite.splice(0).reverse()) await handle.close();
});

const pathsOf = (scope: S8B1ChangeScope) => scope.files.map(file => file.path);

describe('S8B1 current goal actual changes', () => {
  it('B1-06 a definite Work Run file is definite, its module changed:1 and the answer is complete', async () => {
    const world = await openS8B1DefiniteWorld();
    definite.push(world);
    const answer = await postS8B1ChangeScopeOn(world.host, AG2B_SCOPE, world.firstGoal);
    expect(answer.httpStatus).toBe(200);
    const scope = changeScopeOfBody(answer.body);
    expect(scope.files).toEqual(expect.arrayContaining([expect.objectContaining({
      path: world.firstFile, certainty: 'definite',
      moduleRef: { projectId: AG2B_SCOPE.projectId, moduleId: world.moduleId },
    })]));
    const module = scope.modules.find(entry => (entry.moduleRef?.moduleId ?? entry.moduleId) === world.moduleId);
    expect(module).toMatchObject({ changed: 1 });
    expect(scope.counts.changed).toBeGreaterThanOrEqual(1);
    expect(scope.complete).toBe(true);
  });

  it('B1-08 a starting Run has no files, zero counts and is not complete; it is not unavailable/not_found', async () => {
    const world = await openS8B1StartingWorld();
    starting.push(world);
    const answer = await postS8B1ChangeScope(world.world, world.world.scope, world.goal);
    expect(answer.httpStatus).toBe(200);
    const body = answer.body as Record<string, unknown>;
    expect(body['status']).toBe('ready');
    const scope = changeScopeOfBody(answer.body);
    expect(scope.files).toEqual([]);
    expect(scope.counts).toEqual({ files: 0, changed: 0, possible: 0 });
    expect(scope.complete).toBe(false);
  });

  it('B1-09 a Goal with no Run is ready with three zero counts, complete:true and the same goalRef', async () => {
    const world = await openS8B1NoRunWorld();
    starting.push({ world: world.world, goal: world.goal, close: world.close });
    const answer = await postS8B1ChangeScope(world.world, world.world.scope, world.goal);
    expect(answer.httpStatus).toBe(200);
    const scope = changeScopeOfBody(answer.body);
    expect(scope.goalRef).toEqual(world.goal);
    expect(scope.files).toEqual([]);
    expect(scope.counts).toEqual({ files: 0, changed: 0, possible: 0 });
    expect(scope.complete).toBe(true);
  });

  it('B1-10 two goals of one project each read only their own files', async () => {
    const world = await openS8B1DefiniteWorld();
    definite.push(world);
    const first = changeScopeOfBody((await postS8B1ChangeScopeOn(world.host, AG2B_SCOPE, world.firstGoal)).body);
    const second = changeScopeOfBody((await postS8B1ChangeScopeOn(world.host, AG2B_SCOPE, world.secondGoal)).body);
    expect(pathsOf(first)).toContain(world.firstFile);
    expect(pathsOf(first)).not.toContain(world.secondFile);
    expect(pathsOf(second)).toContain(world.secondFile);
    expect(pathsOf(second)).not.toContain(world.firstFile);
  });

  it('B1-15 (R20) the second workspace reads its own Work Run file as second-mod; the main workspace is forbidden', async () => {
    const world = await openS8B1SecondWorkspaceWorld();
    second.push(world);
    const answer = await postS8B1ChangeScope(world.world.base.world, world.ws2Scope, world.goal);
    expect(answer.httpStatus).toBe(200);
    const scope = changeScopeOfBody(answer.body);
    expect(scope.files).toEqual(expect.arrayContaining([expect.objectContaining({
      path: world.filePath, certainty: 'definite',
      moduleRef: { projectId: world.ws2Scope.projectId, moduleId: world.moduleId },
    })]));
    const module = scope.modules.find(entry => (entry.moduleRef?.moduleId ?? entry.moduleId) === world.moduleId);
    expect(module).toMatchObject({ changed: 1 });

    const main = await postS8B1ChangeScope(world.world.base.world, world.ws1Scope, world.goal);
    expect(main.httpStatus).toBe(200);
    expect(main.body).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(JSON.stringify(main.body)).not.toContain(world.filePath);
  }, 180_000);
});
