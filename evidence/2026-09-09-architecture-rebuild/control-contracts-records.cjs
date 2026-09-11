const fs=require('node:fs');
const {move,migrations}=require('./control-contracts-migrate.cjs');
const mapPath='evidence/2026-09-09-architecture-rebuild/control-contracts-mapping.json';
const previous=JSON.parse(fs.readFileSync(mapPath,'utf8'));
const audit=fs.readFileSync('D:/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-architecture-rebuild/module-audit.md','utf8');
const groups=new Map();
for(const line of audit.split('\n')) {
 const m=line.match(/`(src\/contracts\/fixtures\/[^:]+):[^`]+`<br>`([^`]+)` \| (.+?) \|/);
 if(!m || !(m[3].startsWith('正式 fold/snapshot') || m[2]==='buildP113TaskAdvanceCommit'))continue;
 const syms=groups.get(m[1])??[];syms.push(m[2]);groups.set(m[1],syms);
}
for(const [source,syms]of groups){const dest=source.replace('contracts/fixtures','control/records').replace('-fixtures.ts','.ts'); console.log(source,move(source,dest,syms,{fixture:true,includeExported:true,includeTypes:true,includeVariables:false}));}
fs.writeFileSync(mapPath,JSON.stringify([...previous,...migrations],null,2)+'\n');
