/** Benchmark task policy and request-level evidence capture. */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const name = 'output-contract-policy'
export const inject = ['agents', 'tools', 'systemPrompt']

export function apply(ctx, config) {
  const trace = { taskId: config.taskId, arm: config.arm, calls: [], tools: [] }
  let writeChain = Promise.resolve()
  function persist() {
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(config.tracePath), { recursive: true })
      const temporary = config.tracePath + '.tmp'
      await writeFile(temporary, JSON.stringify(trace, null, 2) + '\n')
      await rename(temporary, config.tracePath)
    })
    return writeChain
  }
  ctx.systemPrompt.section({
    name: 'mcp-atlas-policy', order: 0, interpolate: false,
    text: `Complete the user's office task and verify the saved deliverable. Task files are in ${config.dataDirectory}. This is also the run_code working directory: Node filesystem APIs and the registered MCP tools see the SAME files at the SAME absolute paths. Use relative paths for Node APIs or this absolute directory for MCP arguments. There is no terminal service or network access. Do not seek user confirmation; report the saved output path when finished.

Program workflow:
- Each run_code call is a fresh process. Variables do not survive into the next call; files in this workspace do. Keep dependent read, compute, and write operations in one program when practical, or save intermediate data as a workspace file and read it in a later program.
- Use describe_sheet with requested details to verify saved formats, print setup, classic charts, table styles and color scales. Its normal summary omits these facts; an omitted summary field is not evidence of a missing setting. Native tool operations should be used for supported spreadsheet changes; low-level ZIP/XML changes require a demonstrated unmet requirement. Only Node built-in modules are advertised in the program runtime.
- Build column mappings from the actual source headers and preserve template labels exactly. Verify computed values against the intended source columns. Read original data before deriving results. Reuse data already read in the program, or persist it once for later use. Re-read when the source changed, required data was omitted, or you are verifying a saved output; do not repeatedly fetch unchanged input only to recreate lost variables.
- Return small factual summaries, selected rows, or validation failures to the model. Keep large intermediate tables in code or workspace files. Preserve the exact user requirements, including output names, labels, formulas, formatting and source preservation; successful tool execution alone is not task completion.
- Spreadsheet read_range exposes structuredContent with range and values. Use its values for computation. Workbook export may include a text description and an embedded resource: the text description is not the workbook. Binary resource.blob is base64; decode it to bytes when a file copy is actually needed. Direct Node file access is available for an existing workspace file, so export is not required merely to read that same file.
- If a tool's output shape is unclear, inspect a small summary of keys and content block types once, then use its documented fields. Do not print full binary data or full tables just to inspect their shape.`,
  })
  ctx.on('agent/created', ({ agent }) => {
    const allowed = config.allowedTools.filter(name => ctx.tools.get(name, agent) !== undefined)
    if (allowed.length !== config.allowedTools.length) {
      const missing = config.allowedTools.filter(name => !allowed.includes(name))
      throw new Error(`MCP-Atlas tools missing at Agent creation: ${missing.join(', ')}`)
    }
    agent.ctx.tools.restrict({ allow: allowed })
  })
  const admitted = new Set()
  ctx.tools.guard(execution => {
    if (admitted.has(execution.token)) return undefined
    if (admitted.size >= config.maxToolCalls) return 'MCP-Atlas tool execution ceiling reached'
    admitted.add(execution.token)
    return undefined
  })
  ctx.on('tools/result', (execution, result) => {
    trace.tools.push({
      name: execution.name, arguments: execution.arguments,
      isError: result.isError === true,
      textBytes: Buffer.byteLength(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')),
    })
    void persist()
  })
  ctx.on('llm/stream', async function* (options, next) {
    if (trace.calls.length >= config.maxModelCalls) throw new Error('MCP_ATLAS_MODEL_CALL_CEILING')
    const knownCost = trace.calls.reduce((sum, item) => {
      const u = item.usage
      return sum + (u === null ? 0 : (2 * (u.inputTokens ?? 0)
        + 0.04 * (u.cacheReadTokens ?? 0) + 2 * (u.cacheWriteTokens ?? 0)
        + 8 * (u.outputTokens ?? 0)) / 1_000_000)
    }, 0)
    if (knownCost >= config.maxCostPeakCny) throw new Error('MCP_ATLAS_COST_CEILING')
    const requestBytes = Buffer.byteLength(JSON.stringify({ messages: options.messages, tools: options.tools }))
    if (requestBytes > config.maxInputBytes) throw new Error('MCP_ATLAS_INPUT_CEILING')
    const call = {
      provider: options.provider, model: options.model,
      toolNames: (options.tools ?? []).map(tool => tool.name),
      toolSchemaBytes: Buffer.byteLength(JSON.stringify(options.tools ?? [])),
      messagesBytes: Buffer.byteLength(JSON.stringify(options.messages)),
      reasoningEffort: options.reasoningEffort ?? null, maxTokens: options.maxTokens ?? null,
      reasoningBytes: 0, textBytes: 0, finishReason: null,
      usage: null, startedAt: new Date().toISOString(),
    }
    trace.calls.push(call); await persist()
    const started = performance.now()
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') call.usage = chunk.usage
        if (chunk.type === 'reasoning-delta') call.reasoningBytes += Buffer.byteLength(chunk.text ?? '')
        if (chunk.type === 'text-delta') call.textBytes += Buffer.byteLength(chunk.text ?? '')
        if (chunk.type === 'finish') call.finishReason = chunk.reason?.kind ?? null
        if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
          call.error = chunk.reason.error?.message ?? 'Provider request failed'
          call.failureCode = chunk.reason.error?.code ?? null
        }
        yield chunk
      }
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      call.elapsedMs = Math.round(performance.now() - started)
      await persist()
    }
  })
  ctx.effect(() => async () => { await writeChain }, 'mcp-atlas-policy.trace')
}
