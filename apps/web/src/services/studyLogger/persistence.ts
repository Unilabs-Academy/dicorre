import { Effect, Context, Layer } from "effect"
import type { StudyLogEntry } from "./index"

export class StudyLoggerPersistence extends Context.Tag("StudyLoggerPersistence")<
  StudyLoggerPersistence,
  {
    readonly load: Effect.Effect<Map<string, StudyLogEntry[]> | null, never>
    readonly save: (logs: Map<string, StudyLogEntry[]>) => Effect.Effect<void, never>
    readonly clear: Effect.Effect<void, never>
  }
>() { }

const STORAGE_KEY = "study-logs"

export const StudyLoggerPersistenceLocalStorage = Layer.succeed(
  StudyLoggerPersistence,
  {
    load: Effect.sync(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return new Map(Object.entries(parsed)) as Map<string, StudyLogEntry[]>
      } catch {
        return null
      }
    }),
    save: (logs: Map<string, StudyLogEntry[]>) => Effect.sync(() => {
      try {
        const obj = Object.fromEntries(logs)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
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