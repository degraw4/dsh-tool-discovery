import { createHash } from 'node:crypto'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':'
      + canonical((value as Record<string, unknown>)[key])).join(',') + '}'
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Tool metadata must be JSON')
  return encoded
}

export function metadataFingerprint(metadata: unknown): string {
  return createHash('sha256').update(canonical(metadata)).digest('hex')
}
