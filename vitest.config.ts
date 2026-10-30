import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const runtime = JSON.parse(readFileSync(new URL('.local/runtime.json', import.meta.url), 'utf8'))
const { standardDecoratorPlugin } = await import(resolve(runtime.source, 'vitest.shared.ts'))
const { compilerOptions: { paths } } = JSON.parse(readFileSync(new URL('tsconfig.dsh.json', import.meta.url), 'utf8')) as { compilerOptions: { paths: Record<string, string[]> } }
const aliases = Object.entries(paths).map(([name, entries]) => ({
  find: new RegExp('^' + name.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*)') + '$'),
  replacement: entries[0]!.replace('*', '$1'),
}))

export default defineConfig({
  cacheDir: '.cache/vite',
  plugins: [standardDecoratorPlugin()],
  resolve: { alias: aliases },
  test: {
    include: ['tests/**/*.spec.{ts,mjs}'],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
