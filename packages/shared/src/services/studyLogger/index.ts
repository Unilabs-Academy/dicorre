import { Context, Layer, Effect, SubscriptionRef, Stream } from "effect"
import { StudyLoggerPersistence } from "./persistence"

export type LogLevel = 'info' | 'warn' | 'error'

export interface StudyLogEntry {
  ts: number
  level: LogLevel
  message: string
  details?: unknown
}

export class StudyLogger extends Context.Tag("StudyLogger")<
  StudyLogger,
  {
    readonly append: (studyId: string, entry: StudyLogEntry) => Effect.Effect<void, never>
    readonly get: (studyId: string) => Effect.Effect<StudyLogEntry[], never>
    readonly getStatus: (studyId: string) => Effect.Effect<{ hasError: boolean }, never>
    readonly clear: (studyId: string) => Effect.Effect<void, never>
    readonly clearAll: Effect.Effect<void, never>
    readonly getAllLogs: Effect.Effect<Map<string, StudyLogEntry[]>, never>
    readonly logsChanges: Stream.Stream<Map<string, StudyLogEntry[]>>
  }
>() { }

export const StudyLoggerLive = Layer.scoped(
  StudyLogger,
  Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make(new Map<string, StudyLogEntry[]>())
    const persistence = yield* StudyLoggerPersistence

    // On init, attempt to load persisted logs
    const persisted = yield* persistence.load
    if (persisted) {
      yield* SubscriptionRef.set(ref, persisted)
    }

    const append = (studyId: string, entry: StudyLogEntry) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.update(ref, (logs) => {
          const newLogs = new Map(logs)
          const arr = newLogs.get(studyId) ?? []
          arr.push(entry)
          newLogs.set(studyId, arr)
          return newLogs
        })
        // Persist after update
        const updated = yield* SubscriptionRef.get(ref)
        yield* persistence.save(updated)
      })

    const get = (studyId: string) =>
      Effect.map(
        SubscriptionRef.get(ref),
        (logs) => logs.get(studyId) ?? []
      )

    const getStatus = (studyId: string) =>
      Effect.map(
        SubscriptionRef.get(ref),
        (logs) => ({ hasError: (logs.get(studyId) ?? []).some(e => e.level === 'error') })
      )

    const clear = (studyId: string) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.update(ref, (logs) => {
          const newLogs = new Map(logs)
          newLogs.delete(studyId)
          return newLogs
        })
        // Persist after update
        const updated = yield* SubscriptionRef.get(ref)
        yield* persistence.save(updated)
      })

    const clearAll = Effect.gen(function* () {
      yield* SubscriptionRef.set(ref, new Map())
      yield* persistence.clear
    })

    const getAllLogs = SubscriptionRef.get(ref)

    return {
      append,
      get,
      getStatus,
      clear,
      clearAll,
      getAllLogs,
      logsChanges: ref.changes
    } as const
  })
)


