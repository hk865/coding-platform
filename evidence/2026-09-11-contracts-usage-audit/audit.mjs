#!/usr/bin/env node
/**
 * 契约使用审计（2026-09-11）。
 *
 * 回答一个问题：src/contracts 里的每条导出声明，是否都能在其它源码中找到读者？
 *
 * 口径：
 *   A  src/contracts 之外的源码直接导入
 *   B  仅被其它契约文件导入
 *   C  仅被 tests/ 或 scripts/ 导入
 *   D  无任何导入，但声明文件内部自己读（export 关键字多余）
 *   E  无任何导入，且声明文件内部也不读（定义没有读者）
 *
 * 只做静态分析，不写文件、不改源码、不调用模型。
 *
 *   node evidence/2026-09-11-contracts-usage-audit/audit.mjs
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CONTRACTS_DIR = path.join(root, "src", "contracts");
const SCAN_DIRS = ["src", "tests", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".pnpm-store", "test-results", ".vite"]);

const TEXT_EXT = /\.(ts|tsx)$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (TEXT_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = SCAN_DIRS.filter((d) => fs.existsSync(d)).flatMap((d) => walk(path.join(root, d)));
const isContract = (file) => path.relative(root, file).startsWith("src/contracts/");
const contractFiles = allFiles.filter((f) => isContract(f));

/** Resolve a relative module specifier to its .ts source (NodeNext ".js" specifiers included). */
function resolveSpec(spec, fromFile) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = base.endsWith(".js")
    ? [base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx"]
    : [base + ".ts", base + ".tsx", path.join(base, "index.ts")];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

const sourceFileOf = (file, src) =>
  ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Exported declaration names of one contract file, with line number and declaration span. */
function exportedDeclarations(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = sourceFileOf(file, src);
  const found = [];
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    let name = null;
    if (ts.isVariableStatement(st)) {
      const first = st.declarationList.declarations[0];
      if (first && ts.isIdentifier(first.name)) name = first.name.text;
    } else if (st.name && ts.isIdentifier(st.name)) {
      name = st.name.text;
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        found.push({ name: el.name.text, line: lineOf(sf, st), text: textOf(src, st) });
      }
      continue;
    }
    if (name) found.push({ name, line: lineOf(sf, st), text: textOf(src, st) });
  }
  return found;
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const textOf = (src, node) => src.slice(node.getStart(), node.getEnd());

/** Every import reference pointing at a contract file: "contractRel::exportName" -> Set(consumerRel). */
function collectImporters() {
  const importers = new Map();
  const mark = (contractFile, name, consumerFile) => {
    const contractRel = path.relative(root, contractFile);
    const consumerRel = path.relative(root, consumerFile);
    if (contractRel === consumerRel) return;
    const key = `${contractRel}::${name}`;
    if (!importers.has(key)) importers.set(key, new Set());
    importers.get(key).add(consumerRel);
  };
  for (const file of allFiles) {
    const src = fs.readFileSync(file, "utf8");
    const sf = sourceFileOf(file, src);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveSpec(node.moduleSpecifier.text, file);
        if (target && isContract(target) && node.importClause) {
          const clause = node.importClause;
          if (clause.name) mark(target, "default", file);
          const bindings = clause.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) mark(target, el.propertyName ? el.propertyName.text : el.name.text, file);
          } else if (bindings && ts.isNamespaceImport(bindings)) {
            mark(target, "*", file);
          }
        }
      }
      // inline `import("...").Name` type references
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        const target = resolveSpec(node.argument.literal.text, file);
        if (target && isContract(target) && node.qualifier) {
          mark(target, ts.entityNameToString(node.qualifier).split(".").pop(), file);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return importers;
}

/** Identifiers in the declaring file that actually read the name (not the declaration name itself). */
function selfReads(file, name) {
  const src = fs.readFileSync(file, "utf8");
  const sf = sourceFileOf(file, src);
  let reads = 0;
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === name) {
      const p = node.parent;
      const isDeclarationName =
        (ts.isVariableDeclaration(p) ||
          ts.isTypeAliasDeclaration(p) ||
          ts.isInterfaceDeclaration(p) ||
          ts.isFunctionDeclaration(p) ||
          ts.isClassDeclaration(p) ||
          ts.isEnumDeclaration(p) ||
          ts.isImportSpecifier(p) ||
          ts.isExportSpecifier(p)) &&
        p.name === node;
      if (!isDeclarationName) reads += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return reads;
}

const importers = collectImporters();
const buckets = { A: [], B: [], C: [], D: [], E: [] };

for (const file of contractFiles) {
  const contractRel = path.relative(root, file);
  for (const decl of exportedDeclarations(file)) {
    const consumers = [...(importers.get(`${contractRel}::${decl.name}`) ?? [])];
    const external = consumers.filter((c) => !c.startsWith("src/contracts/"));
    const srcSide = external.filter((c) => !c.startsWith("tests/") && !c.startsWith("scripts/"));
    const internal = consumers.filter((c) => c.startsWith("src/contracts/"));
    const testSide = external.filter((c) => c.startsWith("tests/") || c.startsWith("scripts/"));
    const reads = selfReads(file, decl.name);
    const row = {
      file: path.relative(CONTRACTS_DIR, file),
      name: decl.name,
      line: decl.line,
      text: decl.text.split("\n")[0].slice(0, 80),
      consumers,
      reads,
    };
    if (srcSide.length > 0) buckets.A.push(row);
    else if (internal.length > 0) buckets.B.push(row);
    else if (testSide.length > 0) buckets.C.push(row);
    else if (reads > 0) buckets.D.push(row);
    else buckets.E.push(row);
  }
}

const label = {
  A: "src 侧直接导入",
  B: "仅被其它契约导入",
  C: "仅被 tests/scripts 导入",
  D: "无导入、文件内自用（export 多余）",
  E: "无导入、文件内也不读（无读者）",
};
const total = Object.values(buckets).reduce((a, b) => a + b.length, 0);

console.log(`契约文件 ${contractFiles.length} 个，导出声明 ${total} 条\n`);
for (const key of ["A", "B", "C", "D", "E"]) {
  const n = buckets[key].length;
  console.log(`${key}. ${label[key].padEnd(30)} ${String(n).padStart(5)}  ${((n / total) * 100).toFixed(1)}%`);
}

const group = (rows) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.file)) map.set(r.file, []);
    map.get(r.file).push(r);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
};

console.log("\n== D 类：去掉 export 关键字即可（定义保留） ==");
for (const [file, rows] of group(buckets.D)) {
  console.log(`  ${String(rows.length).padStart(3)}  ${file.padEnd(34)} ${rows.map((r) => r.name).join(", ")}`);
}

console.log("\n== E 类：无任何读者，逐条定位 ==");
for (const [file, rows] of group(buckets.E)) {
  for (const r of rows) console.log(`  ${file.padEnd(34)} :${String(r.line).padStart(4)}  ${r.name}`);
}

console.log("\n== C 类：仅测试/脚本消费 ==");
for (const [file, rows] of group(buckets.C)) {
  console.log(`  ${file.padEnd(34)} ${rows.map((r) => `${r.name}(${r.consumers.join(" ")})`).join(", ")}`);
}
