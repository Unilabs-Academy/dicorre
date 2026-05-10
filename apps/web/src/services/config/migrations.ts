import { Effect } from "effect"
import defaultConfig from '@/../app.config.json'
import { validateAppConfig, type AppConfig, CURRENT_CONFIG_VERSION } from './schema'

type AnyConfig = Record<string, any>
type Migration = (input: AnyConfig) => AnyConfig

const deepMerge = (base: AnyConfig, override: AnyConfig): AnyConfig => {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base
  if (typeof base !== 'object' || base === null) return override ?? base
  if (typeof override !== 'object' || override === null) return base
  const out: AnyConfig = { ...base }
  for (const key of Object.keys(override)) {
    out[key] = deepMerge((base as AnyConfig)[key], (override as AnyConfig)[key])
  }
  return out
}

// Define forward-only migrations: N -> N+1
const migrations: Record<number, Migration> = {
  // For now: v0 -> v1 introduce version field without structural changes
  0: (cfg) => {
    return { ...cfg, version: 1 }
  }
}

export function migrateConfig(raw: unknown, options?: { source?: 'persisted' | 'uploaded' }): AppConfig {
  const source = options?.source ?? 'persisted'
  const initial = (raw && typeof raw === 'object') ? (raw as AnyConfig) : {}
  let working = { ...initial }
  let version = typeof working.version === 'number' ? working.version : 0

  while (version < CURRENT_CONFIG_VERSION) {
    const step = migrations[version]
    if (!step) {
      version += 1
      working.version = version
      continue
    }
    working = step(working)
    version = working.version
  }

  if (source === 'persisted') {
    const merged = deepMerge(defaultConfig as AnyConfig, working)
    merged.version = CURRENT_CONFIG_VERSION
    const validated = validateAppConfig(merged as unknown)
    return Effect.runSync(validated)
  } else {
    // uploaded: validate strictly without filling from defaults
    working.version = CURRENT_CONFIG_VERSION
    const validated = validateAppConfig(working as unknown)
    return Effect.runSync(validated)
  }
}


