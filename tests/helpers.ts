import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

export const signal = new AbortController().signal

export async function environment(persistenceRoot?: string, workingDirectory = false) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { workingDirectory })
  if (persistenceRoot !== undefined) await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  const harness = await mountAgentLoopTestHarness(ctx)
  return { ctx, harness }
}

export function sampleTool(name = 'config_test', result = 'timeout_ms=200; tests passed') {
  return defineTool({
    name, description: 'Run configuration timeout tests in the example workspace.',
    parameters: { path: { type: 'string', required: true, description: 'Workspace test path.' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return result },
  })
}

export function call(ctx: Context, agent: Agent | undefined, name: string, args: object = {}) {
  return ctx.tools.execute({ callId: ToolCallId(crypto.randomUUID()), name, arguments: args, signal, ...agent === undefined ? {} : { agent } })
}
