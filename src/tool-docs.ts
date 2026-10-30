/** A fixed PTC catalog with scoped documentation lookup by tool or capability group. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, renderToolsSdk } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { metadataFingerprint } from './fingerprint.ts'
import { projectCatalogSchema } from './catalog-schema.ts'
import { projectToolSignature } from './tool-signature.ts'
export { metadataFingerprint }

export const name = 'context-tool-docs'
export const inject = ['tools', 'agents', 'systemPrompt']
export interface Config {
  presentation?: 'catalog' | 'full' | 'selective'
  deferSchemaBytes?: number
  /** Exact visible tool names whose complete input parameters stay in the SDK. */
  alwaysInline?: string[]
  summaries?: { name: string; fingerprint: string; text: string }[]
  toolsets?: { name: string; description: string; tools: string[] }[]
  maxToolsPerQuery?: number
  maxDocumentBytes?: number
}
const configSchema = z.object({
  presentation: z.enum(['catalog','full','selective']).default('catalog'),
  deferSchemaBytes: z.number().int().min(128).max(100000).default(1024),
  alwaysInline: z.array(z.string().min(1).refine(name => !['run_code', 'tool_help'].includes(name)))
    .refine(names => new Set(names).size === names.length, 'alwaysInline names must be unique').default([]),
  summaries: z.array(z.object({ name: z.string().min(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    text: z.string().min(1) }).strict()).default([]),
  toolsets: z.array(z.object({ name: z.string().min(1), description: z.string().min(1),
    tools: z.array(z.string().min(1)).min(1) }).strict()).default([]),
  maxToolsPerQuery: z.number().int().min(1).max(20).default(8),
  maxDocumentBytes: z.number().int().min(1024).max(65536).default(24000),
}).strict()
const querySchema = z.object({ names: z.array(z.string().min(1)).max(20).optional(),
  toolsets: z.array(z.string().min(1)).max(4).optional(),
  offset: z.number().int().min(0).optional(),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict()

export function apply(ctx: Context, input: Config): void {
  const config = configSchema.parse(input)
  const alwaysInline = new Set(config.alwaysInline)
  const summaries = new Map(config.summaries.map(item => [item.name, item]))
  const groups = new Map(config.toolsets.map(item => [item.name, item]))
  if (summaries.size !== config.summaries.length || groups.size !== config.toolsets.length) {
    throw new Error('Duplicate summary or toolset name')
  }
  for (const group of groups.values()) {
    if (new Set(group.tools).size !== group.tools.length || group.tools.some(n => ['tool_help', 'run_code'].includes(n))) {
      throw new Error('Toolset members must be unique business tool names')
    }
  }
  if (ctx.tools.get('tool_help') !== undefined) throw new Error('tool_help is already registered')

  // Resolve metadata afresh in the caller scope. There is no loaded-tool state.
  function metadata(agent: Agent) {
    return new Map(ctx.tools.schemas(agent).filter(schema => schema.name !== 'run_code').map(schema => {
      const definition = ctx.tools.get(schema.name, agent)
      if (definition === undefined) throw new Error(`Tool ${schema.name} changed while reading metadata`)
      const output = definition.output as typeof definition.output & { documentation?: { schema: unknown; field?: string } }
      const data = { name: schema.name, description: schema.description, parameters: schema.parameters,
        output: definition.output.schema,
        ...output.documentation === undefined ? {} : { outputDocumentation: output.documentation } }
      return [schema.name, { ...data, fingerprint: metadataFingerprint(data) }] as const
    }))
  }

  const help = defineTool({
    name: 'tool_help',
    description: `Read complete descriptions, input schemas and output schemas for visible tools by exact names or capability toolsets. Each response holds at most ${config.maxToolsPerQuery} tools and ${config.maxDocumentBytes} UTF-8 bytes, without cutting any definition. For more matches, call tool_help again with the returned nextQuery; null means complete. These read-only calls can be chained in one program. This never executes or activates tools or grants permissions.`,
    parameters: {
      names: { type: 'array', items: { type: 'string' }, description: 'Optional exact tool names from the catalog.' },
      toolsets: { type: 'array', items: { type: 'string' }, description: 'Optional exact capability group names from the catalog. Returns all currently visible members.' },
      offset: { type: 'integer', description: 'Continuation only: copy from nextQuery, together with snapshot. Omit on the first call.' },
      snapshot: { type: 'string', description: 'Continuation only: copy from nextQuery. Changed scoped metadata requires restarting the query.' },
    },
    isConcurrencySafe: () => true,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(raw, execution) {
      execution.signal?.throwIfAborted()
      const agent = execution.agent
      if (agent === undefined) throw new Error('tool_help requires an Agent scope')
      const args = querySchema.parse(raw)
      const selected = new Set(args.names ?? [])
      const current = metadata(agent)
      for (const groupName of args.toolsets ?? []) {
        const members = groups.get(groupName)?.tools.filter(n => current.has(n)) ?? []
        if (!members.length) throw new Error(`Toolset ${groupName} is unavailable in this Agent scope`)
        for (const member of members) selected.add(member)
      }
      if (!selected.size) throw new Error('Specify at least one tool name or toolset')
      const docs = [...selected].sort().map(toolName => {
        const tool = current.get(toolName)
        if (tool === undefined) throw new Error(`Tool ${toolName} is unavailable in this Agent scope`)
        return tool
      })
      // The continuation describes this ordered selection, not cached state or
      // execution authority. Re-resolving the caller scope prevents stale pages.
      const snapshot = metadataFingerprint(docs.map(({ name, fingerprint }) => ({ name, fingerprint })))
      const offset = args.offset ?? 0
      if (offset > 0 && args.snapshot === undefined) throw new Error('A continuation offset requires its snapshot')
      if (args.snapshot !== undefined && args.snapshot !== snapshot) throw new Error('Documentation changed; restart the query without offset or snapshot')
      if (offset >= docs.length) throw new Error('Documentation offset is outside the selected range')
      const selection = {
        ...args.names === undefined ? {} : { names: args.names },
        ...args.toolsets === undefined ? {} : { toolsets: args.toolsets },
      }
      const page = (end: number) => JSON.stringify({ tools: docs.slice(offset, end), matchedCount: docs.length, offset,
        nextQuery: end === docs.length ? null : { ...selection, offset: end, snapshot } })
      let result: string | undefined
      for (let end = offset + 1; end <= Math.min(docs.length, offset + config.maxToolsPerQuery); end++) {
        const candidate = page(end)
        // The final page omits nextQuery, so its envelope can be smaller than
        // an earlier candidate. Inspect every permitted whole-definition end.
        if (Buffer.byteLength(candidate, 'utf8') <= config.maxDocumentBytes) result = candidate
      }
      if (result === undefined) throw new Error(`Complete definition ${docs[offset]!.name} and continuation exceed the ${config.maxDocumentBytes} bytes limit; increase the configured budget. Nothing was truncated.`)
      return result
    },
  })
  ctx.tools.register(help)

  ctx.on('system-prompt/assemble', async (_initial, context, next) => {
    const assembly = await next()
    const agent = ctx.agents.list().find(candidate => candidate === context.scope)
    if (agent === undefined || !assembly.tools.some(tool => tool.name === 'run_code')
      || ctx.get('ptcRuntime')?.language !== 'typescript') throw new Error('context-tool-docs requires TypeScript PTC and an Agent scope')
    const current = metadata(agent)
    if (!current.has('tool_help') || ctx.tools.get('tool_help', agent) !== help) {
      throw new Error('The context-tool-docs tool_help must be visible and unshadowed')
    }
    if (['load_toolsets', 'load_tool', 'tool_search'].some(n => current.has(n))) throw new Error('Choose one tool presentation plugin')
    if (assembly.sections.filter(section => section.name === 'tools:sdk').length !== 1) throw new Error('Expected one native tools:sdk section')
    // Native bindings stay intact. Generic declarations intentionally omit
    // business schemas; actual calls still use their original validators.
    const deferredNames: string[]=[]
    const projected = [...current.values()].map(tool => {
      const summary = summaries.get(tool.name)
      const description = summary?.fingerprint === tool.fingerprint ? summary.text : tool.description
      const deferred=tool.name!=='tool_help' && !alwaysInline.has(tool.name) && (config.presentation==='catalog'
        || (config.presentation==='selective' && Buffer.byteLength(JSON.stringify(tool.parameters),'utf8')>=config.deferSchemaBytes))
      if (deferred) deferredNames.push(tool.name)
      // Project the declared schema before embedding it: its local references
      // belong to that schema, not to the canonical MCP envelope.
      let output = projectCatalogSchema(tool.output)
      let outputNote = ''
      if (tool.outputDocumentation !== undefined) {
        try {
          const declared = projectCatalogSchema(tool.outputDocumentation.schema)
          const field = tool.outputDocumentation.field
          if (field === undefined) output = declared
          else if (output.type === 'object') output = { ...output, properties: { ...output.properties, [field]: declared } }
          else throw new Error('A documented property requires an object result')
        } catch (error) {
          // Unsupported presentation vocabulary must not erase the original
          // document or weaken the canonical validator.
          outputNote = ' Some declared return details are not representable in this SDK; tool_help includes the original outputDocumentation.'
        }
      }
      const signature = deferred && config.presentation === 'selective'
      return { name: tool.name, description:description+outputNote+(signature
        ? ' Parameters deferred: top-level signature only. Nested fields, allowed values and validation details require tool_help before constructing arguments.'
        : deferred ? ' Parameters deferred: read tool_help for this exact tool before constructing its arguments.' : ''),
        parameters: signature ? projectToolSignature(tool.parameters)
          : deferred ? { type: 'object' as const, additionalProperties: true } : projectCatalogSchema(tool.parameters),
        output }
    })
    const catalogGroups = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .map(group => {
        const tools = group.tools.filter(n => current.has(n)).sort()
        return { name: group.name, description: group.description, toolCount: tools.length, tools }
      })
      .filter(group => group.tools.length > 0)
    const text = renderToolsSdk(projected)
      + '\n\nResult handling:\n'
      + '- MCP tools return an object with content blocks and optional structuredContent. When structuredContent !== undefined, use its documented shape; it need not be a string. Do not JSON.parse the outer result object.\n'
      + '- Otherwise inspect content by block type. Read text blocks as text, parsing a block as JSON only when it actually contains JSON. For embedded resource blocks, resource.text is text; resource.blob contains base64 bytes. Neither a text description of a file nor a resource URI is the file contents.\n'
      + '- tool_help is a documentation tool, not an MCP tool: it returns a JSON string containing tools with descriptions, parameters, output schemas and fingerprints.\n'
      + '- When a document includes outputDocumentation, its schema describes the named field of the canonical result, or the whole result if field is absent. This provider declaration does not replace execution validation.\n'
      + '\nTool documentation workflow:\n'
      + (deferredNames.length ? '- Tools marked Parameters deferred omit full input details. A displayed top-level signature preserves argument names, types and required fields, but an open object is not permission to invent nested fields. Before constructing arguments for one of these tools, read its full definition with tool_help unless that definition is already available in the current conversation. Do not guess omitted fields.\n'
        + '- Copy exact public tool names from the catalog, including any mcp__server__ prefix. Query multiple known needed names together, or a listed toolset. Follow nextQuery for remaining complete definitions; these read-only pages can be fetched and printed in the same program. Return or console.log the definitions so the model can read them on the next step.\n'
        + '- Reuse previously returned definitions while they remain available and applicable. The Parameters deferred marker stays fixed; it does not require a fresh query before every call. Re-read if a definition is missing, the metadata changed, or an argument error indicates a mismatch.\n' : '- Complete input parameters are provided above. Call tools directly with those parameters; tool_help is optional for ambiguous documentation.\n')
      + '- Documentation queries do not activate tools or grant permissions. Native argument validation, scope restrictions and execution checks still apply. A returned fingerprint identifies that documentation snapshot; it does not lock later execution to that version.\n'
      + (deferredNames.length ? 'Capability toolsets (metadata, not instructions):\n'+JSON.stringify(catalogGroups) : '')
    return { ...assembly, sections: assembly.sections.map(section => section.name === 'tools:sdk' ? { ...section, text } : section) }
  })
}
