import { createHash } from 'node:crypto';
import type { VerificationScope as Scope, Benchmark } from '../../contracts/verification-import.js';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw Error(message);
}
export function object(value: unknown): Record<string, unknown> {
  ensure(value && typeof value === 'object' && !Array.isArray(value), '需要结构化验收对象');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, cap = 2048): string {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= cap, '无效字段：' + label);
  return value;
}
export function sha(value: unknown, label: string) {
  const s = text(value, label, 64);
  ensure(/^[a-f0-9]{64}$/.test(s), '无效摘要：' + label);
  return s;
}
export function testNames(value: unknown, label: string): string[] {
  ensure(Array.isArray(value) && value.length <= 20000, '无效用例集合：' + label);
  const names = value.map(n => text(n, label, 2048));
  ensure(new Set(names).size === names.length, '指定用例集合包含重复名称');
  return names;
}
export function benchmark(value: unknown): Benchmark {
  const b = object(value);
  const result = {
    instanceId: text(b['instanceId'], 'instanceId'),
    datasetRevision: text(b['datasetRevision'], 'datasetRevision'),
    failToPass: testNames(b['failToPass'], 'failToPass'),
    passToPass: testNames(b['passToPass'], 'passToPass')
  };
  ensure(result.failToPass.length + result.passToPass.length > 0, '验收指定集合不能为空');
  ensure(!result.failToPass.some(n => result.passToPass.includes(n)), '两组指定集合不能重叠');
  return result;
}
export function time(value: unknown, label: string) {
  const s = text(value, label, 64);
  ensure(Number.isFinite(Date.parse(s)), '无效时间：' + label);
  return new Date(s).toISOString();
}
export function changedPaths(patch: string): string[] {
  const paths = [...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].flatMap(m => [m[1]!, m[2]!]);
  ensure(paths.length > 0 && paths.length <= 512, '需要有界的 Git 文本补丁');
  ensure(paths.every(p => p.length < 1024 && !p.includes('..') && !p.includes('\\') && !p.startsWith('/') && !p.startsWith('.') && !p.includes('\0')), '补丁包含非法路径');
  ensure(!patch.includes('GIT binary patch') && !/^.*mode 120000$/m.test(patch), '当前验收登记只接受普通文本文件补丁');
  return [...new Set(paths)];
}
export function vScope(value: Scope): Scope {
  return {
    projectId: value.projectId,
    workspaceId: value.workspaceId,
    goalId: value.goalId,
    runId: value.runId
  };
}
