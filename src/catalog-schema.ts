/** Expand local references for presentation; executable schemas remain unchanged. */
import { projectSchema } from './sdk-schema.ts'

export function projectCatalogSchema(schema: unknown) {
  const root=structuredClone(schema) as Record<string,unknown>
  const notes=new Set(['default','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minItems','maxItems',
    'minLength','maxLength','pattern','format','title','examples','multipleOf','uniqueItems'])
  function expand(value: unknown, refs: Set<string>, depth: number): Record<string,unknown> {
    if (!value || typeof value!=='object' || Array.isArray(value) || depth>64) throw new Error('Unsupported schema node')
    const node={...value} as Record<string,unknown>
    if (node.$ref!==undefined) {
      const ref=node.$ref
      if (typeof ref!=='string' || !ref.startsWith('#/') || refs.has(ref)) throw new Error('Unsupported or recursive schema reference')
      let target: unknown=root
      for (const key of ref.slice(2).split('/').map(k=>k.replaceAll('~1','/').replaceAll('~0','~'))) {
        target=target && typeof target==='object' ? (target as Record<string,unknown>)[key] : undefined
      }
      if (Object.keys(node).some(k=>!['$ref','description','default','title'].includes(k))) throw new Error('Unsupported reference sibling constraint')
      const next=expand(target,new Set([...refs,ref]),depth+1)
      const { $ref: _ref, ...metadata }=node
      return expand({...next,...metadata},refs,depth+1)
    }
    delete node.$defs
    const constraints: Record<string,unknown>={}
    for (const key of Object.keys(node)) if (notes.has(key)) {constraints[key]=node[key];delete node[key]}
    if (node.additionalProperties && typeof node.additionalProperties==='object') {
      constraints.additionalProperties=node.additionalProperties;node.additionalProperties=true
    }
    if (Object.keys(constraints).length) node.description=(typeof node.description==='string'?node.description+' ':'')
      +'[Schema constraints: '+JSON.stringify(constraints)+']'
    if (node.properties && typeof node.properties==='object' && !Array.isArray(node.properties)) {
      node.properties=Object.fromEntries(Object.entries(node.properties).map(([key,child])=>[key,expand(child,refs,depth+1)]))
    }
    if (node.items!==undefined) node.items=expand(node.items,refs,depth+1)
    for (const key of ['anyOf','oneOf']) if (Array.isArray(node[key])) node[key]=node[key].map(child=>expand(child,refs,depth+1))
    if (Array.isArray(node.anyOf)) {
      if (node.oneOf!==undefined) throw new Error('Mixed union constraints are unsupported')
      // The native renderer spells oneOf as a TypeScript union. This copy is
      // never a validator: retain the original anyOf semantics in its note.
      node.oneOf=node.anyOf;delete node.anyOf
      node.description=(typeof node.description==='string'?node.description+' ':'')
        +'[Input uses anyOf; the displayed TypeScript union does not enforce branch exclusivity.]'
    }
    return node
  }
  return projectSchema(expand(root,new Set(),0))
}
