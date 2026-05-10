export async function configId(
  config: unknown,
  opts?: { len?: number; ignoreKeys?: string[] }
): Promise<string> {
  const { len = 8, ignoreKeys = [] } = opts ?? {}
  const ignore = new Set(ignoreKeys)

  const normalize = (v: any): any => {
    if (v === null || typeof v !== 'object') {
      if (v instanceof Date) return v.toISOString()
      if (typeof v === 'number' && !Number.isFinite(v)) return String(v)
      if (typeof v === 'bigint') return v.toString()
      return v
    }
    if (Array.isArray(v)) return v.map(normalize)
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).filter(k => !ignore.has(k)).sort()) out[k] = normalize(v[k])
    return out
  }

  const canonical = JSON.stringify(normalize(config))
  const bytes = new TextEncoder().encode(canonical)

  let digestBytes: Uint8Array
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    digestBytes = new Uint8Array(digest)
  } else {
    const nodeCrypto = await import('crypto')
    const hash = nodeCrypto.createHash('sha256').update(Buffer.from(bytes)).digest()
    digestBytes = new Uint8Array(hash.buffer, hash.byteOffset, hash.byteLength)
  }

  const hex = Array.from(digestBytes, b => b.toString(16).padStart(2, '0')).join('')
  return hex.slice(0, len)
}


