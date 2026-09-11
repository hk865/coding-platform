import fs from 'node:fs';
const base='evidence/2026-09-11-architecture-convergence';
for(const [p,header] of [
['src/control/verification-engine/role-output-completeness.ts',`/**
 * Compare declarative role output expectations with attributed run material.
 * ContextCompiler owns canonical reads; this table owns category-to-witness mapping.
 * Missing outputs remain visible in roleOutputs and never gate completion.
 * Control alone reduces formal Plan obligations using admitted Evidence.
 * Decision provenance: ADR 0003, 2026-09-11 scoped user acceptance.
 */\n`],
['src/data/context-compiler/work-run-materials.ts',`/**
 * Compile work identity, role materials and authorized history before dispatch.
 * The result enters the existing bundle and manifest; it grants no permissions
 * and cannot satisfy formal evidence requirements. Each selection records its
 * source, version, reason and bounded omissions. Unavailable required material
 * stops before the model call; proven absence remains distinct from missing data.
 * WorkspaceReader owns source I/O; this module owns material selection and
 * rechecks canonical scope after I/O. Historical material is explanation only.
 */\n`]]){
 const s=fs.readFileSync(p,'utf8');fs.mkdirSync(base+'/source-comment-history',{recursive:true});fs.writeFileSync(base+'/source-comment-history/'+p.split('/').pop(),s);
 fs.writeFileSync(p,header+s.slice(s.indexOf('import ')));
}
