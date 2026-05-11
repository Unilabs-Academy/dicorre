import { Effect, Layer } from 'effect'
import { ConfigPersistence } from '@dicorre/shared/services/config/configPersistence'
import type { AppConfig } from '@dicorre/shared/services/config/schema'

const STORAGE_KEY = 'app-config'

export { ConfigPersistence }

export const ConfigPersistenceLocalStorage = Layer.succeed(
  ConfigPersistence,
  {
    load: Effect.sync(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        return JSON.parse(raw) as AppConfig
      } catch {
        return null
      }
    }),
    save: (cfg: AppConfig) => Effect.sync(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
      } catch {
        // ignore persistence failures
      }
    }),
    clear: Effect.sync(() => {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore persistence failures
      }
    }),
  } as const,
)
