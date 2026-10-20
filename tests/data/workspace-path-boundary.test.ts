/**
 * RC-02 WorkspaceReader — 工作区**路径边界**的唯一权威。
 *
 * 覆盖在这一票里被定死的事：拒绝前缀只有 `denied-prefixes.ts` 一份，
 * 值是内核默认值 + 平台追加的并集（逐字核对）。
 */
import { expect, it } from 'vitest';
import { WORKSPACE_DENIED_PREFIXES } from '../../src/core/workspace/denied-prefixes.js';

it('拒绝前缀的唯一来源是内核默认值 + 平台追加，二者都逐字保留', () => {
  // 内核（vendor/coding-agent 的 WorkspaceSandbox）在调用方不传 deniedPrefixes 时用的三项；
  // 平台在此之上追加 .git／.env／.env.local／.platform-runtime。顺序不参与语义（内核会排序）。
  expect([...WORKSPACE_DENIED_PREFIXES].sort()).toEqual(
    ['.evaluator', '.oracle', 'hidden-tests', '.git', '.env', '.env.local', '.platform-runtime'].sort(),
  );
});
