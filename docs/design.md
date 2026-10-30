# Tool documentation without changing execution

An agent may have dozens of tools while needing only a few of their complex argument structures. This plugin changes the **documentation the model receives**, not which tools can execute.

The host owns tool registration and permissions. DSH owns the Agent, conversation history, system prompt, PTC subprocess, and argument validation. This plugin owns the SDK text it returns from `system-prompt/assemble` and the `tool_help` documentation function.

## One request through the system

1. The native system-prompt service constructs an assembly containing a `tools:sdk` section.
2. The plugin resolves visible tool definitions in the current Agent scope. Names in `alwaysInline` keep complete inputs. For other tools, selective presentation compares the UTF-8 byte length of each serialized input schema with `deferSchemaBytes`.
3. Schemas below that threshold remain complete. Larger schemas become top-level signatures: property names, types, and required properties remain; nested objects, enums and validation details need documentation lookup. Tool descriptions and output types remain visible.
4. The model requests `tool_help` for exact names, or for members of a configured capability group. The function returns complete original metadata. The agent program must print or return those definitions for the model to read them in its next step.
5. DSH records that tool result in its ordinary history. The next SDK assembly is unchanged while the underlying registry and scope are unchanged.
6. A subsequent PTC program calls the original tool. Native argument and execution checks apply even if the model skips documentation lookup or supplies incorrect arguments.

No tool is activated by `tool_help`. There is no persisted selection list, special checkpoint, or separate permission state to recover. A resumed conversation can reuse documentation still present in its history. If compaction removes it, the model can request it again.

## Core code

[`src/tool-docs.ts`](../src/tool-docs.ts) registers `tool_help` and handles `system-prompt/assemble`. It preserves the native assembly except for the one `tools:sdk` section. The native callable definitions are untouched.

[`src/tool-signature.ts`](../src/tool-signature.ts) constructs selective parameter declarations. It deliberately marks incomplete structures as open rather than inventing nested properties. The SDK text tells the model to read full definitions before constructing complex arguments.

[`src/catalog-schema.ts`](../src/catalog-schema.ts) and [`src/sdk-schema.ts`](../src/sdk-schema.ts) adapt JSON Schema to the vocabulary accepted by the native SDK renderer. [`src/fingerprint.ts`](../src/fingerprint.ts) hashes canonical metadata for pagination and optional curated descriptions.

Three explicit presentation settings are available:

| `presentation` | Input documentation |
| --- | --- |
| `full` | Complete schemas; the experimental baseline |
| `selective` | Complete small schemas and `alwaysInline` tools; top-level signatures for other large schemas |
| `catalog` | Complete inputs for `alwaysInline` tools and generic argument objects for other business tools |

Set `presentation` explicitly. The source default is `catalog`. The benchmark sets it to the selected arm and uses `deferSchemaBytes: 1024`.

`alwaysInline` defaults to `[]` and accepts unique, exact registered business tool names. It overrides deferral in both `selective` and `catalog`; `full` already shows complete inputs. Names hidden from the calling Agent or absent from its registry remain absent. The list does not register or activate tools, grant access, change their validators, or keep a per-session loading state. The reserved `run_code` and `tool_help` names are rejected.

A host chooses the list before execution. The recorded evaluation keeps `mcp__excel__format_range` and `mcp__excel__set_sheet_layout` complete in the candidate; the baseline already exposes all inputs. This is a static host configuration, not per-query routing.

## Complete, scoped documentation

`tool_help` takes `names`, `toolsets`, and optional continuation fields `offset` and `snapshot`. It reads each definition again in the calling Agent's current scope. Hidden or absent tools fail the query.

A result contains `tools`, `matchedCount`, `offset`, and `nextQuery`. A page ends only between complete tool definitions. If even one definition cannot fit in `maxDocumentBytes`, the call reports an error instead of truncating the schema. The defaults allow eight tools and 24,000 UTF-8 bytes per page.

`nextQuery.snapshot` hashes the ordered names and metadata fingerprints for that query. The next page must resolve to the same metadata. A registration change requires restarting the lookup. This protects documentation consistency; it does not lock a later execution to that definition. The host must provide any stronger execution-version guarantee it needs.

An optional description override is used only if its stored fingerprint matches the current metadata. Otherwise the original description is displayed. Capability groups contain exact names and descriptions; they are not a retrieval model or an authorization rule.

## Return values and MCP

MCP results have a canonical envelope, including `content` and optional `structuredContent`. Tools can also declare the shape of `structuredContent`. The included MCP adapter preserves that declaration as documentation so the SDK can describe returned data accurately. The original result validator remains in place.

[`patches/mcp-output-documentation.patch`](../patches/mcp-output-documentation.patch) is applied to a local copy of the pinned MCP client during build. It does not modify the DSH checkout. Both experimental arms use this same adapter and the same return-value instructions.

## Boundaries

- Requires the pinned native TypeScript PTC runtime and an Agent-scoped assembly. Other presentation modes fail explicitly.
- Another `tool_search`, `load_tool`, or `load_toolsets` presentation plugin must not be active in the same scope.
- A host service remains responsible for trusted tool descriptions, authorization, cancellation, execution isolation and external side effects.
- Documentation consumes ordinary context and can be compressed away. Large definitions can require multiple pages and another model step.
- A stable SDK improves the opportunity for prefix reuse. The provider determines actual cache hits. The measured candidate still used more model calls.
