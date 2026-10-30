import { readFile, writeFile, mkdir, symlink, realpath, lstat, unlink, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const sourceArgument = process.argv[2] ?? process.env.DSH_SOURCE_DIR
if (!sourceArgument) throw new Error('Pass the path to a built, pinned DeepSeek Harness checkout, or set DSH_SOURCE_DIR')
const source = resolve(sourceArgument)
const revision = 'd743267388641bc76f17c45ce8b4c231aed1d32c'
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() !== revision) {
  throw new Error(`DSH source must be pinned to ${revision}`)
}
const node = process.env.DSH_NODE_BIN ?? process.execPath
const nodeVersion = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim()
const [major, minor] = nodeVersion.slice(1).split('.').map(Number)
if (!((major === 22 && minor >= 19) || major >= 24)) throw new Error(`Unsupported Node ${nodeVersion}; set DSH_NODE_BIN`)
const pnpmVersion = execFileSync(node, [join(source, 'node_modules/pnpm/bin/pnpm.cjs'), '--version'], { encoding: 'utf8' }).trim()
if (pnpmVersion !== '11.28.5') throw new Error(`Pinned DSH development dependencies require pnpm 11.28.5, found ${pnpmVersion}`)
const tsconfigText = await readFile(join(source, 'tsconfig.base.json'), 'utf8')
const { compilerOptions } = JSON.parse(tsconfigText.replace(/^\s*\/\/.*$/gm, ''))
const paths = Object.fromEntries(Object.entries(compilerOptions.paths).map(([name, entries]) =>
  [name, entries.map(entry => resolve(source, entry))]))
await mkdir(join(root, '.local'), { recursive: true })
await writeFile(join(root, '.local/runtime.json'), JSON.stringify({ source, node, revision, nodeVersion, pnpmVersion }, null, 2) + '\n')
await writeFile(join(root, 'tsconfig.dsh.json'), JSON.stringify({ compilerOptions: { paths } }, null, 2) + '\n')
const checkPaths = Object.fromEntries(Object.entries(paths).map(([name, entries]) => [name,
  entries.map(entry => entry.includes('/vendor/') ? entry.replace(/\/src(?=\/|$)/, '/lib/types') : entry)]))
await writeFile(join(root, 'tsconfig.check.json'), JSON.stringify({ compilerOptions: { paths: checkPaths } }, null, 2) + '\n')
const modules = join(root, 'node_modules')
try {
  if ((await lstat(modules)).isSymbolicLink()) await unlink(modules)
} catch (error) { if (error.code !== 'ENOENT') throw error }
await mkdir(modules, { recursive: true })
async function link(target, destination) {
  try {
    const entry = await lstat(destination)
    if (!entry.isSymbolicLink()) throw new Error(`Refusing to replace non-symlink ${destination}`)
    if (await realpath(destination) === await realpath(target)) return
    await unlink(destination)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await symlink(target, destination, 'dir')
}
for (const entry of await readdir(join(source, 'node_modules'))) {
  if (entry.startsWith('.')) continue
  if (entry.startsWith('@')) {
    await mkdir(join(modules, entry), { recursive: true })
    for (const child of await readdir(join(source, 'node_modules', entry))) {
      await link(join(source, 'node_modules', entry, child), join(modules, entry, child))
    }
  } else await link(join(source, 'node_modules', entry), join(modules, entry))
}
for (const [name, entries] of Object.entries(paths)) {
  if (!/^@deepseek-ai\/[^/]+$/.test(name)) continue
  let directory = entries[0]
  while (directory.startsWith(source)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      if (manifest.name === name) { await link(directory, join(modules, name)); break }
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
    directory = dirname(directory)
  }
}
console.log(JSON.stringify({ source, revision, nodeVersion, pnpmVersion, dependencies: 'Reuse pinned DSH development dependencies; source remains read-only' }))
