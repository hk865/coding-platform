/**
 * Slice 4C-2 U8 (spec §11.4/L20): the memory-material port. It is a thin
 * adapter over the read model's one `readMemoryMaterial` read (the caller picks
 * the parts). A null goal reads the project material; the read model owns that
 * branch, so the port never decides what a goal-less assembly contains.
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
      return reads.readMemoryMaterial(ctx, input);
    },
  };
}
