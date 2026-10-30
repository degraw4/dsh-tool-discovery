import { readFileSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const runtime = JSON.parse(readFileSync(join(root, '.local/runtime.json'), 'utf8'))
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtime.source, encoding: 'utf8' }).trim() !== runtime.revision) {
  throw new Error('DSH source revision changed; restore the pinned baseline before running this project')
}
if (spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'packages', 'vendor'], { cwd: runtime.source }).status !== 0) {
  throw new Error('DSH source has tracked code changes; use a clean pinned baseline')
}
const command = process.argv[2]
const args = process.argv.slice(3)
const bin = path => join(runtime.source, 'node_modules', path)
const commands = {
  test: [bin('vitest/vitest.mjs'), 'run', ...args],
  typecheck: [bin('typescript/bin/tsc'), '--noEmit', '--project', 'tsconfig.json', ...args],
  build: [join(root, 'scripts/build.mjs'), ...args],
}
if (!(command in commands)) throw new Error(`Unknown command: ${command}`)
const result = spawnSync(runtime.node, commands[command], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, PATH: `${dirname(runtime.node)}:${process.env.PATH}`, DSH_SOURCE_DIR: runtime.source },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
