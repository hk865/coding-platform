const fs=require('node:fs');
const ts=require('../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const {parse,cleanup}=require('./control-contracts-migrate.cjs');
for(const name of fs.readdirSync('src/contracts/fixtures')){if(!name.endsWith('.ts'))continue;const file='src/contracts/fixtures/'+name,sf=parse(file);let text=sf.text;for(const s of [...sf.statements].reverse())if(ts.isExportDeclaration(s)&&s.moduleSpecifier?.text.includes('/control/'))text=text.slice(0,s.getFullStart())+text.slice(s.end);fs.writeFileSync(file,text);cleanup(file);}
// Stable references remain available from their contract owner to test samples.
fs.appendFileSync('src/contracts/fixtures/plan-fixtures.ts','\nexport { goalRefFor, planRevisionRefFor } from "../plan.js";\n');
