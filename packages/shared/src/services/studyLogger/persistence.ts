import { Context, Effect } from 'effect'
import type { StudyLogEntry } from './index'

export class StudyLoggerPersistence extends Context.Tag('StudyLoggerPersistence')<
  StudyLoggerPersistence,
  {
    readonly load: Effect.Effect<Map<string, StudyLogEntry[]> | null, never>
    readonly save: (logs: Map<string, StudyLogEntry[]>) => Effect.Effect<void, never>
    readonly clear: Effect.Effect<void, never>
  }
>() {}
