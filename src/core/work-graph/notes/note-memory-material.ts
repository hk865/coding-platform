/**
 * Slice 4C-2 U8 (spec §11.4/L20): the memory-material port. It is a thin
 * adapter over the read model's one `readMemoryMaterial` read (the caller picks
 * the parts). The null-goal branch is 6A's: a null goal is `unsupported` with
 * the reason `6A` and never builds material.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type {
  NoteMemoryMaterialInputV1, NoteMemoryMaterialPort, NoteMemoryMaterialV1,
} from '../model/note-contracts.js';
import type { createNoteReadModel } from './note-read-model.js';

export function createNoteMemoryMaterial(
  reads: Pick<ReturnType<typeof createNoteReadModel>, 'readMemoryMaterial'>,
): NoteMemoryMaterialPort {
  return {
    readMemoryMaterial(ctx: CoreCallContext, input: NoteMemoryMaterialInputV1):
    Promise<ReadResult<NoteMemoryMaterialV1>> {
      // §11.4/U8: 6A owns the goal-less assembly; never build a null-goal branch.
      if (input.goalId === null) return Promise.resolve({ status: 'rejected', code: 'unsupported', reason: '6A' });
      return reads.readMemoryMaterial(ctx, input);
    },
  };
}
