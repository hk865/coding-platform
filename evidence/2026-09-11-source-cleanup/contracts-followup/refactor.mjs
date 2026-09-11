import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';

const evidence = 'evidence/2026-09-11-source-cleanup/contracts-followup';
const source = 'src/contracts/validation.ts';
const original = fs.readFileSync(source, 'utf8');
const ast = ts.createSourceFile(source, original, ts.ScriptTarget.Latest, true);
const hash = body => crypto.createHash('sha256').update(body).digest('hex');
const baseline = JSON.parse(fs.readFileSync(`${evidence}/baseline.json`, 'utf8'));
const baselineFiles = new Map(baseline.roots.product.files.map(f => [f.path, f.sha256]));
function identifiers(node) { const names = new Set(); function visit(n) { if (ts.isIdentifier(n)) names.add(n.text); ts.forEachChild(n, visit); } visit(node); return names; }
const boundaries = [[121,'identity'],[147,'goal'],[196,'bootstrap'],[308,'event'],[546,'goal'],[566,'common'],[600,'governance'],[833,'plan'],[1032,'dispatch'],[1452,'evidence'],[1707,'handoff'],[2033,'workspace'],[2153,'integration'],[2329,'context'],[2646,'material-access'],[2816,'context'],[2883,'architecture'],[3170,'governance'],[3283,'role']];
const helpers = new Set(['UnknownRecord','isRecord','stringField','safePositiveIntField','validateStringArray','validateEnum','numberField','stringArrayField','rejectUnknownFields']);
const statements = ast.statements.filter(s => !ts.isImportDeclaration(s)).map(s => {
  const name = s.name?.text ?? (ts.isVariableStatement(s) ? s.declarationList.declarations[0].name.getText(ast) : undefined);
  if (!name) throw Error(`Unclassified statement: ${s.getText(ast).slice(0,80)}`);
  const line = ast.getLineAndCharacterOfPosition(s.getStart(ast)).line + 1;
  let group = 'common'; for (const [start, domain] of boundaries) if (line >= start) group = domain;
  if (helpers.has(name)) group = 'common';
  if (name === 'HANDOFF_PACKET_KEYS') group = 'handoff';
  if (name === 'WORK_CONTEXT_BIND_KEYS') group = 'context';
  if (name === 'INSPECTION_INTENT_KEYS') group = 'architecture';
  return { s, name, group, public: s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false, refs: identifiers(s) };
});
const byName = new Map(statements.map(s => [s.name, s]));
const groups = [...new Set(statements.map(s => s.group))];
const edges = [];
for (const s of statements) for (const name of s.refs) { const dep = byName.get(name); if (dep && dep.group !== s.group) { dep.shared = true; edges.push([s.group,dep.group,name]); } }
const imports = ast.statements.filter(ts.isImportDeclaration).flatMap(s => {
  if (!s.importClause?.namedBindings || !ts.isNamedImports(s.importClause.namedBindings)) throw Error('Unsupported import');
  return s.importClause.namedBindings.elements.map(n => ({ name:n.name.text, text:n.getText(ast), type:s.importClause.isTypeOnly, from:s.moduleSpecifier.text.replace(/^\.\//,'../') }));
});
const proposed = new Map();
for (const group of groups) {
  const members = statements.filter(s => s.group === group);
  const refs = new Set(members.flatMap(s => [...s.refs]));
  const external = imports.filter(i => refs.has(i.name)).map(i => `import ${i.type?'type ':''}{ ${i.text} } from '${i.from}';`);
  const dependencies = statements.filter(s => s.group !== group && refs.has(s.name));
  const internal = dependencies.map(s => `import ${ts.isTypeAliasDeclaration(s.s)?'type ':''}{ ${s.name} } from './${s.group}.js';`);
  const bodies = members.map(s => {
    let text = s.s.getFullText(ast).trim();
    // The old file's preamble belongs to its imports. Keep each declaration's
    // current rationale; phase headings are archived separately, not rewritten here.
    if (s.shared && !s.public) text = s.s.getFullText(ast).slice(0, s.s.getStart(ast)-s.s.getFullStart()).trim() + '\nexport ' + s.s.getText(ast);
    return text.replace(/import\((['"])\.\//g, 'import($1../')
      .replace(/^\/\/.*(?:P1-\d+ validators|P1-\d+ .*validators|frozen baseline).*\r?\n/gm,'')
      .replace(/^\/\/ [─━═─\-]+.*\r?\n/gm,'')
      .replace('P1-03 decision (integrator ruling on lane-B gap 1): the fact carries its','The fact carries its')
      .replace('P1-03 decision (integrator ruling on lane-C gap 1): the context request is','The context request is')
      .replace('Run or QueryRun principal (P1-09 QueryRun retains its own full identity).','Run or QueryRun principal; QueryRun retains its own full identity.');
  });
  proposed.set(`src/contracts/validation/${group}.ts`, `/** ${group === 'common' ? 'Shared structural primitives; internal to protocol validators.' : `${group} protocol schema validation. Structural checks do not grant authority.`} */\n${[...new Set([...external,...internal])].join('\n')}\n\n${bodies.join('\n\n')}\n`);
}
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => ['node_modules','dist','.git','public','.local'].includes(e.name)?[]:e.isDirectory()?walk(`${dir}/${e.name}`):/\.(ts|tsx|mjs)$/.test(e.name)?[`${dir}/${e.name}`]:[]); }
const consumers = [];
for (const file of [...walk('src'),...walk('tests'),...walk('scripts')]) {
  if (file === source) continue;
  const text = fs.readFileSync(file,'utf8'), tree = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const edits = [];
  for (const s of tree.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file),s.moduleSpecifier.text));
    if (target !== source.replace(/\.ts$/,'.js')) continue;
    if (!s.importClause?.namedBindings || !ts.isNamedImports(s.importClause.namedBindings)) throw Error(`Namespace/default import: ${file}`);
    const buckets = new Map();
    for (const n of s.importClause.namedBindings.elements) {
      const entry = byName.get(n.propertyName?.text ?? n.name.text); if (!entry) throw Error(`Unknown export ${n.getText(tree)}`);
      const dest = s.moduleSpecifier.text.replace(/validation\.js$/,`validation/${entry.group}.js`);
      const list = buckets.get(dest) ?? []; list.push(n.getText(tree)); buckets.set(dest,list);
    }
    edits.push({start:s.getStart(tree),end:s.end,text:[...buckets].map(([dest,names])=>`import ${s.importClause.isTypeOnly?'type ':''}{ ${names.join(', ')} } from '${dest}';`).join('\n')});
  }
  if (edits.length) { let body = text; for (const e of edits.reverse()) body = body.slice(0,e.start)+e.text+body.slice(e.end); proposed.set(file,body); consumers.push(file); }
}
const report = {groups:groups.map(group=>({group,declarations:statements.filter(s=>s.group===group).map(s=>s.name)})),edges:[...new Map(edges.map(e=>[e.join('|'),e])).values()],consumers,changes:[...proposed.keys()],removed:[source]};
fs.writeFileSync(`${evidence}/validation-plan.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({groups,consumers:consumers.length,edges:report.edges.filter(e=>e[1]!=='common')}));
if (process.argv.includes('--apply')) {
  for (const file of [source,...proposed.keys()]) {
    if (fs.existsSync(file) && hash(fs.readFileSync(file)) !== baselineFiles.get(file)) throw Error(`Concurrent/unexpected change: ${file}`);
  }
  for (const file of [source,...proposed.keys()]) if (fs.existsSync(file)) { const dest=`${evidence}/history/${file}.txt`; fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,fs.readFileSync(file),{flag:'wx'}); }
  for (const [file,body] of proposed) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(`${file}.cleanup-tmp`,body,{flag:'wx'}); fs.renameSync(`${file}.cleanup-tmp`,file); }
  fs.unlinkSync(source);
  fs.writeFileSync(`${evidence}/validation-map.json`,JSON.stringify(statements.map(s=>({name:s.name,group:s.group,public:s.public,shared:!!s.shared})),null,2));
}
