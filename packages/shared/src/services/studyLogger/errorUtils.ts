export type SerializableError = Record<string, unknown>

function safePlain(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(safePlain)
  if (typeof value === 'object') {
    try {
      JSON.stringify(value)
      return value
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function serializeError(error: unknown): SerializableError {
  const e = error as any

  if (e && typeof e === 'object' && typeof e._tag === 'string') {
    const out: Record<string, unknown> = {
      tag: String(e._tag),
      message: typeof e.message === 'string' ? e.message : String(e.message ?? '')
    }

    for (const key of [
      'fileName',
      'url',
      'status',
      'path',
      'operation',
      'pluginId',
      'setting',
      'value'
    ]) {
      if (e[key] !== undefined) out[key] = safePlain(e[key])
    }

    if (e.cause !== undefined) {
      out.cause = serializeError(e.cause)
    }
    if (e.stack && typeof e.stack === 'string') {
      out.stack = e.stack
    }
    return out
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  try {
    JSON.stringify(error)
    return error as SerializableError
  } catch {
    return { message: String(error) }
  }
}


