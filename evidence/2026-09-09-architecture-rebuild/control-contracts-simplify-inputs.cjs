const fs=require('node:fs');
const ts=require('../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const {parse}=require('./control-contracts-migrate.cjs');
for(const name of fs.readdirSync('src/contracts/commands')){
 if(!name.endsWith('.ts'))continue;const file='src/contracts/commands/'+name,sf=parse(file),edits=[];
 const visit=n=>{if(ts.isParameter(n)&&n.type&&ts.isIntersectionTypeNode(n.type)&&n.type.types.length===2&&ts.isTypeReferenceNode(n.type.types[1])&&n.type.types[1].typeName.getText(sf)==='Required'){
  const base=n.type.types[0];let text=(ts.isParenthesizedTypeNode(base)?base.type:base).getText(sf);text=text.replace(/\?\s*:/g,':');edits.push([n.type.getStart(sf),n.type.end,text]);return;
 }
 if(ts.isPropertySignature(n)&&n.questionToken){if(name==='architecture.ts'&&n.name.getText(sf)==='projectId'){edits.push([n.getFullStart(),n.end,'']);return;}edits.push([n.questionToken.getStart(sf),n.questionToken.end,'']);}
 ts.forEachChild(n,visit);};visit(sf);
 let text=sf.text;for(const[a,b,v]of edits.sort((a,b)=>b[0]-a[0]))text=text.slice(0,a)+v+text.slice(b);fs.writeFileSync(file,text);
}
