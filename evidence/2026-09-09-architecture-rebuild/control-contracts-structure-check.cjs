const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
const ts=require('../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const {parse}=require('./control-contracts-migrate.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const before=cp.execFileSync('git',['show','HEAD:src/contracts/reduction.ts'],{encoding:'utf8'}),after=fs.readFileSync('src/control/policies/task-reduction.ts','utf8');
const get=text=>parse('reduction.ts',text).statements.find(s=>ts.isFunctionDeclaration(s)&&s.name.text==='reduceTaskVerification').getText();
const original=get(before),moved=get(after);
if(original!==moved)throw Error('Task reduction function bytes changed');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(dir+'/'+d.name):d.name.endsWith('.ts')?[dir+'/'+d.name]:[]);}
const violations=[];
for(const file of [...walk('src/contracts'),...walk('src/control/records'),...walk('src/control/policies')]){
 const sf=parse(file);for(const s of sf.statements){if(!ts.isImportDeclaration(s)&&!ts.isExportDeclaration(s))continue;const module=s.moduleSpecifier?.text??'';
 if(file.startsWith('src/contracts/')&&!file.includes('/fixtures/')&&!file.includes('/testing/')&&(module.includes('/control/')||module.includes('/verification/')||module.includes('/runtime/')||module.includes('/data/')))violations.push({file,module,reason:'contract points to implementation'});
 if(file.startsWith('src/contracts/')&&ts.isExportDeclaration(s)&&module.includes('/control/'))violations.push({file,module,reason:'reverse Control export'});
 if((file.startsWith('src/control/records/')||file.startsWith('src/control/policies/')||file.startsWith('src/contracts/commands/'))&&module.includes('/fixtures/'))violations.push({file,module,reason:'production implementation imports fixture'});
 }
}
const report={taskReduction:{unchanged:true,functionSha256:sha(original),nulBefore:[...original].filter(c=>c==='\0').length,nulAfter:[...moved].filter(c=>c==='\0').length},violations,recordFiles:walk('src/control/records'),policyFiles:walk('src/control/policies'),commandFiles:walk('src/contracts/commands')};
fs.writeFileSync('evidence/2026-09-09-architecture-rebuild/control-contracts-structure.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(violations.length)process.exitCode=1;
