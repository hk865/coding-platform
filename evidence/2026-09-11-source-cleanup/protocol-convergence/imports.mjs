import fs from 'node:fs';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
import {edit,root,files} from './edit.mjs';
for(const file of [...files('src'),...files('tests')]) {
 if(!fs.existsSync(`${root}/history/${file}.txt`))continue;
 edit(file,body=>{
  const sf=ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true),used=new Set(),changes=[];
  function visit(node){if(ts.isImportDeclaration(node))return;if(ts.isIdentifier(node))used.add(node.text);ts.forEachChild(node,visit);}visit(sf);
  for(const node of sf.statements){if(!ts.isImportDeclaration(node)||!node.importClause)continue;
   const clause=node.importClause,binding=clause.namedBindings;
   if(binding&&ts.isNamedImports(binding)){
    const keep=binding.elements.filter(e=>used.has(e.name.text));
    if(keep.length===binding.elements.length)continue;
    if(!keep.length&&!clause.name)changes.push([node.getStart(sf),node.end,'']);
    else if(keep.length)changes.push([binding.getStart(sf),binding.end,`{ ${keep.map(e=>e.getText(sf)).join(', ')} }`]);
   }
  }
  for(const [start,end,text]of changes.sort((a,b)=>b[0]-a[0]))body=body.slice(0,start)+text+body.slice(end);
  return body;
 });
}
