/**
 * KLS-2b: the in-process knowledge write queue. One write holds its project
 * and every folder it may touch, so two projects on one checkout also write
 * one at a time inside this process. A write takes its place behind every
 * earlier write on each of its keys at the moment it is queued (in one
 * synchronous step), so writes run in queue order and never wait on each other
 * in a circle. The queue does not replace the records' CAS. A Host builds
 * exactly one.
 */
import type { KnowledgeWriteQueue } from '../model/line-knowledge.js';

export type { KnowledgeWriteQueue } from '../model/line-knowledge.js';

export function createKnowledgeWriteQueue(): KnowledgeWriteQueue {
  const tails = new Map<string, Promise<void>>();
  return {
    async run(projectId, folders, work) {
      const keys = [JSON.stringify(['project', projectId]),
        ...[...new Set(folders)].sort().map(folder => JSON.stringify(['folder', folder]))];
      let release!: () => void;
      const mine = new Promise<void>(resolve => { release = resolve; });
      const before = keys.map(key => tails.get(key) ?? Promise.resolve());
      for (const key of keys) tails.set(key, mine);
      try {
        await Promise.all(before);
        return await work();
      } finally {
        release();
        for (const key of keys) if (tails.get(key) === mine) tails.delete(key);
      }
    },
  };
}
