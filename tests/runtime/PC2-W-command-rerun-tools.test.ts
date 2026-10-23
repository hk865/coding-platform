/** PC-2 row PC-24 (W): `createCommandRerunTools` takes the platform tool texts. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createCommandRerunTools } from '../../src/core/agent-runtime/command-rerun-tools.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };
type JsonSchema = { properties: Record<string, { description?: string }> };

const definitions = (texts?: Texts): ToolDefinition[] =>
  createCommandRerunTools({ requests: {} as never, context: { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {}, signal: new AbortController().signal } as never,
    task: { projectId: 'p', goalId: 'g', taskId: 't' }, requestIdForCall: () => 'r', ...(texts === undefined ? {} : { texts }) }).create({} as never);
const specification = (tools: ToolDefinition[]) => tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) }));

/**
 * The `pc1-final` specification, one hand-written JSON literal. Copied by hand
 * from `git show pc1-final:src/core/agent-runtime/command-rerun-tools.ts` (schema shape,
 * key order, constraints) and
 * `git show pc1-final:src/contracts/prompts/platform-pack.generated.ts`
 * (every description and parameter text).
 */
const DEFAULT_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "request_command_rerun",
    "description": "Ask a person to allow one blocked command to run again. Give the exact command and a reason they can read; the platform discovers the blocked alias. If the platform does not recognise your rewrite of a blocked command, name its review run and alias with `rewriteOf`. The result says whether the request is waiting, allowed for one use, refused, or not recognised; it is not the command running.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "command": {
          "type": "string",
          "description": "The exact command you want to run; 1-4000 UTF-8 bytes"
        },
        "reason": {
          "type": "string",
          "description": "Why a person should allow it; 1-2000 code points"
        },
        "rewriteOf": {
          "description": "Only for a rewrite the platform did not recognise",
          "type": "object",
          "properties": {
            "review": {
              "type": "string",
              "description": "The blocked command's UnknownCallReview runId (or its unique 8-character prefix)"
            },
            "alias": {
              "type": "number",
              "description": "The blocked command's alias #n"
            }
          },
          "required": [
            "review",
            "alias"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "command",
        "reason"
      ],
      "additionalProperties": false
    }
  }
];

it('PC2-W-command-rerun-tools carries the changed description and command parameter text', () => {
  const changed: Texts = {
    request_command_rerun: {
      description: 'PC2-W changed request_command_rerun description',
      parameters: { ...PLATFORM_PROMPT_PACK_V1.tools['request_command_rerun']!.parameters, command: 'PC2-W changed command parameter' },
    },
  };
  const tool = definitions(changed)[0]!;
  expect(tool.description).toBe('PC2-W changed request_command_rerun description');
  const schema = z.toJSONSchema(tool.inputSchema) as unknown as JsonSchema;
  expect(schema.properties['command']!.description).toBe('PC2-W changed command parameter');
});

it('PC2-W-command-rerun-tools default texts and explicit platform texts match the hand-written pc1-final specification', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definitions()))).toBe(baseline);
  expect(JSON.stringify(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definitions())).toEqual(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)));
});
