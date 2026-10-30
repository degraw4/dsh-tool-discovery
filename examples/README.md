# Minimal host configuration

After building, create a local Cordis patch using an absolute file URL for this checkout's `lib/tool-docs.mjs`. Replace the example path before using it:

```yaml
- insert:
    - id: tool-documentation
      name: file:///path/to/dsh-tool-discovery/lib/tool-docs.mjs
      config:
        presentation: selective
        deferSchemaBytes: 1024
        alwaysInline: []
        maxToolsPerQuery: 8
        maxDocumentBytes: 24000
        toolsets: []
```

The host must register its business tools and present them through DSH's TypeScript PTC runtime. For the pinned DSH headless profile:

```bash
DSH_TOOLS_MODE=ptc pnpm dsh --profile headless \
  --patch /path/to/tool-documentation.patch.yml --json 'Your task'
```

Run this command from the DSH checkout with your usual provider configuration. This example does not supply credentials, register MCP servers, or configure isolation. The [reference benchmark](../docs/reproduce.md) provides a complete isolated setup with those services.

`toolsets` is optional. Each group has a `name`, `description` and exact `tools` names. [`bench/docs-config.json`](../bench/docs-config.json) shows groups for the benchmark. Group membership does not expand the calling Agent's tool permissions.

To keep frequently used tools' complete parameters in the SDK, set exact public names in `alwaysInline`, for example:

```yaml
alwaysInline:
  - mcp__excel__format_range
  - mcp__excel__set_sheet_layout
```

These tools must already be registered and visible to the Agent. Other large tools remain deferred in `selective` mode; the host decides this list before the task, without parsing the user's query. The recorded evaluation uses these two entries in the candidate configuration.

For MCP services that declare structured output schemas, substitute the built `lib/mcp-client-documented.mjs` for the pinned native MCP client entry. The transport and service configuration stay the same. This adapter only retains metadata that the plugin uses to document return values.
