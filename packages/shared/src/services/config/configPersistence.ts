import { Effect, Context } from "effect"
import type { AppConfig } from "./schema"

export class ConfigPersistence extends Context.Tag("ConfigPersistence")<
  ConfigPersistence,
  {
    readonly load: Effect.Effect<AppConfig | null, never>
    readonly save: (cfg: AppConfig) => Effect.Effect<void, never>
    readonly clear: Effect.Effect<void, never>
  }
>() { }

