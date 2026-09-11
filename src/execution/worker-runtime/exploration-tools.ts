import * as ts from 'typescript';
import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { SourceIndex } from '../../data/workspace-reader/source-index.js';
import { ProjectSourceIndex } from '../../data/workspace-reader/project-source-index.js';
import { PythonSourceIndex } from '../../data/workspace-reader/python-source-index.js';
import { CppSourceIndex } from '../../data/workspace-reader/cpp-source-index.js';
import { DefaultPermissionPolicy, toolSchema as z, type ToolDefinition, type WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';

const NONE = { sideEffect: 'none' as const, changedPaths: [], workspaceRevision: null, artifactRefs: [] };
const maxBytes = 256 * 1024;
const digest = (text:string) => createHash('sha256').update(text).digest('hex');
const safePath = z.string().min(1).max(1024).refine(p => !p.startsWith('/') && !p.includes('\\') && !p.split('/').some(s=>s==='..'||s==='') && !p.includes('\0'), 'Use a workspace-relative path');
const PYTHON_AST = "import ast, json, sys\nsource = sys.stdin.read()\ntry:\n tree = ast.parse(source)\nexcept SyntaxError as e:\n print(json.dumps({\"status\":\"parse_error\",\"symbols\":[],\"imports\":[],\"calls\":[],\"diagnostics\":[{\"line\":e.lineno,\"message\":e.msg}]}))\n sys.exit(0)\nsymbols, imports, calls = [], [], []\nclass Visitor(ast.NodeVisitor):\n def __init__(self): self.scope = []\n def visit_FunctionDef(self, node):\n  symbols.append({\"name\":node.name,\"kind\":\"function\",\"line\":node.lineno,\"endLine\":node.end_lineno})\n  self.scope.append(node.name); self.generic_visit(node); self.scope.pop()\n visit_AsyncFunctionDef = visit_FunctionDef\n def visit_ClassDef(self, node):\n  symbols.append({\"name\":node.name,\"kind\":\"class\",\"line\":node.lineno,\"endLine\":node.end_lineno})\n  self.scope.append(node.name); self.generic_visit(node); self.scope.pop()\n def visit_Import(self,node):\n  for n in node.names: imports.append({\"module\":n.name,\"line\":node.lineno})\n def visit_ImportFrom(self,node):\n  imports.append({\"module\":\".\"*node.level+(node.module or \"\"),\"line\":node.lineno})\n def visit_Call(self,node):\n  calls.append({\"expression\":ast.unparse(node.func)[:160],\"line\":node.lineno,\"endLine\":node.end_lineno,\"enclosing\":\".\".join(self.scope) or None})\n  self.generic_visit(node)\nVisitor().visit(tree)\nfor values in [symbols,imports,calls]: values.sort(key=lambda v:v[\"line\"])\nprint(json.dumps({\"status\":\"parsed\",\"symbols\":symbols[:150],\"imports\":imports[:150],\"calls\":calls[:150],\"diagnostics\":[],\"truncated\":any(len(v)>150 for v in [symbols,imports,calls])}))\n";
type Rows = Array<Record<string, unknown>>;
type Analysis = { status:string; engine:string; ast:boolean; symbols:Rows; imports:Rows; calls:Rows; diagnostics:Rows; truncated:boolean };

function typescriptAnalysis(path:string, content:string): Analysis {
  const file=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true);
  const symbols:Rows=[], imports:Rows=[], calls:Rows=[];
  const diagnostics=((file as ts.SourceFile & {parseDiagnostics:readonly ts.DiagnosticWithLocation[]}).parseDiagnostics ?? []).map(d=>({line:file.getLineAndCharacterOfPosition(d.start).line+1,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}));
  function visit(node:ts.Node, parent:string|null=null) {
    const line=file.getLineAndCharacterOfPosition(node.getStart(file)).line+1;
    const endLine=file.getLineAndCharacterOfPosition(node.getEnd()).line+1;
    let owner=parent;
    if(ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node)||ts.isMethodDeclaration(node)) {
      if(node.name) { const name=node.name.getText(file).slice(0,160); symbols.push({name,kind:ts.SyntaxKind[node.kind],line,endLine});owner=name; }
    }
    if(ts.isVariableDeclaration(node)&&(node.initializer && (ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)))) {
      owner=node.name.getText(file).slice(0,160);symbols.push({name:owner,kind:'function-variable',line,endLine});
    }
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)) imports.push({module:node.moduleSpecifier.text,line});
    if(ts.isCallExpression(node)||ts.isNewExpression(node)) calls.push({expression:node.expression.getText(file).slice(0,160),line,endLine,enclosing:parent});
    ts.forEachChild(node,child=>visit(child,owner));
  }
  ts.forEachChild(file,node=>visit(node));
  for(const rows of [symbols,imports,calls])rows.sort((a,b)=>Number(a['line'])-Number(b['line']));
  return {status:diagnostics.length?'parse_error':'parsed',engine:'typescript-ast',ast:true,symbols:symbols.slice(0,150),imports:imports.slice(0,150),calls:calls.slice(0,150),diagnostics:diagnostics.slice(0,20),truncated:[symbols,imports,calls].some(rows=>rows.length>150)||diagnostics.length>20};
}
async function pythonAnalysis(content:string,signal:AbortSignal):Promise<Analysis>{
  // Parse stdin with a fixed isolated standard-library program. Never import,
  // compile for execution, or run project code, configuration or hooks.
  const result=await new Promise<string>((resolve,reject)=>{
    const child=execFile('/usr/bin/python3',['-I','-c',PYTHON_AST],{timeout:3000,maxBuffer:128*1024,signal,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}},(error,stdout)=>error?reject(error):resolve(stdout));
    child.stdin?.on('error',()=>{});child.stdin?.end(content);
  });
  return {...JSON.parse(result) as Omit<Analysis,'engine'|'ast'>,engine:'python-ast',ast:true,truncated:JSON.parse(result).truncated===true};
}
function textAnalysis(content:string):Analysis{
  const imports:Rows=[];
  for(const [index,line] of content.split('\n').entries()){
    const match=/^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(line);
    if(match)imports.push({module:match[1],line:index+1});
  }
  return {status:'unsupported_ast',engine:'text-fallback',ast:false,symbols:[],imports:imports.slice(0,150),calls:[],diagnostics:[{message:'No AST provider for this language. Only textual include references are extracted; use search/read to inspect source. No semantic or call-graph coverage.'}],truncated:imports.length>150};
}
export type SourceToolOptions = {
  sourceIdentity?: () => Promise<{ workspace: string; commit: string | null }>;
  allowedPath?: (path: string) => boolean;
  assertCurrent?: () => Promise<void>;
  includeReadSource?: boolean;
};
export function createExplorationTools(workspace:WorkspaceSandbox, options: SourceToolOptions = {}):ToolDefinition[] {
  const cache=new Map<string,Analysis>();
  const policy=new DefaultPermissionPolicy({hiddenPrefixes:workspace.deniedPrefixes});
  const visible=(path:string)=>(options.allowedPath?.(path) ?? true) && policy.evaluate({runId:'analysis',callId:'source-read',tool:'read',effectClass:'read_only',arguments:{path},paths:[path],cwd:null,commandPreview:null,capabilities:['workspace_read'],workspaceIdentity:'analysis',workspaceRevision:'current',sandboxProfileVersion:'analysis-v1'}).decision==='allow';
  const requireVisible=(path:string)=>{if(!visible(path))throw Error('Path denied by workspace read policy');};
  const read = (path: string, bytes: number) => { requireVisible(path); return workspace.read(path, bytes); };
  const sourceIndex = new SourceIndex({ read, allowed: visible });
  const projectIndex = new ProjectSourceIndex({ read, allowed: visible,
    inventory: signal => workspace.listFiles(60000, { signal }),
    sourceIdentity: options.sourceIdentity ?? (async () => ({ workspace: workspace.identity, commit: null })) });
  const pythonIndex = new PythonSourceIndex({ read, allowed: visible,
    inventory: signal => workspace.listFiles(60000, { signal }),
    sourceIdentity: options.sourceIdentity ?? (async () => ({ workspace: workspace.identity, commit: null })) });
  const cppIndex = new CppSourceIndex({ read, allowed: visible,
    inventory: signal => workspace.listFiles(60000, { signal }),
    sourceIdentity: options.sourceIdentity ?? (async () => ({ workspace: workspace.identity, commit: null })) });

  function tool(name:string,description:string,inputSchema:ToolDefinition['inputSchema'],execute:(args:Record<string,unknown>,signal:AbortSignal)=>Promise<unknown>):ToolDefinition {
    return {name,description,inputSchema,effectClass:'read_only',requiredCapabilities:['workspace_read'],defaultTimeoutMs:10000,outputLimitBytes:64*1024,independentReadOnly:true,
      summarize:args=>({paths:typeof args['path']==='string'?[args['path']]:Array.isArray(args['paths'])?args['paths'] as string[]:typeof args['prefix']==='string'?[args['prefix']]:[],cwd:null,commandPreview:null}),
      handler:{execute:async(call,executionOptions)=>{
        if(executionOptions.signal.aborted)return {schemaVersion:1,callId:call.callId,status:'cancelled',reason:'Analysis cancelled',output:[],effects:NONE};
        const parsed=inputSchema.safeParse(call.arguments);
        if(!parsed.success)return {schemaVersion:1,callId:call.callId,status:'error',error:{code:'invalid_arguments',message:'Invalid analysis arguments',retryable:false},output:[],effects:NONE};
        try {
          const args=parsed.data as Record<string,unknown>;
          if(options.allowedPath) {
            for(const key of ['path','prefix','configPath'])if(typeof args[key]==='string')requireVisible(args[key] as string);
            if(Array.isArray(args['paths']))for(const path of args['paths'])requireVisible(path as string);
          }
          await options.assertCurrent?.();
          const value=await execute(args,executionOptions.signal);
          await options.assertCurrent?.();
          if(Buffer.byteLength(JSON.stringify(value))>60*1024)throw Error('Analysis output too large; narrow paths or result limit');
          return {schemaVersion:1,callId:call.callId,status:'success',output:[{kind:'json',value}],effects:NONE} as never;
        } catch(error) {
          if(executionOptions.signal.aborted)return {schemaVersion:1,callId:call.callId,status:'cancelled',reason:'Analysis cancelled',output:[],effects:NONE};
          const message=error instanceof Error?error.message:'Analysis unavailable';
          return {schemaVersion:1,callId:call.callId,status:'error',error:{code:'execution_failed',message,retryable:false},output:[{kind:'text',text:message}],effects:NONE};
        }
      }}
    };
  }
  return [
    ...(options.includeReadSource ? [tool('read_source','Read a bounded source range within the pinned candidate source. Paths excluded from the candidate are unavailable. Returns the full-file digest and exact line range; use further ranges when truncated.',z.object({path:safePath,startLine:z.number().int().positive().default(1),maxLines:z.number().int().min(1).max(500).default(150)}).strict(),async args=>{
      const file=await read(args['path'] as string,maxBytes);
      const lines=file.content.split('\n'),startLine=args['startLine'] as number,maxLines=args['maxLines'] as number;
      if(startLine>lines.length)throw Error('Requested source range is outside the file');
      const selected=lines.slice(startLine-1,startLine-1+maxLines);
      return {materialId:'source:'+file.path,path:file.path,sourceDigest:digest(file.content),revision:file.revision,startLine,endLine:startLine+selected.length-1,totalLines:lines.length,content:selected.join('\n'),truncated:startLine-1+selected.length<lines.length};
    })] : []),
    {...tool('cpp_index','Query C/C++ project symbols, definitions, references, includes and static call candidates with libclang 18 and a required compile_commands.json. Compiler commands never execute; unknown flags and external include paths return explicit gaps. Only permission-filtered workspace files are exposed through a redirect-only VFS. One-based UTF-16 coordinates, source digests and analyzer identity accompany partial semantic results.',z.object({operation:z.enum(['symbols','definitions','references','imports','calls']),configPath:safePath.optional(),prefix:safePath.optional(),path:safePath.optional(),line:z.number().int().positive().optional(),column:z.number().int().positive().optional(),expectedSnapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(200).default(100)}).strict(),async(args,signal)=>cppIndex.query(args as unknown as import('../../data/workspace-reader/project-source-index.js').ProjectSourceQuery,signal)),defaultTimeoutMs:60000},
    {...tool('python_index','Query readable Python project symbols, definitions, references, imports and static call candidates using Jedi on an isolated source snapshot. Includes source digests, commit and unresolved relations. Workspace pyrightconfig.json, pyproject.toml and setup.cfg import roots and readable .py/.pyi dependencies are parsed as data. Source and config changes invalidate results. Project code never executes; external interpreter environments and complete dynamic call graphs are not covered.',z.object({operation:z.enum(['symbols','definitions','references','imports','calls']),configPath:safePath.optional(),prefix:safePath.optional(),path:safePath.optional(),line:z.number().int().positive().optional(),column:z.number().int().positive().optional(),expectedSnapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(200).default(100)}).strict(),async(args,signal)=>pythonIndex.query(args as unknown as import('../../data/workspace-reader/project-source-index.js').ProjectSourceQuery,signal)),defaultTimeoutMs:60000},
    {...tool('project_index','Query the readable TS/JS project using tsconfig/jsconfig and installed in-workspace dependencies. Operations: symbols, definitions, references, imports, static call candidates. Returns snapshot/commit, content digests, locations, unresolved relations and incremental changes. Configs are parsed as data; plugins never execute. Use expectedSnapshot when paging. Use python_index or cpp_index for the separate Python and C/C++ capabilities.',z.object({operation:z.enum(['symbols','definitions','references','imports','calls']),configPath:safePath.optional(),prefix:safePath.optional(),path:safePath.optional(),line:z.number().int().positive().optional(),column:z.number().int().positive().optional(),expectedSnapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(200).default(100)}).strict(),async(args,signal)=>projectIndex.query(args as unknown as import('../../data/workspace-reader/project-source-index.js').ProjectSourceQuery,signal)),defaultTimeoutMs:60000},
    tool('code_index','Query TS/JS declarations, definitions or semantic references within explicit readable files. Coordinates are one-based UTF-16. Returns source digests and partial coverage; no project config or external dependencies. Not a complete call graph. Use source_excerpt with a returned digest to fetch material.',z.object({paths:z.array(safePath).min(1).max(64),operation:z.enum(['symbols','definitions','references']),path:safePath.optional(),line:z.number().int().positive().optional(),column:z.number().int().positive().optional(),expectedSnapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),limit:z.number().int().min(1).max(200).default(100)}).strict(),async(args,signal)=>sourceIndex.query(args as unknown as import('../../data/workspace-reader/source-index.js').SourceQuery,signal)),
    tool('source_excerpt','Read a bounded source range at an exact content digest from code_index or symbols. Returns stale if content changed; never silently substitutes newer source.',z.object({path:safePath,expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),startLine:z.number().int().positive(),endLine:z.number().int().positive()}).strict(),async args=>sourceIndex.excerpt(args['path'] as string,args['expectedDigest'] as string,args['startLine'] as number,args['endLine'] as number)),
    tool('list_files','List readable workspace file paths with bounded pagination. Includes installed/generated files; skips denied paths and symbolic links. No source execution.',z.object({prefix:safePath.optional(),offset:z.number().int().min(0).max(20000).default(0),limit:z.number().int().min(1).max(300).default(100)}).strict(),async(args,signal)=>{
      const prefix=args['prefix'] as string|undefined; if(prefix)requireVisible(prefix);
      const inventory=await workspace.listFiles(20000,{...(prefix?{prefix}:{}),signal});
      const paths=inventory.paths.filter(visible);
      const offset=args['offset'] as number,limit=args['limit'] as number;
      return {paths:paths.slice(offset,offset+limit),nextOffset:offset+limit<paths.length?offset+limit:null,truncated:inventory.truncated,totalListed:paths.length,coverage:'bounded file enumeration; denied paths and symlinks excluded',excludedPrefixes:workspace.deniedPrefixes};
    }),
    tool('search','Search literal text in workspace source without running shell commands. Returns matching lines with file content digests; bounded files/results and explicit skipped coverage. Use paths to narrow a query.',z.object({query:z.string().min(1).max(200),paths:z.array(safePath).min(1).max(32).optional(),prefix:safePath.optional(),maxResults:z.number().int().min(1).max(100).default(40),maxFiles:z.number().int().min(1).max(500).default(200)}).strict(),async(args,signal)=>{
      const prefix=args['prefix'] as string|undefined; if(prefix)requireVisible(prefix);
      const explicit=args['paths'] as string[]|undefined; explicit?.forEach(requireVisible);
      const inventory=explicit?{paths:explicit,truncated:false}:await workspace.listFiles(20000,{...(prefix?{prefix}:{}),signal});
      const candidates=inventory.paths.filter(visible);
      const limit=args['maxResults'] as number,maxFiles=args['maxFiles'] as number,query=args['query'] as string;
      const matches:Rows=[],skipped:Rows=[];let filesRead=0,bytesRead=0,truncated=inventory.truncated||candidates.length>maxFiles;
      for(const path of candidates.slice(0,maxFiles)){
        if(signal.aborted)throw Error('Analysis cancelled');
        let file;
        try {file=await read(path,maxBytes);}catch{skipped.push({path,reason:'unreadable, denied or larger than 256 KiB'});continue;}
        filesRead++;bytesRead+=Buffer.byteLength(file.content);
        if(file.content.includes('\0')){skipped.push({path,reason:'binary content'});continue;}
        for(const [index,text] of file.content.split('\n').entries()){
          if(text.includes(query)){
            if(matches.length>=limit){truncated=true;break;}
            matches.push({path:file.path,line:index+1,text:text.slice(0,500),lineTruncated:text.length>500,revision:file.revision});
          }
        }
        if(matches.length>=limit){truncated=true;break;}
      }
      return {query,matches,filesRead,bytesRead,skipped:skipped.slice(0,50),skippedCount:skipped.length,truncated:truncated||skipped.length>0,coverage:'literal text search, not semantic references'};
    }),
    tool('symbols','Parse a file into declarations, imports and syntactic call sites using TypeScript/JavaScript AST or Python AST. Does not execute project code or resolve runtime behavior. Unsupported languages explicitly return text fallback.',z.object({path:safePath}).strict(),async(args,signal)=>{
      requireVisible(args['path'] as string);
      const file=await read(args['path'] as string,maxBytes);
      const key=file.path+':'+file.revision;let analysis=cache.get(key);
      if(!analysis){
        const extension=extname(file.path).toLowerCase();
        if(['.ts','.tsx','.js','.jsx','.mts','.cts','.mjs','.cjs'].includes(extension))analysis=typescriptAnalysis(file.path,file.content);
        else if(extension==='.py'){
          try{analysis=await pythonAnalysis(file.content,signal);}catch(error){
            if(signal.aborted)throw error;
            analysis={...textAnalysis(file.content),status:'parser_unavailable',diagnostics:[{message:'Isolated Python AST parser unavailable or exceeded resource limits; source was not executed.'}]};
          }
        }else analysis=textAnalysis(file.content);
        if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(key,analysis);
      }
      return {path:file.path,revision:file.revision,sourceDigest:digest(file.content),...analysis,coverage:{ast:analysis.ast,semanticResolution:false,callsAreSyntacticOnly:true},totalLines:file.content.split('\n').length};
    }),
  ];
}
