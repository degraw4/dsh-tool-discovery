/** Model-facing projection only; execution always retains the original schema. */
import { assertSupportedJsonSchema, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'

export function projectSchema(schema: unknown): JsonSchemaNode & Record<string, unknown> {
  const ancestors = new Set<object>()
  function visit(value: unknown, depth = 0): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Schema must be an object')
    if (depth > 64 || ancestors.has(value)) throw new Error('Schema nesting is unsupported')
    ancestors.add(value)
    try {
      const node = { ...value } as Record<string, unknown>
      if (Object.hasOwn(node, '$schema')) {
        if (typeof node.$schema !== 'string'
          || !/^https?:\/\/json-schema\.org\/(?:draft-07\/schema|draft\/2020-12\/schema)#?$/.test(node.$schema)) {
          throw new Error('Unsupported JSON Schema dialect')
        }
        delete node.$schema
      }
      if (Object.hasOwn(node, 'anyOf')) {
        if (Object.hasOwn(node, 'oneOf') || !Array.isArray(node.anyOf) || node.anyOf.length < 2) {
          throw new Error('Unsupported anyOf composition')
        }
        const types = node.anyOf.map(branch => branch?.type as unknown)
        const supported = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array'])
        if (types.some(type => typeof type !== 'string' || !supported.has(type))
          || new Set(types).size !== types.length || (types.includes('number') && types.includes('integer'))) {
          throw new Error('anyOf branches must have disjoint JSON types')
        }
        node.oneOf = node.anyOf
        delete node.anyOf
      }
      if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
        node.properties = Object.fromEntries(Object.entries(node.properties)
          .map(([key, child]) => [key, visit(child, depth + 1)]))
      }
      if (node.items !== undefined) node.items = visit(node.items, depth + 1)
      if (Array.isArray(node.oneOf)) node.oneOf = node.oneOf.map(child => visit(child, depth + 1))
      if (Object.hasOwn(node, 'minItems')) {
        if (node.type !== 'array' || typeof node.minItems !== 'number'
          || !Number.isInteger(node.minItems) || node.minItems < 0) throw new Error('Invalid minItems')
        // TypeScript does not enforce the raw JSON Schema constraint. Keep it visible
        // in the declaration, while the original tool/server owns execution validation.
        node.description = `${typeof node.description === 'string' ? node.description + ' ' : ''}[Validation constraint: minItems=${node.minItems}.]`
        delete node.minItems
      }
      return node
    } finally { ancestors.delete(value) }
  }
  const result = visit(structuredClone(schema))
  assertSupportedJsonSchema(result)
  return result
}
