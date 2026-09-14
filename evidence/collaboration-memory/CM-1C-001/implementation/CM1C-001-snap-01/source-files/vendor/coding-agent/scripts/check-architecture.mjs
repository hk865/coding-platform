#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const CORE_FORBIDDEN_ROOTS = new Set([
  "app",
  "memory",
  "mcp",
  "model",
  "observability",
  "policy",
  "sandbox",
  "skills",
  "storage",
  "tools",
]);
const ADAPTER_CORE_ALLOWLIST = new Map([
  ["model", ["core/ports/model_client"]],
  [
    "tools",
    ["core/ports/tool_executor", "core/ports/tool_batch_policy", "core/ports/model_client"],
  ],
  ["storage", ["core/ports/session_store", "core/ports/checkpoint_store", "core/ports/event_sink"]],
  ["observability", ["core/ports/event_sink"]],
  ["skills", ["core/ports/skill_provider", "core/context/types"]],
  ["memory", ["core/ports/memory_provider", "core/context/types"]],
  ["mcp", []],
]);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function normalize(value) {
  return value.split(path.sep).join("/");
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(entryPath);
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [entryPath];
      return [];
    }),
  );
  return nested.flat();
}

function collectSpecifiers(sourceFile) {
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveInternalImport(fromFile, specifier, sourceRoot) {
  if (!specifier.startsWith(".") && !specifier.startsWith("src/")) return undefined;

  const rawBase = specifier.startsWith("src/")
    ? path.join(sourceRoot, specifier.slice(4))
    : path.resolve(path.dirname(fromFile), specifier);
  const extension = path.extname(rawBase);
  const withoutRuntimeExtension = [".js", ".mjs", ".cjs"].includes(extension)
    ? rawBase.slice(0, -extension.length)
    : rawBase;
  const candidates = [
    rawBase,
    `${withoutRuntimeExtension}.ts`,
    `${withoutRuntimeExtension}.tsx`,
    `${withoutRuntimeExtension}.mts`,
    `${withoutRuntimeExtension}.cts`,
    path.join(rawBase, "index.ts"),
    path.join(withoutRuntimeExtension, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) return path.resolve(candidate);
  }
  return null;
}

function startsWithModule(modulePath, prefix) {
  return modulePath === prefix || modulePath.startsWith(`${prefix}/`);
}

function findCycle(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];

  function visit(node) {
    if (active.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return undefined;

    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    active.delete(node);
    return undefined;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return undefined;
}

async function main() {
  const projectRoot = path.resolve(readArgument("--root") ?? process.cwd());
  const sourceRoot = path.join(projectRoot, "src");
  const files = await listSourceFiles(sourceRoot);
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map(files.map((file) => [path.resolve(file), []]));
  const errors = [];

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    const fromModule = normalize(path.relative(sourceRoot, file));

    for (const specifier of collectSpecifiers(sourceFile)) {
      const resolved = await resolveInternalImport(file, specifier, sourceRoot);
      if (resolved === undefined) continue;
      if (resolved === null || !fileSet.has(resolved)) {
        errors.push(`${fromModule}: 无法解析内部导入 ${specifier}`);
        continue;
      }

      graph.get(path.resolve(file)).push(resolved);
      const targetModule = normalize(path.relative(sourceRoot, resolved));
      const fromRoot = fromModule.split("/")[0];
      const targetRoot = targetModule.split("/")[0];

      if (fromRoot === "core" && CORE_FORBIDDEN_ROOTS.has(targetRoot)) {
        errors.push(`Core 禁止依赖外层模块: ${fromModule} -> ${targetModule}`);
      }

      const allowedCorePrefixes = ADAPTER_CORE_ALLOWLIST.get(fromRoot);
      if (
        targetRoot === "core" &&
        allowedCorePrefixes &&
        !allowedCorePrefixes.some((prefix) => startsWithModule(targetModule, prefix))
      ) {
        errors.push(`Adapter 只能依赖获准的 Core Port/值类型: ${fromModule} -> ${targetModule}`);
      }
    }
  }

  const cycle = findCycle(graph);
  if (cycle) {
    errors.push(
      `检测到循环依赖: ${cycle
        .map((file) => normalize(path.relative(sourceRoot, file)))
        .join(" -> ")}`,
    );
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Architecture check passed (${files.length} source files).`);
}

await main();
