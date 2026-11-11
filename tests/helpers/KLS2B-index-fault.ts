/**
 * KLS-2b index fault (A2): the platform option `knowledgeIndexFactory` (the SEAM-2B test seam) given a factory that
 * builds the REAL index (`createKnowledgeIndex`) and wraps it. Once `arm()` was called, the next `transaction` throws
 * before it runs its body; every other call, and every later transaction, goes to the real index as it is. The
 * wrapper returns no value of its own and writes no row: it only makes one named step fail. A row arms it after the
 * world's own writes (the adoption already runs an index transaction), right before the write it is about.
 */
import { createKnowledgeIndex } from '../../src/core/record-store/sqlite-knowledge-index.js';
import type { KnowledgeIndex } from '../../src/core/record-store/knowledge-index-ports.js';

export type KLS2BIndexFault = {
  /** The `knowledgeIndexFactory` platform option. */
  readonly factory: (projectId: string, path: string | null) => KnowledgeIndex;
  /** The next index transaction fails once. */
  arm(): void;
  /** How many transactions the fault failed. */
  failed(): number;
};

export function faultOnceIndexFactory(): KLS2BIndexFault {
  let armed = false;
  let failed = 0;
  const wrap = (real: KnowledgeIndex): KnowledgeIndex => new Proxy(real, {
    get(target, key, receiver) {
      if (key === 'transaction') {
        return <T>(body: Parameters<KnowledgeIndex['transaction']>[0]): T => {
          if (armed) {
            armed = false;
            failed += 1;
            throw new Error('KLS2B index fault: this index transaction fails');
          }
          return target.transaction(body) as T;
        };
      }
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return {
    factory: (projectId, path) => wrap(createKnowledgeIndex(projectId, path)),
    arm() { armed = true; },
    failed: () => failed,
  };
}
