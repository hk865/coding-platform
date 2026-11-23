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
 * The tool specification: schema shape, key order and constraints are the
 * pc1-final literal; every description and parameter text is read from the
 * current platform pack, the one authority for those strings.
 */
const DEFAULT_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "read_source",
    "description": PLATFORM_PROMPT_PACK_V1.tools['read_source']!.description,
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
    "description": PLATFORM_PROMPT_PACK_V1.tools['cpp_index']!.description,
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
    "description": PLATFORM_PROMPT_PACK_V1.tools['python_index']!.description,
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
    "description": PLATFORM_PROMPT_PACK_V1.tools['project_source']!.description,
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
    "description": PLATFORM_PROMPT_PACK_V1.tools['code_index']!.description,
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
    "description": PLATFORM_PROMPT_PACK_V1.tools['source_excerpt']!.description,
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
    "description": PLATFORM_PROMPT_PACK_V1.tools['list_files']!.description,
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "prefix": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "description": PLATFORM_PROMPT_PACK_V1.tools['list_files']!.parameters['prefix']!
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
    "description": PLATFORM_PROMPT_PACK_V1.tools['search']!.description,
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
          "description": PLATFORM_PROMPT_PACK_V1.tools['search']!.parameters['prefix']!
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
    "description": PLATFORM_PROMPT_PACK_V1.tools['symbols']!.description,
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
