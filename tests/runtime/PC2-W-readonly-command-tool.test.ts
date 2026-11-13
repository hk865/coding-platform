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
 * regenerated platform pack (every description and parameter text). RED today:
 * the tree still carries the old description and the 1000–120000 range; GREEN
 * after SHT-1 removes the range and regenerates the pack.
 */
const DEFAULT_SPECIFICATION: ToolSpecification = {
  "name": "run_readonly_command",
  "description": "Run a non-interactive bash command in a read-only bubblewrap sandbox. When the platform proxy is on (HTTP_PROXY is set in the sandbox), HTTP and HTTPS reach the public internet through it; the host machine, loopback and private networks are never reachable, and ssh and other non-HTTP connections do not work. The workspace is mounted read-only at /workspace; Host-denied paths are hidden (for example .env, credentials and the Host hidden prefixes), and ordinary .git is readable but read-only. Git can read history and diffs, but any operation that writes .git (for example commit) fails with git's own error, and a linked worktree (.git is a file) has no usable git. Commands are not stopped by time (bound one yourself with `timeout <seconds> <command>`); a cancellation replaces the captured output with empty output. Only paths under the workspace root are visible; deeper files with a protected basename are still readable, exactly as with the read tool. There is no host-shell fallback: when bubblewrap or the read-only mounts are unavailable the call fails.",
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "minLength": 1,
        "description": "Non-interactive bash command to run in the read-only sandbox"
      },
      "cwd": {
        "description": "Workspace-relative working directory; defaults to the workspace root",
        "type": "string"
      },
      "timeoutMs": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991,
        "description": "Expected duration in milliseconds; the platform never stops the command at this time and shows a command running past it to the person. Defaults to 600000."
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
