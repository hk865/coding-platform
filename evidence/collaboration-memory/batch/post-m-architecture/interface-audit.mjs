import fs from 'node:fs';
import path from 'node:path';
import ts from '../../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
import { owner } from '../../../../scripts/module-map.mjs';

const skip = new Set(['node_modules', 'dist', '.vite', 'public']);
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (skip.has(entry.name)) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : /\.(?:ts|tsx|js)$/.test(file) ? [file.replaceAll('\\', '/')] : [];
  });
}
const files = walk('src');
const fileSet = new Set(files);
function resolve(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), `${base}/index.ts`].find(candidate => fileSet.has(candidate)) ?? null;
}
const imports = [], exportsByFile = {};
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const exported = [];
  for (const statement of ast.statements) {
    const modifiers = statement.modifiers ?? [];
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      const name = statement.name?.getText(ast);
      if (name) exported.push(name);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) exported.push(declaration.name.getText(ast));
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exported.push(element.name.text);
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const destination = resolve(file, statement.moduleSpecifier.text);
    if (!destination) continue;
    const fromOwner = owner(file), toOwner = owner(destination);
    if (fromOwner === toOwner) continue;
    const clause = statement.importClause;
    const symbols = [];
    if (clause?.name) symbols.push(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) symbols.push(element.propertyName?.text ?? element.name.text);
    imports.push({ consumer: file, consumerOwner: fromOwner, destination, destinationOwner: toOwner,
      line: ast.getLineAndCharacterOfPosition(statement.getStart()).line + 1,
      typeOnly: Boolean(clause?.isTypeOnly || clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every(element => element.isTypeOnly)), symbols });
  }
  exportsByFile[file] = [...new Set(exported)].sort();
}
const implementationCrossings = imports.filter(row => !['Contracts', 'Host', 'UI', 'Fixtures', 'TestDoubles', 'Storage'].includes(row.destinationOwner));
const testFixtureAdapters = new Set([
  'src/execution/worker-runtime/fake-runtime-adapter.ts',
  'src/execution/worker-runtime/read-only-query-adapter.ts',
  'src/execution/worker-runtime/context-continuation-adapter.ts',
  'src/execution/worker-runtime/handoff-control-adapter.ts',
  'src/execution/worker-runtime/lifecycle-control-adapter.ts',
  'src/data/workspace-reader/workspace-reader-adapter.ts',
]);
const explicitlyDocumentedSharedRules = new Set([
  'src/data/state-ledger/governance-records.ts',
  'src/control/control-engine/policies/role-binding-admission.ts',
  'src/control/control-engine/policies/coordination-policy.ts',
  'src/control/control-engine/policies/coordination-rules.ts',
  'src/control/control-engine/policies/goal-change-consistency.ts',
  'src/control/control-engine/policies/initial-plan-admission.ts',
  'src/control/control-engine/work-identity-resolution.ts',
]);
function dispositionFor(row) {
  const consumerOwners = [...new Set(row.consumers.map(consumer => consumer.owner))].sort();
  const consumerText = consumerOwners.join('、');
  const symbolText = row.symbols.length ? `（${row.symbols.join('、')}）` : '';
  if (consumerOwners.every(ownerName => ownerName === 'Fixtures')) {
    return {
      dispositionClass: 'test-fixture',
      disposition: `测试夹具：Fixtures 直接复用 ${row.owner} 的确定性记录转换${symbolText}来构造历史场景；该依赖不得进入产品组合根。`,
    };
  }
  if (testFixtureAdapters.has(row.destination)) {
    return {
      dispositionClass: 'test-fixture',
      disposition: `测试／样例能力：Host 只在明确 fixture 或 legacy sample 执行模式选择 ${row.symbols.join('、')}；产品组合必须显式注入真实或 unsupported 能力。`,
    };
  }
  if (consumerOwners.every(ownerName => ownerName === 'Host')) {
    return {
      dispositionClass: 'host-composition',
      disposition: `Host composition：应用组合根直接构造或连接 ${row.owner} 的 ${row.symbols.join('、')}；Host 只负责生命周期和接线，不复制该模块的准入或持久规则。`,
    };
  }
  if (explicitlyDocumentedSharedRules.has(row.destination)) {
    return {
      dispositionClass: 'formal-module-interface',
      disposition: `正式 Module interface：${row.owner} 明确对 ${consumerText} 提供共享只读／纯规则 ${symbolText}；这是防止规则分叉的声明依赖，调用方不得绕过 Control/Ledger 的最终复核。`,
    };
  }
  const hostAlsoConsumes = consumerOwners.includes('Host');
  return {
    dispositionClass: 'formal-module-interface',
    disposition: `正式 Module interface：${row.owner} 向 ${consumerText} 提供职责完整的能力 ${symbolText}${hostAlsoConsumes ? '；Host 同时负责该能力的组合与生命周期' : ''}。调用方消费结果，不接管其状态权威。`,
  };
}
const grouped = Object.values(implementationCrossings.reduce((result, row) => {
  const current = result[row.destination] ??= { destination: row.destination, owner: row.destinationOwner, consumers: [], symbols: new Set() };
  current.consumers.push({ file: row.consumer, owner: row.consumerOwner, line: row.line, typeOnly: row.typeOnly });
  row.symbols.forEach(symbol => current.symbols.add(symbol));
  return result;
}, {})).map(row => {
  const resolved = { ...row, symbols: [...row.symbols].sort(), declaredExports: exportsByFile[row.destination] ?? [] };
  return { ...resolved, ...dispositionFor(resolved) };
})
  .sort((a, b) => b.consumers.length - a.consumers.length || a.destination.localeCompare(b.destination));
const report = {
  generatedAt: new Date().toISOString(), files: files.length, crossOwnerImports: imports.length,
  implementationCrossingFiles: grouped.length,
  limitation: 'Observed static imports only. Dynamic lookup, runtime ordering, authorization, errors and performance require the behavior audit.',
  implementationCrossings: grouped,
  dispositionCounts: Object.fromEntries([...new Set(grouped.map(row => row.dispositionClass))].sort().map(kind => [kind, grouped.filter(row => row.dispositionClass === kind).length])),
  allCrossOwnerImports: imports,
};
fs.writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/interface-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ files: report.files, crossOwnerImports: report.crossOwnerImports, implementationCrossingFiles: report.implementationCrossingFiles,
  top: grouped.slice(0, 15).map(row => ({ file: row.destination, owner: row.owner, consumers: row.consumers.length, symbols: row.symbols })) }, null, 2));
