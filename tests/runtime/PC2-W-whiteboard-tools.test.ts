/** PC-2 row PC-24 (W): `createWhiteboardTools` takes the platform tool texts; each whiteboard tool reads its own pin parameters (D8). */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createWhiteboardTools } from '../../src/core/agent-runtime/whiteboard-tools.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };
type JsonSchema = {
  properties: Record<string, {
    description?: string;
    items?: { properties?: Record<string, { description?: string }> };
  }>;
};

const definitions = (texts?: Texts): ToolDefinition[] =>
  createWhiteboardTools({ plans: {} as never, context: { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {}, signal: new AbortController().signal } as never,
    goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, requestIdForCall: () => 'r', ...(texts === undefined ? {} : { texts }) }).create({} as never);
const specification = (tools: ToolDefinition[]) => tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) }));
const schemaOf = (tools: ToolDefinition[], name: string) =>
  z.toJSONSchema(tools.find(tool => tool.name === name)!.inputSchema) as unknown as JsonSchema;

/**
 * The `pc1-final` specification, one hand-written JSON literal. Copied by hand
 * from `git show pc1-final:src/core/agent-runtime/whiteboard-tools.ts` (schema shape,
 * key order, constraints) and
 * `git show pc1-final:src/contracts/prompts/platform-pack.generated.ts`
 * (every description and parameter text).
 */
const DEFAULT_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "query_task_graph",
    "description": "Read the current Plan task graph for the bound Goal. Optional planRef selects a PlanRevision; optional atLeastCursor is a source cursor.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "planRef": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "PlanRevision"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "planId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "planId"
          ],
          "additionalProperties": false
        },
        "atLeastCursor": {
          "type": "string",
          "minLength": 1
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "query_ready_tasks",
    "description": "Read the ready candidate tasks for the bound Goal. includeBlocked selects blocked rows too; roleIds filters by Role; page paginates.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "roleIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "includeBlocked": {
          "type": "boolean"
        },
        "page": {
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer",
              "minimum": 1,
              "maximum": 200
            },
            "cursor": {
              "type": "string",
              "minLength": 1
            },
            "atLeastCursor": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "limit"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "includeBlocked",
        "page"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "propose_future_plan",
    "description": "Propose a v2 future Plan revision for the bound Goal. basedOn must be the current accepted PlanRevision; expected carries the exact W1 pins you saw. A task with execution history changes only its disposition (listed in reason.affectedTaskIds); to change its scope, supersede it and add a new carrier. The plan service owns all plan and future-only rules.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "basedOn": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "PlanRevision"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "planId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "planId"
          ],
          "additionalProperties": false,
          "description": "The current accepted PlanRevisionRef this v2 future revision is based on; never null for an Agent proposal."
        },
        "draft": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {},
          "description": "PlanRevisionDraft (schemaVersion: 2); build it from the current Plan returned by query_task_graph and edit only what the revision needs.\nTop level: planId; planRevision; goalId (the bound Goal's goalId); stages: {stageId,title,description?}[]; tasks: RuntimeTask[]; assignments?: {taskId,role,instruction}[]; obligations: {obligationId,title,requirementLevel,taskIds,verificationRequirements:{requirementId,requirementLevel,kind,description}[]}[]; taskHierarchy: {parentOf:{parentTaskId,childTaskId}[]}; executionDag: {dependsOn:{taskId,dependsOnId,requires:{kind:'output-contract'|'artifact'|'decision'|'environment-revision'|'gate-result',label}}[]}; taskRelations?: {fromTaskId,toTaskId,kind:'coordination'|'expected_dependency',note}[].\nRuntimeTask: {taskId,stageId?,title,requirementLevel:'required'|'optional',taskKind:'work'|'gate',disposition:'active'|'deferred'|'cancelled'|'superseded',phase:'pending'|'ready'|'running'|'verifying'|'blocked'|'satisfied'|'failed',scope:{kind:'goal'}|{kind:'stage',stageId}|{kind:'module',stageId,moduleRef},executionIntent?:'plan_only'|'request_execution',replacedByTaskId?}. executionIntent is the adopted orchestration intent only: 'plan_only' records the intent now (assignment, obligations/acceptance, dependencies and exact inputs may all be omitted; the node is never claimable even after an assignment is later added); 'request_execution' asks this node to run and must already carry exactly one legal role/instruction assignment (acceptance may still be missing). It is not a Role grant, budget, ready signal, Run state or completion judgement. State the intent explicitly on every NEW work node; when editing an existing node that already carries executionIntent, preserve it or explicitly change 'plan_only' to 'request_execution' — omitting the field is invalid and cannot silently activate a node.\nA task that already has a Run, a lease or a satisfied reduction keeps its execution definition forever (title, phase, scope, executionIntent, assignment, inputs and the obligations whose taskIds list it): only its disposition and replacedByTaskId may change, and only once all its Runs ended and its lease is released; list every such task in reason.affectedTaskIds. To change its scope or obligation, set it 'superseded' (replacedByTaskId: the new task) and add a new task as another carrier of the same obligations, keeping the old task in their taskIds. Every required obligation keeps at least one active required carrier, so deferring or cancelling its only carrier needs a new carrier in the same revision. You cannot change your own running task, a task a person paused or cancelled, or add a carrier to an obligation whose active work a person stopped.\nCopy the current Plan's known fields, then drop accepted/compiler metadata that is not part of a draft: ref, revision, goalRef, acceptedAt, effectiveCompletionPolicy, effectiveArchitectureBaseline, taskStateBasis, dispositionRecord; omit origin/reviewAdmissionProtocol unless reproducing them is required. The plan service owns semantic validation (explicit-intent branches, assignment completeness, obligations, DAG/hierarchy legality, future-only rules); this adapter does not restate it."
        },
        "reason": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {},
          "description": "PlanChangeReason: { text, sources, affectedTaskIds? }. affectedTaskIds: the taskIds this revision changes (at most 200, each a task of the draft); required for every task with execution history whose disposition changes."
        },
        "expected": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "ref": {
                "anyOf": [
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "Project"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "Workspace"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "workspaceId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "workspaceId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "Goal"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "goalId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "goalId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "PlanRevision"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "planId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "planId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "PlanProposal"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "workspaceId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "proposalId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "workspaceId",
                      "proposalId"
                    ],
                    "additionalProperties": false
                  }
                ],
                "description": "One of the five W1 caller-visible refs: Project | Workspace | Goal | PlanRevision | PlanProposal."
              },
              "revision": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991,
                "description": "The exact version the caller saw for `ref`; the plan service rejects a mismatch with the current record."
              }
            },
            "required": [
              "ref",
              "revision"
            ],
            "additionalProperties": false
          },
          "description": "The exact W1 version pins the caller saw; omit a pin rather than guessing a fresh revision."
        }
      },
      "required": [
        "basedOn",
        "draft",
        "reason",
        "expected"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "apply_future_plan",
    "description": "Adopt your own W2 candidate proposal for the bound Goal. decisionRefs are supplied by the platform. Pass acknowledgementRef only when the user answered a card for this candidate; the plan owner re-reads that formal answer and derives the decision source itself. Only a real committed plan revision is reported as success.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "proposalRef": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "PlanProposal"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "workspaceId": {
              "type": "string",
              "minLength": 1
            },
            "proposalId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "workspaceId",
            "proposalId"
          ],
          "additionalProperties": false,
          "description": "Your own candidate_v2 proposal ref; the plan service refuses another Run/author candidate."
        },
        "expectedProposalRevision": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991,
          "description": "The exact revision of proposalRef, as read."
        },
        "expected": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "ref": {
                "anyOf": [
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "Project"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "Workspace"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "workspaceId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "workspaceId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "Goal"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "goalId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "goalId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "PlanRevision"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "planId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "planId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "PlanProposal"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "workspaceId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "proposalId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "workspaceId",
                      "proposalId"
                    ],
                    "additionalProperties": false
                  }
                ],
                "description": "One of the five W1 caller-visible refs: Project | Workspace | Goal | PlanRevision | PlanProposal."
              },
              "revision": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991,
                "description": "The exact version the caller saw for `ref`; the plan service rejects a mismatch with the current record."
              }
            },
            "required": [
              "ref",
              "revision"
            ],
            "additionalProperties": false
          },
          "description": "The exact W1 version pins the caller saw; omit a pin rather than guessing a fresh revision."
        },
        "acknowledgementRef": {
          "description": "The user answer message this adoption is attributed to, when the user answered a card for this candidate. Attribution only; the plan owner re-reads the formal answer and derives the decision source itself. Omit it when the adoption is not attributed to a user answer.",
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "SessionMessage"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "workspaceId": {
              "type": "string",
              "minLength": 1
            },
            "messageId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "workspaceId",
            "messageId"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "proposalRef",
        "expectedProposalRevision",
        "expected"
      ],
      "additionalProperties": false
    }
  }
];

const changedDescriptions = {
  query_task_graph: 'PC2-W changed query_task_graph description',
  query_ready_tasks: 'PC2-W changed query_ready_tasks description',
  propose_future_plan: 'PC2-W changed propose_future_plan description',
  apply_future_plan: 'PC2-W changed apply_future_plan description',
} as const;
const changed: Texts = {
  query_task_graph: { description: changedDescriptions.query_task_graph, parameters: {} },
  query_ready_tasks: { description: changedDescriptions.query_ready_tasks, parameters: {} },
  propose_future_plan: {
    description: changedDescriptions.propose_future_plan,
    parameters: {
      ...PLATFORM_PROMPT_PACK_V1.tools['propose_future_plan']!.parameters,
      basedOn: 'PC2-W changed propose basedOn parameter',
      'expected[].ref': 'PC2-W changed propose expected ref parameter',
      'expected[].revision': 'PC2-W changed propose expected revision parameter',
    },
  },
  apply_future_plan: {
    description: changedDescriptions.apply_future_plan,
    parameters: {
      ...PLATFORM_PROMPT_PACK_V1.tools['apply_future_plan']!.parameters,
      proposalRef: 'PC2-W changed apply proposalRef parameter',
      'expected[].ref': 'PC2-W changed apply expected ref parameter',
      'expected[].revision': 'PC2-W changed apply expected revision parameter',
    },
  },
};

it('PC2-W-whiteboard-tools carries all four changed descriptions and each tool its own parameter texts', () => {
  const tools = definitions(changed);
  expect(Object.fromEntries(tools.map(tool => [tool.name, tool.description]))).toEqual(changedDescriptions);
  const propose = schemaOf(tools, 'propose_future_plan');
  expect(propose.properties['basedOn']!.description).toBe('PC2-W changed propose basedOn parameter');
  expect(propose.properties['expected']!.items!.properties!['ref']!.description).toBe('PC2-W changed propose expected ref parameter');
  expect(propose.properties['expected']!.items!.properties!['revision']!.description).toBe('PC2-W changed propose expected revision parameter');
  const apply = schemaOf(tools, 'apply_future_plan');
  expect(apply.properties['proposalRef']!.description).toBe('PC2-W changed apply proposalRef parameter');
  expect(apply.properties['expected']!.items!.properties!['ref']!.description).toBe('PC2-W changed apply expected ref parameter');
  expect(apply.properties['expected']!.items!.properties!['revision']!.description).toBe('PC2-W changed apply expected revision parameter');
});

it('PC2-W-whiteboard-tools falls back per tool to the hand-written platform specification', () => {
  const tools = definitions({ query_task_graph: changed['query_task_graph']! });
  expect(tools.find(tool => tool.name === 'query_task_graph')?.description).toBe('PC2-W changed query_task_graph description');
  for (const name of ['query_ready_tasks', 'propose_future_plan', 'apply_future_plan']) {
    const actual = specification(tools).find(tool => tool.name === name)!;
    const expected = DEFAULT_SPECIFICATION.find(tool => tool.name === name)!;
    expect(actual.description).toBe(expected.description);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  }
});

it('PC2-W-whiteboard-tools default keeps the moved whiteboard pin parameter descriptions', () => {
  const tools = definitions();
  expect(schemaOf(tools, 'propose_future_plan').properties['expected']!.items!.properties!['ref']!.description)
    .toBe('One of the five W1 caller-visible refs: Project | Workspace | Goal | PlanRevision | PlanProposal.');
  expect(schemaOf(tools, 'propose_future_plan').properties['expected']!.items!.properties!['revision']!.description)
    .toBe('The exact version the caller saw for `ref`; the plan service rejects a mismatch with the current record.');
  expect(schemaOf(tools, 'apply_future_plan').properties['expected']!.items!.properties!['ref']!.description)
    .toBe('One of the five W1 caller-visible refs: Project | Workspace | Goal | PlanRevision | PlanProposal.');
  expect(schemaOf(tools, 'apply_future_plan').properties['expected']!.items!.properties!['revision']!.description)
    .toBe('The exact version the caller saw for `ref`; the plan service rejects a mismatch with the current record.');
});

it('PC2-W-whiteboard-tools default texts and explicit platform texts match the hand-written pc1-final specification', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definitions()))).toBe(baseline);
  expect(JSON.stringify(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definitions())).toEqual(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)));
});
