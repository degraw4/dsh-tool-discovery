/** A shallow declaration for model guidance, never an execution validator. */
import { projectCatalogSchema } from './catalog-schema.ts'
import { projectSchema } from './sdk-schema.ts'

export function projectToolSignature(schema: unknown) {
  const projected = projectCatalogSchema(schema)
  function shape(value: unknown): Record<string, unknown> {
    const node = value as Record<string, unknown>
    if (Array.isArray(node.oneOf)) return { oneOf: node.oneOf.map(shape) }
    if (node.type === 'object') return { type: 'object', additionalProperties: true }
    if (node.type === 'array') return { type: 'array', items: shape(node.items) }
    if (node.type !== undefined) return { type: node.type }
    if (Array.isArray(node.enum)) {
      const types = [...new Set(node.enum.map(v => v === null ? 'null' : typeof v))]
      return types.length === 1 ? { type: types[0] } : { oneOf: types.map(type => ({ type })) }
    }
    throw new Error('Parameter type cannot be represented by a shallow signature')
  }
  function root(value: unknown): Record<string, unknown> {
    const node = value as Record<string, unknown>
    if (Array.isArray(node.oneOf)) return { oneOf: node.oneOf.map(root) }
    if (node.type !== 'object') return shape(node)
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(node.properties ?? {}).map(([name, child]) => [name, shape(child)])),
      ...(node.required === undefined ? {} : { required: node.required }),
      ...(node.additionalProperties === undefined ? {} : { additionalProperties: node.additionalProperties }),
    }
  }
  return projectSchema(root(projected))
}
