import { expect,it } from 'vitest'
import { readFileSync } from 'node:fs'
import { jsonSchemaToTs } from '@deepseek-ai/dsh-tools'
import { projectCatalogSchema } from '../src/catalog-schema.ts'

it('expands local refs and preserves constraints as visible notes without changing executable schemas',()=>{
  const raw={type:'object',properties:{settings:{$ref:'#/$defs/Options'}},$defs:{Options:{type:'object',properties:{size:{type:'integer',minimum:1,maximum:5,default:2}},required:['size']}},required:['settings']}
  const copy=structuredClone(raw)
  const text=jsonSchemaToTs(projectCatalogSchema(raw))
  expect(text).toContain('settings:')
  expect(text).toContain('size: number')
  expect(text).toContain('"minimum":1')
  expect(text).toContain('"default":2')
  expect(raw).toEqual(copy)
  expect(()=>projectCatalogSchema({$ref:'https://example.com/schema'})).toThrow(/reference/)
  expect(()=>projectCatalogSchema({$ref:'#/$defs/a',$defs:{a:{$ref:'#/$defs/a'}}})).toThrow(/reference/)
  const overlapping={anyOf:[{type:'string',enum:['none']},{type:'string',pattern:'^='}]}
  const union=jsonSchemaToTs(projectCatalogSchema(overlapping))
  expect(union).not.toBe('unknown')
  expect(overlapping.anyOf[1]!.pattern).toBe('^=')
})

it('renders every benchmark input schema, including complex chart parameters',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../bench/tools.json',import.meta.url),'utf8'))
  const tools=catalog.tools
  expect(tools).toHaveLength(78)
  for (const tool of tools) {
    const text=jsonSchemaToTs(projectCatalogSchema(tool.inputSchema))
    expect(text,tool.name).not.toBe('unknown')
    if (tool.name==='mcp__excel__create_chart') expect(text).toContain('secondary_axis')
  }
})
