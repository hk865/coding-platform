import type { MemoryCommand, MemoryEdit, MemoryScope, MemoryReceipt } from '../../contracts/memory.js';

export type HumanMemoryRequest = { scope: MemoryScope; requestId: string; expectedRevision: number; edits: MemoryEdit[];requestDigest?:string };
/** Explicit maintenance is a human action, separate from read-only Query tools. */
export class HumanMemory {
  constructor(private readonly deps: { control: { maintain(command:MemoryCommand):Promise<MemoryReceipt> }; now:()=>string; actorId:string }) {}
  maintain(request:HumanMemoryRequest):Promise<MemoryReceipt> {
    return this.deps.control.maintain({schemaVersion:1,commandId:request.requestId,scope:request.scope,actor:{kind:'human',id:this.deps.actorId},
      idempotencyKey:request.requestId,expectedRevision:request.expectedRevision,submittedAt:this.deps.now(),edits:request.edits,
      ...(request.requestDigest===undefined?{}:{requestDigest:request.requestDigest})});
  }
}
