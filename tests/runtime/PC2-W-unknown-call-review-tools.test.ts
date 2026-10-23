/** PC-2 row PC-24 (W): `createUnknownCallReviewTools` takes the platform tool texts. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createUnknownCallReviewTools } from '../../src/core/agent-runtime/unknown-call-review-tools.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };
type JsonSchema = { properties: Record<string, { description?: string }> };

const definitions = (phase: 'review' | 'proposal', texts?: Texts): ToolDefinition[] =>
  createUnknownCallReviewTools({ reviews: {} as never, context: { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {}, signal: new AbortController().signal } as never,
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' }, requestIdForCall: () => 'r', phase,
    ...(texts === undefined ? {} : { texts }) }).create({} as never);
const specification = (tools: ToolDefinition[]) => tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) }));
const schemaOf = (tool: ToolDefinition) => z.toJSONSchema(tool.inputSchema) as unknown as JsonSchema;

/**
 * The `pc1-final` specification, one hand-written JSON literal. Copied by hand
 * from `git show pc1-final:src/core/agent-runtime/unknown-call-review-tools.ts` (schema shape,
 * key order, constraints) and
 * `git show pc1-final:src/contracts/prompts/platform-pack.generated.ts`
 * (every description and parameter text).
 */
const DEFAULT_REVIEW_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "record_unknown_call_review",
    "description": "Record one review-round conclusion for a process item, given by its alias #n. State whether the command finished (done / not_done / partial / undetermined) and whether it could have caused the Host crash (unlikely / possible / undetermined), each with its evidence. The reviewed record and this review round are bound by the platform; you cannot choose them. A new call may overwrite the same item conclusion until the round ends; the last commit wins.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "item": {
          "type": "integer",
          "minimum": 1,
          "maximum": 32,
          "description": "The alias #n of the process item being reviewed; never a Kernel callId"
        },
        "verdict": {
          "type": "string",
          "enum": [
            "done",
            "not_done",
            "partial",
            "undetermined"
          ],
          "description": "Whether the reviewed command finished"
        },
        "evidence": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "The evidence for the verdict, 1-2000 characters"
        },
        "crashSuspicion": {
          "type": "object",
          "properties": {
            "verdict": {
              "type": "string",
              "enum": [
                "unlikely",
                "possible",
                "undetermined"
              ]
            },
            "evidence": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            }
          },
          "required": [
            "verdict",
            "evidence"
          ],
          "additionalProperties": false,
          "description": "The crash self-check: verdict and its evidence, 1-1000 characters"
        }
      },
      "required": [
        "item",
        "verdict",
        "evidence",
        "crashSuspicion"
      ],
      "additionalProperties": false
    }
  }
];
const DEFAULT_PROPOSAL_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "propose_safer_method",
    "description": "Propose one safer replacement command for a proposalTargets (process) item, given by its alias #n. The command is run exactly as written, never the original; it is 1-4000 UTF-8 bytes, the optional cwd is at most 512 bytes and the rationale is 1-2000 characters. The reviewed record and this proposal round are bound by the platform; you cannot choose them. A later call for the same item replaces the earlier proposal until the round ends. If the result says capacity, shorten the command, the directory or the rationale.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "item": {
          "type": "integer",
          "minimum": 1,
          "maximum": 32,
          "description": "The alias #n of a proposalTargets (process) item; never a Kernel callId"
        },
        "command": {
          "type": "string",
          "minLength": 1,
          "description": "The replacement command, run exactly as written; 1-4000 UTF-8 bytes"
        },
        "cwd": {
          "description": "Optional working directory, at most 512 UTF-8 bytes; absent renders as .",
          "type": "string"
        },
        "rationale": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "Why this replacement is safer; 1-2000 characters"
        }
      },
      "required": [
        "item",
        "command",
        "rationale"
      ],
      "additionalProperties": false
    }
  }
];

const changedDescriptions = {
  record_unknown_call_review: 'PC2-W changed record_unknown_call_review description',
  propose_safer_method: 'PC2-W changed propose_safer_method description',
} as const;
const changed: Texts = {
  record_unknown_call_review: {
    description: changedDescriptions.record_unknown_call_review,
    parameters: { ...PLATFORM_PROMPT_PACK_V1.tools['record_unknown_call_review']!.parameters, item: 'PC2-W changed review item parameter' },
  },
  propose_safer_method: {
    description: changedDescriptions.propose_safer_method,
    parameters: { ...PLATFORM_PROMPT_PACK_V1.tools['propose_safer_method']!.parameters, rationale: 'PC2-W changed proposal rationale parameter' },
  },
};

it('PC2-W-unknown-call-review-tools carries both changed descriptions and both parameter texts', () => {
  const review = definitions('review', changed)[0]!;
  const proposal = definitions('proposal', changed)[0]!;
  expect(review.description).toBe(changedDescriptions.record_unknown_call_review);
  expect(proposal.description).toBe(changedDescriptions.propose_safer_method);
  expect(schemaOf(review).properties['item']!.description).toBe('PC2-W changed review item parameter');
  expect(schemaOf(proposal).properties['rationale']!.description).toBe('PC2-W changed proposal rationale parameter');
});

it('PC2-W-unknown-call-review-tools falls back to the hand-written review specification when only the disabled sibling text is given', () => {
  const tools = definitions('review', { propose_safer_method: changed['propose_safer_method']! });
  expect(tools[0]!.description).toBe(DEFAULT_REVIEW_SPECIFICATION[0]!.description);
  expect(JSON.stringify(specification(tools))).toBe(JSON.stringify(DEFAULT_REVIEW_SPECIFICATION));
});

it('PC2-W-unknown-call-review-tools default texts and explicit platform texts match the hand-written pc1-final specification', () => {
  for (const phase of ['review', 'proposal'] as const) {
    const baseline = JSON.stringify(phase === 'review' ? DEFAULT_REVIEW_SPECIFICATION : DEFAULT_PROPOSAL_SPECIFICATION);
    expect(JSON.stringify(specification(definitions(phase)))).toBe(baseline);
    expect(JSON.stringify(specification(definitions(phase, PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
    expect(specification(definitions(phase))).toEqual(specification(definitions(phase, PLATFORM_PROMPT_PACK_V1.tools)));
  }
});
