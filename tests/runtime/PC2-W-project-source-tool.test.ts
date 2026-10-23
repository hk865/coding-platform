/** PC-2 row PC-24 (W): `createProjectSourceTool` takes the platform tool texts. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createProjectSourceTool } from '../../src/core/agent-runtime/project-source-tool.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };
const definition = (texts?: Texts): ToolDefinition =>
  createProjectSourceTool({ access: {} as never, requireVisible: () => {}, ...(texts === undefined ? {} : { texts }) });
const specification = (tool: ToolDefinition) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) });

/**
 * The `pc1-final` specification, one hand-written JSON literal. Copied by hand
 * from `git show pc1-final:src/core/agent-runtime/project-source-tool.ts` (schema shape,
 * key order, constraints) and
 * `git show pc1-final:src/contracts/prompts/platform-pack.generated.ts`
 * (every description and parameter text).
 */
const DEFAULT_SPECIFICATION: ToolSpecification = {
  "name": "project_source",
  "description": "Read exact source materials through the frozen capture protocol. Actions: capture (one bounded capture; provider defaults to typescript, or text for a strict readable regular UTF-8/no-NUL text scope selected by prefix; optional configPath/prefix and optional previous capture for explicit changes; the trusted workspace root/revision/identity always come from the host, never from arguments), query (page a frozen capture with an opaque cursor: null on the first page, then the returned nextCursor; limit 1-200, default 100; paths lists only the files this capture retained, text is a literal line search with original line/UTF-16 columns and complete excerpts; semantic kinds are available only for a typescript capture), read (one exact file, at most 8192 bytes, either version working_tree for the current file, version capture for the exact frozen content of a retained capture, or version git with a full 40/64 lowercase commit id for one exact historical blob; a file outside the declared scope is refused rather than reported absent), compare (same-scope content diff of two captures: added/deleted/modified plus renamed only when one digest occurs exactly once in each complete manifest, marked identical_content and never a business identity claim; or two full Git commit ids with an optional prefix, compared by authorized regular-file blob id and mode; or one full Git commit id against one bounded current-working-tree observation of authorized regular UTF-8/no-NUL text, compared by raw-byte digest and owner-executable mode in either direction with an optional prefix and currentness not_rechecked; never by a ref or shell expression), verify (re-read the real scope now and confirm whether the capture still matches; a point-in-time answer, not a future guarantee), release (drop the capture when done). Coverage and change lists are returned as exact counts with at most five preview items of at most 160 code points each and an explicit truncated flag; the complete internal material is retained untrimmed. Pages are marked captured_source/not_rechecked unless verify says otherwise; captures cover only their declared scope (not the whole worktree) and a successful capture is not acceptance of the code.",
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "const": "capture"
          },
          "provider": {
            "type": "string",
            "enum": [
              "typescript",
              "text"
            ]
          },
          "configPath": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1024
          },
          "prefix": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1024
          },
          "previous": {
            "type": "object",
            "properties": {
              "projectId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "workspaceId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "captureId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "workspaceRevision": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              "sourceDigest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "configDigest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "indexVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              }
            },
            "required": [
              "projectId",
              "workspaceId",
              "captureId",
              "workspaceRevision",
              "sourceDigest",
              "configDigest",
              "indexVersion"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "action"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "const": "query"
          },
          "capture": {
            "type": "object",
            "properties": {
              "projectId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "workspaceId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "captureId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "workspaceRevision": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              "sourceDigest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "configDigest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "indexVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              }
            },
            "required": [
              "projectId",
              "workspaceId",
              "captureId",
              "workspaceRevision",
              "sourceDigest",
              "configDigest",
              "indexVersion"
            ],
            "additionalProperties": false
          },
          "query": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "paths"
                  },
                  "prefix": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  }
                },
                "required": [
                  "kind"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "text"
                  },
                  "text": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2048
                  },
                  "caseSensitive": {
                    "type": "boolean"
                  },
                  "prefix": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  }
                },
                "required": [
                  "kind",
                  "text",
                  "caseSensitive"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "symbols"
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  },
                  "prefix": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  }
                },
                "required": [
                  "kind"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "definitions"
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  },
                  "line": {
                    "type": "integer",
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991
                  },
                  "column": {
                    "type": "integer",
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "kind",
                  "path",
                  "line",
                  "column"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "references"
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  },
                  "line": {
                    "type": "integer",
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991
                  },
                  "column": {
                    "type": "integer",
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "kind",
                  "path",
                  "line",
                  "column"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "imports"
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  },
                  "prefix": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  }
                },
                "required": [
                  "kind"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "calls"
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  },
                  "prefix": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024
                  }
                },
                "required": [
                  "kind"
                ],
                "additionalProperties": false
              }
            ]
          },
          "cursor": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 2048
              },
              {
                "type": "null"
              }
            ]
          },
          "limit": {
            "default": 100,
            "type": "integer",
            "minimum": 1,
            "maximum": 200
          }
        },
        "required": [
          "action",
          "capture",
          "query",
          "cursor",
          "limit"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "const": "read"
          },
          "path": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1024
          },
          "maxBytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8192
          },
          "version": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "working_tree"
                  }
                },
                "required": [
                  "kind"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "capture"
                  },
                  "capture": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 512
                      },
                      "workspaceId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 512
                      },
                      "captureId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 512
                      },
                      "workspaceRevision": {
                        "type": "integer",
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991
                      },
                      "sourceDigest": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      },
                      "configDigest": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      },
                      "indexVersion": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 512
                      }
                    },
                    "required": [
                      "projectId",
                      "workspaceId",
                      "captureId",
                      "workspaceRevision",
                      "sourceDigest",
                      "configDigest",
                      "indexVersion"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "kind",
                  "capture"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "git"
                  },
                  "commit": {
                    "type": "string",
                    "pattern": "^(?:[a-f0-9]{40}|[a-f0-9]{64})$"
                  }
                },
                "required": [
                  "kind",
                  "commit"
                ],
                "additionalProperties": false
              }
            ]
          }
        },
        "required": [
          "action",
          "path",
          "maxBytes",
          "version"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "const": "compare"
          },
          "before": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "projectId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  },
                  "workspaceId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  },
                  "captureId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  },
                  "workspaceRevision": {
                    "type": "integer",
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991
                  },
                  "sourceDigest": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{64}$"
                  },
                  "configDigest": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{64}$"
                  },
                  "indexVersion": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  }
                },
                "required": [
                  "projectId",
                  "workspaceId",
                  "captureId",
                  "workspaceRevision",
                  "sourceDigest",
                  "configDigest",
                  "indexVersion"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "git"
                  },
                  "commit": {
                    "type": "string",
                    "pattern": "^(?:[a-f0-9]{40}|[a-f0-9]{64})$"
                  }
                },
                "required": [
                  "kind",
                  "commit"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "working_tree"
                  }
                },
                "required": [
                  "kind"
                ],
                "additionalProperties": false
              }
            ]
          },
          "after": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "projectId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  },
                  "workspaceId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  },
                  "captureId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  },
                  "workspaceRevision": {
                    "type": "integer",
                    "exclusiveMinimum": 0,
                    "maximum": 9007199254740991
                  },
                  "sourceDigest": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{64}$"
                  },
                  "configDigest": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{64}$"
                  },
                  "indexVersion": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512
                  }
                },
                "required": [
                  "projectId",
                  "workspaceId",
                  "captureId",
                  "workspaceRevision",
                  "sourceDigest",
                  "configDigest",
                  "indexVersion"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "git"
                  },
                  "commit": {
                    "type": "string",
                    "pattern": "^(?:[a-f0-9]{40}|[a-f0-9]{64})$"
                  }
                },
                "required": [
                  "kind",
                  "commit"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "working_tree"
                  }
                },
                "required": [
                  "kind"
                ],
                "additionalProperties": false
              }
            ]
          },
          "prefix": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1024
          }
        },
        "required": [
          "action",
          "before",
          "after"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "const": "verify"
          },
          "capture": {
            "type": "object",
            "properties": {
              "projectId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "workspaceId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "captureId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "workspaceRevision": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              "sourceDigest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "configDigest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "indexVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              }
            },
            "required": [
              "projectId",
              "workspaceId",
              "captureId",
              "workspaceRevision",
              "sourceDigest",
              "configDigest",
              "indexVersion"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "action",
          "capture"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "const": "release"
          },
          "capture": {
            "type": "object",
            "properties": {
              "projectId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "workspaceId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "captureId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "workspaceRevision": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              "sourceDigest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "configDigest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "indexVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              }
            },
            "required": [
              "projectId",
              "workspaceId",
              "captureId",
              "workspaceRevision",
              "sourceDigest",
              "configDigest",
              "indexVersion"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "action",
          "capture"
        ],
        "additionalProperties": false
      }
    ]
  }
};

it('PC2-W-project-source-tool carries the changed project_source description', () => {
  const tool = definition({ project_source: { description: 'PC2-W changed project_source description', parameters: {} } });
  expect(tool.description).toBe('PC2-W changed project_source description');
  expect(JSON.stringify(specification(tool))).toContain('PC2-W changed project_source description');
});

it('PC2-W-project-source-tool default texts and explicit platform texts match the hand-written pc1-final specification', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definition()))).toBe(baseline);
  expect(JSON.stringify(specification(definition(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definition())).toEqual(specification(definition(PLATFORM_PROMPT_PACK_V1.tools)));
});
