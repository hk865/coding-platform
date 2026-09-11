import fs from 'node:fs';
import ts from '../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
function edit(file, changes, format=false) {
 let source=fs.readFileSync(file,'utf8');
 for(const [old,replacement]of changes){if(!source.includes(old))throw Error(file+': missing '+old);source=source.replace(old,replacement);}
 if(format)source=ts.createPrinter({newLine:ts.NewLineKind.LineFeed}).printFile(ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true));
 fs.writeFileSync(file,source);
}
edit('src/control/operator-plan-compiler.ts',[
 ["{ projectId: scope.projectId, commandId: 'exploration-plan-'", "{ projectId: scope.projectId, goalId: scope.goalId, actor: { kind: 'human', id: 'user-1' }, commandId: 'exploration-plan-'"],
 ["{ ...this.identity(scope.projectId, `real-plan-${goalId}`), expectedRevision:","{ ...this.identity(scope.projectId, `real-plan-${goalId}`), goalId, expectedRevision:"],
 ["return { projectId, idempotencyKey, commandId:","return { projectId, actor: { kind: 'human' as const, id: 'user-1' }, idempotencyKey, commandId:"]
],true);
edit('src/control/architecture-reconciler.ts',[
 ["{commandId:intent.inspectionId+'-rec-inspection',submittedAt:at}","this.commandIdentity(intent.inspectionId+'-rec-inspection', at)"],
 ["{commandId:finding.findingId+'-rec-finding',submittedAt:at}","this.commandIdentity(finding.findingId+'-rec-finding', at)"],
 ["{commandId:brief.briefId+'-rec-brief',submittedAt:at}","this.commandIdentity(brief.briefId+'-rec-brief', at)"],
 ["  private async store(","  private commandIdentity(commandId: string, submittedAt: string) { return { commandId, submittedAt, actor: { kind: 'system' as const, id: 'architecture-reconciler' }, idempotencyKey: commandId + '-idem', correlationId: commandId + '-corr' }; }\n  private async store("]
],true);
