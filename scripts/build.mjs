import { cp, mkdir, rm, symlink, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'

const root = fileURLToPath(new URL('..', import.meta.url))
const runtime = JSON.parse(await readFile(join(root, '.local/runtime.json'), 'utf8'))
const adapter = join(root, '.local/mcp-client')
await rm(adapter, { recursive: true, force: true })
await mkdir(adapter, { recursive: true })
await cp(join(runtime.source, 'packages/mcp/mcp-client/src'), join(adapter, 'src'), { recursive: true })
await symlink(join(runtime.source, 'packages/mcp/mcp-client/node_modules'), join(adapter, 'node_modules'), 'dir')
execFileSync('patch', ['--batch', '-p1', '-d', join(adapter, 'src'), '-i', join(root, 'patches/mcp-output-documentation.patch')], { stdio: 'inherit' })
await build({
  entry: { 'tool-docs': 'src/tool-docs.ts', 'mcp-client-documented': join(adapter, 'src/index.ts') },
  outDir: 'lib', format: 'esm', platform: 'node', target: 'node22',
  dts: true, clean: true, sourcemap: true,
  deps: { neverBundle: [/^@deepseek-ai\//, 'zod'] },
})
