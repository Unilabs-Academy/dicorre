import { Effect, Context, Layer } from "effect"
import type { AppConfig } from "@/services/config/schema"

export class ConfigPersistence extends Context.Tag("ConfigPersistence")<
  ConfigPersistence,
  {
    readonly load: Effect.Effect<AppConfig | null, never>
    readonly save: (cfg: AppConfig) => Effect.Effect<void, never>
    readonly clear: Effect.Effect<void, never>
  }
>() { }

const STORAGE_KEY = "app-config"

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
    })
  } as const
)


