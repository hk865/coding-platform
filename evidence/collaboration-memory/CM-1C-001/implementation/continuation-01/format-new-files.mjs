import ts from '../../../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const files=execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(p=>/^(src|tests)\//.test(p)&&/\.tsx?$/.test(p));
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
for(const file of files){const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);writeFileSync(file,printer.printFile(source));}
console.log('Formatted '+files.length+' new TypeScript files');
