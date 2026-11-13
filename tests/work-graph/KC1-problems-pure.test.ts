/**
 * KC-1 owner rows the acceptance table does not cover: the index-only verdicts `unreachable`
 * and `partial_contains` (ruling 4-6, draft §2.3-2). Pure table (A5): bytes in, places out.
 *
 * Named mutations (each must turn its own row red):
 * - add `other` to architecture.json's `modules` -> the unreachable row is gone;
 * - write `contains` on `other` too -> the partial_contains row is gone.
 */
import { describe, expect, it } from 'vitest';
import { knowledgeProblemsOf } from '../../src/core/work-graph/architecture/architecture-file.js';

const bytesOf = (value: unknown): Uint8Array => Buffer.from(JSON.stringify(value), 'utf8');
const scope = { workspaceId: 'ws', mainWorkspaceId: 'ws' };
const moduleFile = (id: string, extra: { contains?: string[] } = {}): Uint8Array => bytesOf({
  id, name: id, responsibility: `${id} module`, paths: [`src/${id}`], interfaces: [], dependsOn: [], ...extra,
});
const architectureFile = (modules: string[]): Uint8Array => bytesOf({
  modules, crossWorkspace: { dependsOn: [], contains: [] },
});

describe('KC-1 knowledge problems from the index alone', () => {
  it('names an unreachable module file once', () => {
    expect(knowledgeProblemsOf({
      architecture: architectureFile(['core']),
      modules: [
        { path: '.workbench/modules/core.json', bytes: moduleFile('core') },
        { path: '.workbench/modules/other.json', bytes: moduleFile('other') },
      ],
      fileIssues: [], graphReason: null, projectReason: null, scope,
    })).toEqual([{
      kind: 'unreachable', paths: ['.workbench/modules/other.json'], moduleIds: ['other'],
      reason: '模块 other 从 architecture.json 的 modules 走不到：放进 modules，或放进某个模块的 contains',
    }]);
  });

  it('names the module files that leave contains out when another writes it', () => {
    expect(knowledgeProblemsOf({
      architecture: architectureFile(['core']),
      modules: [
        { path: '.workbench/modules/core.json', bytes: moduleFile('core', { contains: ['other'] }) },
        { path: '.workbench/modules/other.json', bytes: moduleFile('other') },
      ],
      fileIssues: [], graphReason: null, projectReason: null, scope,
    })).toEqual([{
      kind: 'partial_contains', paths: ['.workbench/modules/other.json'], moduleIds: ['other'],
      reason: '有的模块文件写了 contains、有的没写（没写的：other）：要么都写，要么都不写',
    }]);
  });
});
