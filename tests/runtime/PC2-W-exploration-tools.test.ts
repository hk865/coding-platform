/** PC-2 row PC-24 (W): `createExplorationTools` takes the platform tool texts. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createExplorationTools } from '../../src/core/agent-runtime/exploration-tools.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };
type JsonSchema = { properties: Record<string, { description?: string }> };

const definitions = (texts?: Texts): ToolDefinition[] => createExplorationTools({ deniedPrefixes: [] } as never, {
  includeReadSource: true,
  projectSource: { mode: 'frozen', access: {} as never },
  ...(texts === undefined ? {} : { texts }),
}).tools;
const specification = (tools: ToolDefinition[]) => tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) }));

/**
 * The `pc1-final` specification, one hand-written JSON literal. Copied by hand
 * from `git show pc1-final:src/core/agent-runtime/exploration-tools.ts` (schema shape,
 * key order, constraints) and
 * `git show pc1-final:src/contracts/prompts/platform-pack.generated.ts`
 * (every description and parameter text).
 */
const DEFAULT_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "read_source",
    "description": "Read a bounded source range within the pinned candidate source. Paths excluded from the candidate are unavailable. Returns the full-file digest and exact line range; use further ranges when truncated.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "startLine": {
          "default": 1,
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "maxLines": {
          "default": 150,
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        }
      },
      "required": [
        "path",
        "startLine",
        "maxLines"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "cpp_index",
    "description": "Query C/C++ project symbols, definitions, references, includes and static call candidates with libclang 18 and a required compile_commands.json. Compiler commands never execute; unknown flags and external include paths return explicit gaps. Only permission-filtered workspace files are exposed through a redirect-only VFS. One-based UTF-16 coordinates, source digests and analyzer identity accompany partial semantic results. In an observation, file-level edges come from a static C/C++ include scan only: runtime-only links are not edges, while system headers and git-ignored files are unresolved or absent. C/C++ is read for one target platform (x86_64-pc-linux-gnu when the database names none).",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "enum": [
            "symbols",
            "definitions",
            "references",
            "imports",
            "calls"
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
        },
        "expectedSnapshot": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "limit": {
          "default": 100,
          "type": "integer",
          "minimum": 1,
          "maximum": 200
        }
      },
      "required": [
        "operation",
        "limit"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "python_index",
    "description": "Query readable Python project symbols, definitions, references, imports and static call candidates using Jedi on an isolated source snapshot. Includes source digests, commit and unresolved relations. Workspace pyrightconfig.json, pyproject.toml and setup.cfg import roots and readable .py/.pyi dependencies are parsed as data. Source and config changes invalidate results. Project code never executes; external interpreter environments and complete dynamic call graphs are not covered. In an observation, file-level edges come from a static Python import scan only: runtime-only links are not edges, while the standard library, external packages and git-ignored files are unresolved or absent.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "enum": [
            "symbols",
            "definitions",
            "references",
            "imports",
            "calls"
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
        },
        "expectedSnapshot": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "limit": {
          "default": 100,
          "type": "integer",
          "minimum": 1,
          "maximum": 200
        }
      },
      "required": [
        "operation",
        "limit"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "project_source",
    "description": "Read exact source materials through the frozen capture protocol. Actions: capture (one bounded capture; provider defaults to typescript, or text for a strict readable regular UTF-8/no-NUL text scope selected by prefix; optional configPath/prefix and optional previous capture for explicit changes; the trusted workspace root/revision/identity always come from the host, never from arguments), query (page a frozen capture with an opaque cursor: null on the first page, then the returned nextCursor; limit 1-200, default 100; paths lists only the files this capture retained, text is a literal line search with original line/UTF-16 columns and complete excerpts; semantic kinds are available only for a typescript capture), read (one exact file, at most 8192 bytes, either version working_tree for the current file, version capture for the exact frozen content of a retained capture, or version git with a full 40/64 lowercase commit id for one exact historical blob; a file outside the declared scope is refused rather than reported absent), compare (same-scope content diff of two captures: added/deleted/modified plus renamed only when one digest occurs exactly once in each complete manifest, marked identical_content and never a business identity claim; or two full Git commit ids with an optional prefix, compared by authorized regular-file blob id and mode; or one full Git commit id against one bounded current-working-tree observation of authorized regular UTF-8/no-NUL text, compared by raw-byte digest and owner-executable mode in either direction with an optional prefix and currentness not_rechecked; add duplicates: true to list candidates from that same call's after-side material — a new top-level definition, or a new string literal of at least 40 code points, that occurs elsewhere in the after pool — with two locations each and exact scanned/skipped counts reported apart from truncation (candidates only; the tool never judges whether two pieces are one rule); never by a ref or shell expression), verify (re-read the real scope now and confirm whether the capture still matches; a point-in-time answer, not a future guarantee), release (drop the capture when done). Coverage and change lists are returned as exact counts with at most five preview items of at most 160 code points each and an explicit truncated flag; the complete internal material is retained untrimmed. Pages are marked captured_source/not_rechecked unless verify says otherwise; captures cover only their declared scope (not the whole worktree) and a successful capture is not acceptance of the code.",
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
            },
            "duplicates": {
              "type": "boolean",
              "const": true
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
  },
  {
    "name": "code_index",
    "description": "Query TS/JS declarations, definitions or semantic references within explicit readable files. Coordinates are one-based UTF-16. Returns source digests and partial coverage; no project config or external dependencies. Not a complete call graph. Use source_excerpt with a returned digest to fetch material.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "paths": {
          "minItems": 1,
          "maxItems": 64,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1024
          }
        },
        "operation": {
          "type": "string",
          "enum": [
            "symbols",
            "definitions",
            "references"
          ]
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
        },
        "expectedSnapshot": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "limit": {
          "default": 100,
          "type": "integer",
          "minimum": 1,
          "maximum": 200
        }
      },
      "required": [
        "paths",
        "operation",
        "limit"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "source_excerpt",
    "description": "Read a bounded source range at an exact content digest from code_index or symbols. Returns stale if content changed; never silently substitutes newer source.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "expectedDigest": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "startLine": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "endLine": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "path",
        "expectedDigest",
        "startLine",
        "endLine"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "list_files",
    "description": "List readable workspace file paths with bounded pagination. Includes installed/generated files; skips denied paths and symbolic links. No source execution.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "prefix": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "description": "Workspace-relative directory to enumerate recursively, not a file. Omit or use a single dot for the workspace root."
        },
        "offset": {
          "default": 0,
          "type": "integer",
          "minimum": 0,
          "maximum": 20000
        },
        "limit": {
          "default": 100,
          "type": "integer",
          "minimum": 1,
          "maximum": 300
        }
      },
      "required": [
        "offset",
        "limit"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "search",
    "description": "Search literal text in workspace source without running shell commands. Returns matching lines with file content digests; bounded files/results and explicit skipped coverage. Use paths to narrow a query.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "paths": {
          "minItems": 1,
          "maxItems": 32,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1024
          }
        },
        "prefix": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "description": "Workspace-relative directory to search recursively, not a file. Omit or use a single dot for the workspace root. Use paths for individual search files."
        },
        "maxResults": {
          "default": 40,
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "maxFiles": {
          "default": 200,
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        }
      },
      "required": [
        "query",
        "maxResults",
        "maxFiles"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "symbols",
    "description": "Parse a file into declarations, imports and syntactic call sites using TypeScript/JavaScript AST or Python AST. Does not execute project code or resolve runtime behavior. Unsupported languages explicitly return text fallback.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  }
];

const changedDescriptions = {
  read_source: 'PC2-W changed read_source description',
  cpp_index: 'PC2-W changed cpp_index description',
  python_index: 'PC2-W changed python_index description',
  project_source: 'PC2-W changed project_source through exploration description',
  code_index: 'PC2-W changed code_index description',
  source_excerpt: 'PC2-W changed source_excerpt description',
  list_files: 'PC2-W changed list_files description',
  search: 'PC2-W changed search description',
  symbols: 'PC2-W changed symbols description',
} as const;
const changed: Texts = {
  read_source: { description: changedDescriptions.read_source, parameters: {} },
  cpp_index: { description: changedDescriptions.cpp_index, parameters: {} },
  python_index: { description: changedDescriptions.python_index, parameters: {} },
  project_source: { description: changedDescriptions.project_source, parameters: {} },
  code_index: { description: changedDescriptions.code_index, parameters: {} },
  source_excerpt: { description: changedDescriptions.source_excerpt, parameters: {} },
  list_files: {
    description: changedDescriptions.list_files,
    parameters: { ...PLATFORM_PROMPT_PACK_V1.tools['list_files']!.parameters, prefix: 'PC2-W changed list_files prefix parameter' },
  },
  search: {
    description: changedDescriptions.search,
    parameters: { ...PLATFORM_PROMPT_PACK_V1.tools['search']!.parameters, prefix: 'PC2-W changed search prefix parameter' },
  },
  symbols: { description: changedDescriptions.symbols, parameters: {} },
};

it('PC2-W-exploration-tools carries all changed descriptions and both prefix parameter texts', () => {
  const tools = definitions(changed);
  expect(Object.fromEntries(tools.map(tool => [tool.name, tool.description]))).toEqual(changedDescriptions);
  const schemaOf = (name: string) => z.toJSONSchema(tools.find(tool => tool.name === name)!.inputSchema) as unknown as JsonSchema;
  expect(schemaOf('list_files').properties['prefix']!.description).toBe('PC2-W changed list_files prefix parameter');
  expect(schemaOf('search').properties['prefix']!.description).toBe('PC2-W changed search prefix parameter');
});

it('PC2-W-exploration-tools falls back per tool and hands texts to the project-source sub-factory', () => {
  const tools = definitions({ list_files: changed['list_files']!, project_source: changed['project_source']! });
  expect(tools.find(tool => tool.name === 'list_files')?.description).toBe('PC2-W changed list_files description');
  expect(tools.find(tool => tool.name === 'project_source')?.description).toBe('PC2-W changed project_source through exploration description');
  for (const name of Object.keys(changedDescriptions)) {
    if (name === 'list_files' || name === 'project_source') continue;
    const actual = specification(tools).find(tool => tool.name === name)!;
    const expected = DEFAULT_SPECIFICATION.find(tool => tool.name === name)!;
    expect(actual.description).toBe(expected.description);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  }
});

it('PC2-W-exploration-tools default texts and explicit platform texts match the hand-written pc1-final specification', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definitions()))).toBe(baseline);
  expect(JSON.stringify(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definitions())).toEqual(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)));
});
