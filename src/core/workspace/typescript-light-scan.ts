import * as ts from 'typescript';
import { posix } from 'node:path';
import { configureTypeScriptProject } from './typescript-source-query.js';
import { ProjectSourceFailure, SOURCE_ROOT, type CapturedProjectFile } from './project-source-snapshot.js';

/**
 * WorkspaceTools — observation light scan for TS/JS (slice 8, §11.2).
 *
 * This is a syntax-only walk over one frozen material map. It reads configurations and
 * references, resolves module/triple-slash specifiers against the same material with one
 * shared resolution cache, and never builds a Program or a LanguageService. Files are
 * walked from an explicit queue, not by recursion.
 */

export type LightScanFault = (event: { phase: 'language' } | { phase: 'file'; path: string }) => void;

export type LightScanInput = {
  files: ReadonlyMap<string, { path: string; content: string; digest: string }>; // keys are workspace-relative paths, no /workspace prefix
  configPath?: string | null;       // explicit config, else root tsconfig.json/jsconfig.json/default
  skipped?: readonly { path: string; reason: string }[]; // capture skip list, for choosing the configuration by existence only
  signal: AbortSignal;
  fault?: LightScanFault;
  maxRawReferences?: number;        // default 100_000
};

export type LightScanResult = {
  files: { path: string; digest: string; byteSize: number; status: 'parsed' | 'failed' | 'skipped'; reason: string | null;
           nonBlankLines: number; indexed: boolean }[];
  references: { path: string; digest: string; line: number; specifier: string;
                resolution: 'resolved' | 'unknown'; targets: { path: string; digest: string }[] }[];
  edges: { from: string; to: string }[];
  unresolved: { from: string; specifier: string; reason: string | null; line: number }[];
  coverage: { parsed: number; edges: 'supported' | 'unsupported' | 'failed'; reason: string | null; notes: string[];
              issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[] };
  projectConfiguration: string | null; // chosen config path or null
  indexedSourceCount: number;          // walked TS/JS files
};

/** Internal names for the TypeScript runtime exports that the public `.d.ts` does not declare. */
type TsInternal = typeof ts & {
  getResolutionDiagnostic(options: ts.CompilerOptions, resolved: { extension: string }, sourceFile: { isDeclarationFile: boolean }): ts.Diagnostic | undefined;
  getAllowJSCompilerOption(options: ts.CompilerOptions): boolean;
};
const internal = ts as TsInternal;

const DEFAULT_MAX_RAW_REFERENCES = 100_000;
const SKIPPED_REASON = '不在 TS 分析的范围里';
const REFERENCES_UNSUPPORTED_REASON = '根配置带 references，观测还不跟进';
const YIELD_INTERVAL_MS = 50;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/i;
const JS_EXTENSION = /\.(?:js|jsx|mjs|cjs)$/i;
const TS_WALK_EXTENSIONS = ['ts', 'tsx', 'd.ts'] as const;
const JS_WALK_EXTENSIONS = ['js', 'jsx'] as const;

type MaterialFile = { path: string; content: string; digest: string };
type WalkedFile = LightScanResult['files'][number];
type RawReference =
  | { kind: 'module'; specifier: string; line: number; node: ts.StringLiteralLike }
  | { kind: 'path'; specifier: string; line: number }
  | { kind: 'types'; specifier: string; line: number; directive: ts.FileReference };

const nonBlankLineCount = (content: string) => content.split('\n').filter(line => /\S/.test(line)).length;
const byteSizeOf = (content: string) => Buffer.byteLength(content);
const fileNameOf = (path: string) => path.split('/').pop() ?? path;
const dirKey = (name: string) => posix.normalize(name).replace(/\/$/, '');
const isSourceFile = (path: string) => SOURCE_EXTENSION.test(path);
const isJsFile = (path: string) => JS_EXTENSION.test(path);

/** §11.5: reasons carry file names only, never workspace paths. */
const fileNameOnly = (message: string) => message.replace(/\/workspace\/([^\s'":;,()]+)/g, (_match, rest: string) => rest.split('/').pop() ?? rest);
const first200 = (message: string) => message.slice(0, 200);
const failureMessage = (error: unknown) => {
  const name = error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${first200(message)}`;
};

/** Map a path to the TypeScript extension used only for the resolution diagnostics of plain paths. */
const extensionOf = (path: string): ts.Extension | null => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.d.mts')) return ts.Extension.Dmts;
  if (lower.endsWith('.d.cts')) return ts.Extension.Dcts;
  if (lower.endsWith('.d.ts')) return ts.Extension.Dts;
  if (lower.endsWith('.mts')) return ts.Extension.Mts;
  if (lower.endsWith('.cts')) return ts.Extension.Cts;
  if (lower.endsWith('.tsx')) return ts.Extension.Tsx;
  if (lower.endsWith('.ts')) return ts.Extension.Ts;
  if (lower.endsWith('.jsx')) return ts.Extension.Jsx;
  if (lower.endsWith('.mjs')) return ts.Extension.Mjs;
  if (lower.endsWith('.cjs')) return ts.Extension.Cjs;
  if (lower.endsWith('.js')) return ts.Extension.Js;
  if (lower.endsWith('.json')) return ts.Extension.Json;
  return null;
};

const stringLike = (node: ts.Node | undefined): node is ts.StringLiteralLike =>
  !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

/** Collect the reference forms §11.2 recognises with one explicit stack; no recursion. */
function collectReferences(sourceFile: ts.SourceFile, isJs: boolean): RawReference[] {
  const references: RawReference[] = [];
  const lineOf = (position: number) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  const declarationLine = (node: ts.Node) => lineOf(node.getStart(sourceFile));
  const pushModule = (specifierNode: ts.StringLiteralLike, line: number) =>
    references.push({ kind: 'module', specifier: specifierNode.text, line, node: specifierNode });
  const stack: ts.Node[] = [sourceFile];
  while (stack.length) {
    const node = stack.pop()!;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && stringLike(node.moduleSpecifier)) pushModule(node.moduleSpecifier, declarationLine(node));
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference) && stringLike(reference.expression)) pushModule(reference.expression, declarationLine(node));
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && stringLike(argument.literal)) pushModule(argument.literal, declarationLine(node));
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && stringLike(argument)) {
        pushModule(argument, lineOf(node.getStart(sourceFile)));
      } else if (isJs && ts.isIdentifier(node.expression) && node.expression.text === 'require' &&
          node.arguments.length === 1 && stringLike(argument)) {
        pushModule(argument, lineOf(node.getStart(sourceFile)));
      }
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, child => { children.push(child); });
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]!);
  }
  // Triple-slash directives are not AST nodes; their written string content is the specifier.
  for (const reference of sourceFile.referencedFiles) {
    references.push({ kind: 'path', specifier: reference.fileName, line: lineOf(reference.pos) });
  }
  for (const reference of sourceFile.typeReferenceDirectives) {
    references.push({ kind: 'types', specifier: reference.fileName, line: lineOf(reference.pos), directive: reference });
  }
  return references;
}

/** The unsupported/failed result shape: the observation owner computes totals from this. */
function emptyResult(edges: 'unsupported' | 'failed', reason: string, projectConfiguration: string | null): LightScanResult {
  return {
    files: [], references: [], edges: [], unresolved: [],
    coverage: { parsed: 0, edges, reason, notes: [], issues: [] },
    projectConfiguration, indexedSourceCount: 0,
  };
}

export async function scanTypeScript(input: LightScanInput): Promise<LightScanResult> {
  const signal = input.signal;
  const maxRawReferences = input.maxRawReferences ?? DEFAULT_MAX_RAW_REFERENCES;

  try {
    input.fault?.({ phase: 'language' });
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    return emptyResult('failed', failureMessage(error), null);
  }
  signal.throwIfAborted();

  const material = new Map<string, MaterialFile>();
  const absoluteFiles = new Map<string, CapturedProjectFile>();
  const directories = new Set<string>();
  const addDirectory = (name: string) => {
    let directory = dirKey(name);
    while (directory !== '/' && directory !== '.' && directory !== '') {
      directories.add(directory);
      directory = dirKey(posix.dirname(directory));
    }
    directories.add('/');
  };
  for (const [key, file] of input.files) {
    const relative = key;
    material.set(relative, file);
    absoluteFiles.set(posix.normalize(SOURCE_ROOT + relative), file);
    addDirectory(posix.dirname(SOURCE_ROOT + relative));
  }
  directories.add(dirKey(SOURCE_ROOT));

  const relativeOf = (name: string): string | null => {
    const normalized = posix.normalize(name);
    return normalized.startsWith(SOURCE_ROOT) ? normalized.slice(SOURCE_ROOT.length) : null;
  };
  const skipped = new Map<string, string>();
  for (const entry of input.skipped ?? []) skipped.set(entry.path, entry.reason);
  const hasEntry = (path: string) => material.has(path) || skipped.has(path);

  // §11.5 "选配置看存在": root tsconfig.json wins even when it is skipped; no fallback.
  const chosenConfig = input.configPath !== undefined && input.configPath !== null
    ? input.configPath
    : hasEntry('tsconfig.json') ? 'tsconfig.json'
      : hasEntry('jsconfig.json') ? 'jsconfig.json'
        : null;
  if (chosenConfig !== null) {
    const skipReason = skipped.get(chosenConfig);
    if (skipReason !== undefined) return emptyResult('failed', `${fileNameOf(chosenConfig)} 读不了：${skipReason}`, null);
    const content = material.get(chosenConfig)?.content;
    if (content !== undefined && content.includes('\0')) return emptyResult('failed', `${fileNameOf(chosenConfig)} 读不了：binary source`, null);
  }

  let configuration;
  try {
    configuration = configureTypeScriptProject(absoluteFiles, chosenConfig);
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    if (error instanceof ProjectSourceFailure && error.status === 'unsupported') {
      return emptyResult('unsupported', REFERENCES_UNSUPPORTED_REASON, null);
    }
    const message = fileNameOnly(error instanceof Error ? error.message : String(error));
    return emptyResult('failed', `配置错误：${first200(message)}`, null);
  }

  const { options, rootNames } = configuration;
  const allowJs = internal.getAllowJSCompilerOption(options);
  const moduleCache = ts.createModuleResolutionCache(SOURCE_ROOT, name => name, options);
  const typeCache = ts.createTypeReferenceDirectiveResolutionCache(SOURCE_ROOT, name => name, options);
  const packageJsonCache = moduleCache.getPackageJsonInfoCache();
  const host: ts.ModuleResolutionHost = {
    fileExists: name => absoluteFiles.has(posix.normalize(name)),
    readFile: name => absoluteFiles.get(posix.normalize(name))?.content,
    directoryExists: name => directories.has(dirKey(name)),
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => SOURCE_ROOT,
  };

  const walked = new Map<string, WalkedFile>();
  const walkOrder: string[] = [];
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (absolute: string) => {
    const normalized = posix.normalize(absolute);
    if (queued.has(normalized) || walked.has(normalized)) return;
    if (!absoluteFiles.has(normalized)) return;
    queued.add(normalized);
    queue.push(normalized);
  };
  for (const root of rootNames) enqueue(root);

  const references: LightScanResult['references'] = [];
  const edges: LightScanResult['edges'] = [];
  const unresolved: LightScanResult['unresolved'] = [];
  let rawReferences = 0;
  let languageFailure: string | null = null;
  let lastYield = Date.now();

  // §11.2 "照 TS 程序的规则": under `noResolve` the program still resolves references to
  // files that were part of the initial root set; only targets outside it are not loaded.
  const rootSet = new Set(rootNames.map(name => posix.normalize(name)));
  const acceptedTarget = (target: string | null): string | null => {
    if (target === null || !options.noResolve) return target;
    return rootSet.has(posix.normalize(SOURCE_ROOT + target)) ? target : null;
  };

  const resolveModuleReference = (sourceFile: ts.SourceFile, reference: Extract<RawReference, { kind: 'module' }>): { target: string | null; resolution: 'resolved' | 'unknown' } => {
    const mode = ts.getModeForUsageLocation(sourceFile, reference.node, options);
    const resolved = ts.resolveModuleName(reference.specifier, sourceFile.fileName, options, host, moduleCache, undefined, mode).resolvedModule;
    if (!resolved) return { target: null, resolution: 'unknown' };
    const target = relativeOf(resolved.resolvedFileName);
    if (target === null || !material.has(target)) return { target: null, resolution: 'unknown' };
    const diagnostic = internal.getResolutionDiagnostic(options, resolved, sourceFile);
    if (diagnostic) return { target: null, resolution: 'unknown' };
    const accepted = acceptedTarget(target);
    return accepted === null ? { target: null, resolution: 'unknown' } : { target: accepted, resolution: 'resolved' };
  };

  const triplePathLoadable = (absolute: string, sourceFile: ts.SourceFile): boolean => {
    const relative = relativeOf(absolute);
    if (relative === null || !material.has(relative)) return false;
    const extension = extensionOf(absolute);
    if (extension === null) return false;
    if ([ts.Extension.Ts, ts.Extension.Tsx, ts.Extension.Mts, ts.Extension.Cts,
      ts.Extension.Dts, ts.Extension.Dmts, ts.Extension.Dcts].includes(extension)) return true;
    if ([ts.Extension.Js, ts.Extension.Jsx, ts.Extension.Mjs, ts.Extension.Cjs].includes(extension)) return allowJs;
    if (extension === ts.Extension.Json) return internal.getResolutionDiagnostic(options, { extension }, sourceFile) === undefined;
    return false;
  };

  const resolveTriplePath = (written: string, sourceFile: ts.SourceFile): string | null => {
    const target = ts.resolveTripleslashReference(written, sourceFile.fileName);
    if (posix.extname(target)) return triplePathLoadable(target, sourceFile) ? relativeOf(target) : null;
    const extensions = allowJs ? [...TS_WALK_EXTENSIONS, ...JS_WALK_EXTENSIONS] : [...TS_WALK_EXTENSIONS];
    for (const extension of extensions) {
      const candidate = `${target}.${extension}`;
      if (triplePathLoadable(candidate, sourceFile)) return relativeOf(candidate);
    }
    return null;
  };

  // §11.2 "不卡 Host": check cancellation on every branch; yield the event loop when the
  // interval elapsed. Both live outside the per-file try and every loop branch reaches them
  // through the loop's `finally`.
  const maybeYield = (): Promise<void> | null => {
    signal.throwIfAborted();
    if (Date.now() - lastYield < YIELD_INTERVAL_MS) return null;
    return new Promise<void>(resolve => setImmediate(resolve)).then(() => {
      lastYield = Date.now();
      signal.throwIfAborted();
    });
  };

  try {
    while (queue.length) {
      if (languageFailure !== null) break;
      try {
        const absolute = queue.shift()!;
        if (walked.has(absolute)) continue;
        const relative = relativeOf(absolute);
        const file = absoluteFiles.get(absolute);
        if (relative === null || !file) continue;
        if (!isSourceFile(relative)) {
          walked.set(absolute, { path: relative, digest: file.digest, byteSize: byteSizeOf(file.content), status: 'parsed',
            reason: null, nonBlankLines: nonBlankLineCount(file.content), indexed: true });
          walkOrder.push(absolute);
          continue;
        }

        let sourceFile: ts.SourceFile;
        let collected: RawReference[];
        try {
          input.fault?.({ phase: 'file', path: relative });
          const impliedNodeFormat = ts.getImpliedNodeFormatForFile(absolute, packageJsonCache, host, options);
          sourceFile = ts.createSourceFile(absolute, file.content,
            { languageVersion: options.target ?? ts.ScriptTarget.Latest, impliedNodeFormat }, true);
          collected = collectReferences(sourceFile, isJsFile(relative));
        } catch (error) {
          if (signal.aborted) signal.throwIfAborted();
          walked.set(absolute, { path: relative, digest: file.digest, byteSize: byteSizeOf(file.content), status: 'failed',
            reason: failureMessage(error), nonBlankLines: nonBlankLineCount(file.content), indexed: true });
          walkOrder.push(absolute);
          continue;
        }

        // The raw-reference cap is checked outside the per-file try: crossing it fails the
        // whole language, not just this file, and keeps no references from this file.
        for (let index = 0; index < collected.length; index++) {
          rawReferences++;
          if (rawReferences > maxRawReferences) { languageFailure = `原始引用超过 ${maxRawReferences} 条`; break; }
        }
        if (languageFailure !== null) break;

        const fileReferences: LightScanResult['references'] = [];
        const fileEdges: LightScanResult['edges'] = [];
        const fileUnresolved: LightScanResult['unresolved'] = [];
        const targets: string[] = [];
        try {
          for (const reference of collected) {
            let target: string | null = null;
            let resolution: 'resolved' | 'unknown' = 'unknown';
            if (reference.kind === 'module') {
              ({ target, resolution } = resolveModuleReference(sourceFile, reference));
            } else if (reference.kind === 'path') {
              target = acceptedTarget(resolveTriplePath(reference.specifier, sourceFile));
              resolution = target ? 'resolved' : 'unknown';
            } else {
              const directive = reference.directive;
              const mode = ts.getModeForFileReference(directive, sourceFile.impliedNodeFormat);
              const resolved = ts.resolveTypeReferenceDirective(reference.specifier, sourceFile.fileName, options, host, undefined, typeCache, mode)
                .resolvedTypeReferenceDirective;
              const candidate = resolved?.resolvedFileName;
              if (candidate) {
                const candidateRelative = relativeOf(candidate);
                const extension = extensionOf(candidate);
                if (candidateRelative !== null && material.has(candidateRelative) && extension !== null &&
                    internal.getResolutionDiagnostic(options, { extension }, sourceFile) === undefined) {
                  target = acceptedTarget(candidateRelative);
                  resolution = target ? 'resolved' : 'unknown';
                }
              }
            }
            const targetFile = target === null ? null : material.get(target) ?? null;
            fileReferences.push({
              path: relative, digest: file.digest, line: reference.line, specifier: reference.specifier,
              resolution, targets: targetFile ? [{ path: targetFile.path, digest: targetFile.digest }] : [],
            });
            if (targetFile) {
              targets.push(target!);
              if (target !== relative) fileEdges.push({ from: relative, to: target! });
            } else {
              fileUnresolved.push({ from: relative, specifier: reference.specifier, reason: null, line: reference.line });
            }
          }
        } catch (error) {
          if (signal.aborted) signal.throwIfAborted();
          walked.set(absolute, { path: relative, digest: file.digest, byteSize: byteSizeOf(file.content), status: 'failed',
            reason: failureMessage(error), nonBlankLines: nonBlankLineCount(file.content), indexed: true });
          walkOrder.push(absolute);
          continue;
        }

        walked.set(absolute, { path: relative, digest: file.digest, byteSize: byteSizeOf(file.content), status: 'parsed',
          reason: null, nonBlankLines: nonBlankLineCount(file.content), indexed: true });
        walkOrder.push(absolute);
        references.push(...fileReferences);
        edges.push(...fileEdges);
        unresolved.push(...fileUnresolved);
        for (const target of targets) enqueue(SOURCE_ROOT + target);
      } finally {
        const pending = maybeYield();
        if (pending !== null) await pending;
      }
    }
    await Promise.resolve();
    signal.throwIfAborted();
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    return emptyResult('failed', failureMessage(error), null);
  }

  if (languageFailure !== null) return emptyResult('failed', languageFailure, null);

  const files: LightScanResult['files'] = walkOrder.map(absolute => walked.get(absolute)!);
  const issues: LightScanResult['coverage']['issues'] = files
    .filter(file => file.status === 'failed')
    .map(file => ({ path: file.path, kind: 'failed' as const, reason: file.reason ?? '' }));
  for (const [path, file] of [...material.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (!isSourceFile(path) || walked.has(posix.normalize(SOURCE_ROOT + path))) continue;
    files.push({ path, digest: file.digest, byteSize: byteSizeOf(file.content), status: 'skipped', reason: SKIPPED_REASON,
      nonBlankLines: nonBlankLineCount(file.content), indexed: false });
    issues.push({ path, kind: 'skipped', reason: SKIPPED_REASON });
  }
  const parsed = files.filter(file => file.status === 'parsed' && isSourceFile(file.path)).length;
  const indexedSourceCount = walkOrder.filter(absolute => {
    const relative = relativeOf(absolute);
    return relative !== null && isSourceFile(relative);
  }).length;

  return {
    files,
    references,
    edges,
    unresolved,
    coverage: { parsed, edges: 'supported', reason: null, notes: [], issues },
    projectConfiguration: chosenConfig,
    indexedSourceCount,
  };
}
