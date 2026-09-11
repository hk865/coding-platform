import fs from 'node:fs';
import path from 'node:path';
import ts from '../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const root='evidence/2026-09-11-source-cleanup';
function put(file,body){const h=root+'/history/'+file+'.txt';if(!fs.existsSync(h)){fs.mkdirSync(path.dirname(h),{recursive:true});fs.copyFileSync(file,h);}fs.writeFileSync(file+'.cleanup-tmp',body,{flag:'wx'});fs.renameSync(file+'.cleanup-tmp',file);}
const headers={
 'src/contracts/dispatch.ts':`Run identities, role-binding references and observed runtime facts.
Run completion never sets Task phase. Control admits claims, starts and facts;
monotonic per-run sequences reject duplicate/stale/conflicting facts without writes.
The role-spec and admission protocols resolve the referenced role and permissions.`,
 'src/contracts/plan.ts':`Versioned tasks, assignments, obligations and acceptance commands.
Control checks schema, references, non-empty obligations and hierarchy/DAG legality
before atomically accepting a revision; rejected commands do not write.
Task hierarchy, execution dependencies and display stages have distinct meanings.`,
 'src/contracts/verification.ts':`Verification plans and observation drafts for tool and reviewer requirements.
Compilation is a pure function of the exact task, workspace, baseline, policy,
change scope, risks and available checks. Missing pins/coverage reject without defaults.
Reviewer requirements use review packets unless the versioned policy explicitly
allows a mechanical no-change proof. Reviewer work runs through formal dispatch;
the capability port alone does not perform a review. Control admits Evidence and
reduces formal Task/Goal state; a ready verification result is not completion.`,
 'src/contracts/goal-change.ts':`Bounded goal amendments, plan proposals, patches, impact and decision records.
PlanCompiler proposes; Control accepts against canonical scope and revision.
Affected work retains explicit refresh/recompute information. Accepting a new
PlanRevision preserves earlier plans, evidence and unresolved obligations.
Decision authority and required non-empty obligations remain admission constraints.`,
 'src/control/verification-engine/verification-engine.ts':`VerificationPort implementation over canonical Context material and explicit providers.
The pure verification-plan compiler fixes requirement coverage and content identity.
Static/dynamic checks execute through injected CheckPorts; reviewer requirements
produce review-packet or policy-authorized fast-path entries. Production command
checks and deterministic test providers share this engine. Observations remain
drafts until Control admits Evidence; this engine never writes the ledger.`,
 'src/control/dispatch-engine/dispatch-engine.ts':`Ordinary outbox dispatch: assemble bounded Context, bind/link durable work,
commit Control.startRun, then call the runtime and submit observed facts.
The dispatch intent must exist before side effects. Rejections do not create a
new attempt; failures remain visible. Replacement dispatch has its own consumer.
Unknown runtime effects must be reconciled and cannot be repaired by blind retry.`,
 'src/data/context-compiler/context-compiler.ts':`Compile a bounded TaskEnvelope from canonical task, plan and workspace material.
Scope must fit declared permissions; budgets and workspace revisions are checked.
Control.startRun owns final role-binding/version admission. The bundle body is
stored before returning ready; missing material is explicit. Context assembly
neither starts an Agent nor grants permissions or satisfies formal obligations.`,
 'src/data/context-compiler/planning-context-compiler.ts':`Compile bounded planning material without starting a model.
Validate the request and delegate TaskContext assembly and permission checks to
the task compiler. Preserve manifest provenance and needs_material; map rejection
codes to the planning protocol. The result is material for proposal construction.`,
 'src/harness/in-memory-harness.ts':`Compose the real modules over an isolated in-memory ledger, vault and projection.
Runtime/check/reviewer defaults are explicit test capabilities; callers can inject
real adapters. The harness adapts protocols and projection timing, never business
admission rules. Each driveQuery call retains its original fresh engine lifetime.`,
 'src/harness/persistent-harness.ts':`Compose the real modules over SQLite with explicit overridable runtime capabilities.
Restart closes resources and creates new instances on the same ledger/read-model
files; no in-process state carries over. The read model is always an event
projection and can be rebuilt; it is never the canonical state authority.
Query dispatch retains one engine per harness instance.`,
};
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+'/'+e.name):e.name.endsWith('.ts')?[d+'/'+e.name]:[]);
const files=[...walk('src/contracts'),...walk('src/control/plan-compiler'),...walk('src/control/dispatch-engine'),...walk('src/control/verification-engine'),...walk('src/data/context-compiler'),...walk('src/harness'),'src/app/service.ts'];
const changed=[];
for(const f of files){const before=fs.readFileSync(f,'utf8');let s=before;
 if(headers[f])s=s.replace(/\/\*\*[\s\S]*?\*\//,'/**\n * '+headers[f].replaceAll('\n','\n * ')+'\n */');
 // Remove historical ticket labels only from actual comments, retaining rules and risks.
 const a=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true), ranges=new Map();
 function visit(n){for(const c of [...(ts.getLeadingCommentRanges(s,n.pos)??[]),...(ts.getTrailingCommentRanges(s,n.end)??[])])ranges.set(c.pos,c);ts.forEachChild(n,visit);}visit(a);
 for(const c of [...ranges.values()].sort((a,b)=>b.pos-a.pos)){let comment=s.slice(c.pos,c.end);comment=comment.replace(/\b(?:P1-\d{2}|RW-\d{2}|RC-\d{2})\s*[:：]\s*/g,'').replaceAll('FROZEN semantics:', 'Semantics:').replaceAll('default stub until the lane lands','default implementation').replaceAll('default PlanCompilerImpl stub','default PlanCompilerImpl').replaceAll('default PlanningContextCompilerImpl stub','default PlanningContextCompilerImpl');s=s.slice(0,c.pos)+comment+s.slice(c.end);}
 if(f==='src/control/plan-compiler/rework-proposal.ts')s=s.replace(/\/\*\*\s*\n \* 为什么必须重指[\s\S]*?\*\//,'/** Control derives task/DAG rewiring and checks the same result during acceptance. */');
 if(f==='src/data/context-compiler/work-run-materials.ts'){
  const start=s.indexOf('/** 本编译器能供应'),end=s.indexOf('export type RoleMaterialChannelV1',start);
  if(start>=0&&end>start)s=s.slice(0,start)+`/** Channels supplied by this compiler; role requirements use a separate vocabulary. */
export type WorkRunMaterialKind = 'work-identity' | 'work-notes' | 'history' | 'contract' | 'code' | 'evidence' | 'decision';

/** Exhaustive mapping from role requirements to source channels. A null channel
 * fails closed when required. Each available channel still verifies material,
 * source and authorization; a declared channel is not proof of satisfaction. */
`+s.slice(end);
 }
 if(s!==before){put(f,s);changed.push(f);}
}
fs.writeFileSync(root+'/comment-files.json',JSON.stringify(changed,null,2));
console.log('Updated current comments in '+changed.length+' files; originals retained.');
