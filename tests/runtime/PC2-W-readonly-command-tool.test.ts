/** PC-2 row PC-24 (W): `createReadonlyCommandTool` and its registration wrapper take the platform tool texts. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createReadonlyCommandTool, registerReadonlyCommandTool } from '../../src/core/agent-runtime/readonly-command-tool.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };
type JsonSchema = { properties: Record<string, { description?: string }> };
const changed: Texts = {
  run_readonly_command: {
    description: 'PC2-W changed run_readonly_command description',
    parameters: { ...PLATFORM_PROMPT_PACK_V1.tools['run_readonly_command']!.parameters, command: 'PC2-W changed command parameter' },
  },
};
const definition = (texts?: Texts): ToolDefinition =>
  createReadonlyCommandTool({ workspace: {} as never, workspaceRoot: '/tmp', authorization: {} as never, ...(texts === undefined ? {} : { texts }) });
const specification = (tool: ToolDefinition) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) });
const schemaOf = (tool: ToolDefinition) => z.toJSONSchema(tool.inputSchema) as unknown as JsonSchema;

/**
 * The post-SHT-1 specification, one hand-written JSON literal. Copied by hand
 * from the SHT-1 ruling §2 A3/A4 (schema shape, key order, constraints) and the
 * regenerated platform pack (every description and parameter text). The texts
 * are the current pack after SHT-1 and the P2 prompt-budget compression.
 */
const DEFAULT_SPECIFICATION: ToolSpecification = {
  "name": "run_readonly_command",
  "description": "Run a non-interactive read-only command in a bubblewrap sandbox. It never changes files: the workspace is mounted read-only at /workspace, ordinary .git is readable but read-only, Host-denied paths are hidden, and only workspace paths are visible. There is no network except the platform HTTP proxy. When you have your own shell, use that shell instead. Commands are never stopped by time; bound one yourself. Note: a cancellation replaces the captured output with empty output.",
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "minLength": 1,
        "description": "Non-interactive bash command to run"
      },
      "cwd": {
        "description": "Workspace-relative dir; default root",
        "type": "string"
      },
      "timeoutMs": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991,
        "description": "Expected duration in ms; default 600000"
      }
    },
    "required": [
      "command"
    ],
    "additionalProperties": false
  }
};

it('PC2-W-readonly-command-tool carries the changed description and command parameter text', () => {
  const tool = definition(changed);
  expect(tool.description).toBe('PC2-W changed run_readonly_command description');
  expect(schemaOf(tool).properties['command']!.description).toBe('PC2-W changed command parameter');
});

it('PC2-W-readonly-command-tool registration wrapper passes the texts through', () => {
  const register = registerReadonlyCommandTool({
    requested: true,
    access: 'all_except_denied',
    authorization: { permissionRevision: 'r1', allowsRead: () => true },
    workspaceRoot: '/tmp',
    processSandboxOptions: {},
    authorizeCurrent: async () => ({ status: 'ready', value: { permissionRevision: 'r1', allowsRead: () => true } }),
    texts: changed,
  });
  const tool = register!({} as never);
  expect(tool.description).toBe('PC2-W changed run_readonly_command description');
  expect(schemaOf(tool).properties['command']!.description).toBe('PC2-W changed command parameter');
});

it('PC2-W-readonly-command-tool default texts and explicit platform texts match the hand-written SHT-1 specification', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definition()))).toBe(baseline);
  expect(JSON.stringify(specification(definition(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definition())).toEqual(specification(definition(PLATFORM_PROMPT_PACK_V1.tools)));
});
