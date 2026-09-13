import type { StateLedger, VersionedRef, GoalSnapshot } from '../../contracts/ledger.js';
import type { MemoryLedgerPort, MemoryCommand, MemoryReceipt, LocalProfileResult } from '../../contracts/memory.js';
import { foldMemory, validMemoryCommand, memoryGovernanceWitness,validMemoryGovernanceWitness } from '../../contracts/memory-values.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { executionNoteRefFor, workMemoryNoteId, type ExecutionNoteSnapshot } from '../../contracts/context-continuity.js';

/** The sole transition authority for explicitly maintained small memories.
 * Storage scope is independent of execution identity; this never creates work. */
export class MemoryControlEngine {
  constructor(private readonly deps: { memory: MemoryLedgerPort; ledger: Pick<StateLedger,'load'>;
    copySource?: (source: Extract<import('../../contracts/memory.js').MemorySource,{kind:'copy'}>, content:string) => Promise<boolean> }) {}
  initializeProfile(proposedId:string):Promise<LocalProfileResult> { return this.deps.memory.initializeProfile(proposedId); }
  async maintain(command:MemoryCommand):Promise<MemoryReceipt> {
    if(!validMemoryCommand(command)) return {status:'rejected',code:'invalid',reason:'Invalid memory request'};
    if(command.actor.kind!=='human') return {status:'rejected',code:'forbidden',reason:'Memory maintenance requires an explicit human request'};
    try {
      const replay=await this.deps.memory.lookup(command);if(replay)return replay;
      const current=await this.deps.memory.read(command.scope);
      if(current.status!=='ready') return {status:'rejected',code:'unavailable',reason:current.reason};
      const guards:VersionedRef[]=[];
      if(command.scope.kind==='project') {
        const ref={aggregateType:'Project' as const,projectId:command.scope.projectId}, project=await this.deps.ledger.load(ref);
        if(project.status!=='found')return {status:'rejected',code:'forbidden',reason:'Unknown project'};
        guards.push({ref,revision:project.snapshot.revision});
      }
      for(const edit of command.edits) {
        if(edit.operation==='remove')continue;
        const source=edit.source;
        if(source.kind==='human')continue;
        if(source.kind==='copy') {
          if(command.scope.kind!=='project' || source.scope.kind!=='project' || source.scope.projectId===command.scope.projectId ||
            !await this.deps.copySource?.(source,edit.content)) return {status:'rejected',code:'forbidden',reason:'Selected source revision is not authorized or current'};
          continue;
        }
        if(command.scope.kind!=='project' || source.ref.projectId!==command.scope.projectId)return {status:'rejected',code:'forbidden',reason:'Work experience belongs to its project'};
        const loaded=await this.deps.ledger.load(source.ref);
        if(loaded.status!=='found' || loaded.snapshot.ref.aggregateType!=='ExecutionNote')return {status:'rejected',code:'not_found',reason:'Public work note is unavailable'};
        const note=(loaded.snapshot as ExecutionNoteSnapshot).note;
        if(!validMemoryGovernanceWitness(note.memoryGovernance)||note.memoryGovernance.digest!==memoryGovernanceWitness(source.governance).digest)
          return {status:'rejected',code:'forbidden',reason:'Original work-note governance basis is unknown or different'};
        if(note.bodyRef.digest!==source.noteDigest || (note.memory?.revision??null)!==source.memoryRevision ||
          note.applicableVersions.workspaceRevision!==source.workspaceRevision || note.applicableVersions.planRevision!==source.planRevision ||
          note.verification.status==='contradicted' || note.memory?.state==='retired')return {status:'rejected',code:'forbidden',reason:'Work note is no longer applicable'};
        guards.push({ref:source.ref,revision:loaded.snapshot.revision});
        const workspaceRef={aggregateType:'Workspace' as const,projectId:source.ref.projectId,workspaceId:source.ref.workspaceId};
        const workspace=await this.deps.ledger.load(workspaceRef);
        if(workspace.status!=='found' || workspace.snapshot.revision!==source.workspaceRevision)return {status:'rejected',code:'forbidden',reason:'Work note source revision changed'};
        guards.push({ref:workspaceRef,revision:workspace.snapshot.revision});
        const goalRef={aggregateType:'Goal' as const,projectId:note.projectId,goalId:note.runRef.goalId};
        const goal=await this.deps.ledger.load(goalRef);
        if(goal.status!=='found'||canonicalJson((goal.snapshot as GoalSnapshot).activePlanRevision)!==canonicalJson(note.applicableVersions.planRef))
          return {status:'rejected',code:'forbidden',reason:'Work note plan is no longer current'};
        guards.push({ref:goalRef,revision:goal.snapshot.revision});
        for(const pin of source.governance){
          const ref={aggregateType:pin.kind,projectId:source.ref.projectId},current=await this.deps.ledger.load(ref);
          if((current.status==='found'?current.snapshot.revision:0)!==pin.revision)return {status:'rejected',code:'forbidden',reason:'Formal governance changed before memory import'};
          guards.push({ref,revision:pin.revision});
        }
        if(note.memory) {
          const next=executionNoteRefFor(note.projectId,note.workspaceId,note.workId,workMemoryNoteId(note.memory.key,note.memory.revision+1));
          if((await this.deps.ledger.load(next)).status!=='not_found')return {status:'rejected',code:'forbidden',reason:'A newer work-memory version exists'};
          guards.push({ref:next,revision:0});
        }
      }
      const folded=foldMemory(current.snapshot,command,this.deps.memory.limits);if(folded.status==='rejected')return folded;
      const unique=[...new Map(guards.map(guard=>[canonicalJson(guard.ref),guard])).values()];
      return this.deps.memory.commit({command,snapshot:folded.snapshot,audit:folded.audit,entryIds:folded.entryIds,changed:folded.changed,guards:unique});
    } catch {return {status:'rejected',code:'unavailable',reason:'Memory maintenance failed; no save confirmation is available'};}
  }
}
