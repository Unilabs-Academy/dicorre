import { Effect, Layer } from "effect"
import { StudyLoggerPersistence } from '@dicorre/shared/services/studyLogger/persistence'
import type { StudyLogEntry } from '@dicorre/shared/services/studyLogger'

export { StudyLoggerPersistence }

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
