import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Effect, Layer } from 'effect'
import { ConfigPersistence } from '@dicorre/shared/services/config/configPersistence'
import type { AppConfig } from '@dicorre/shared/services/config/schema'
import { StudyLoggerPersistence } from '@dicorre/shared/services/studyLogger/persistence'
import type { StudyLogEntry } from '@dicorre/shared/services/studyLogger'

const readJson = <A>(filePath: string): Effect.Effect<A | null, never> =>
  Effect.tryPromise({
    try: async () => JSON.parse(await readFile(filePath, 'utf8')) as A,
    catch: () => undefined,
  }).pipe(
    Effect.catchAll(() => Effect.succeed(null)),
  )

const writeJson = (filePath: string, data: unknown): Effect.Effect<void, never> =>
  Effect.promise(async () => {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`)
  }).pipe(Effect.catchAll(() => Effect.void))

export const JsonConfigPersistenceLive = (workspaceDir: string) => {
  const configPath = path.join(workspaceDir, 'config.json')
  return Layer.succeed(
    ConfigPersistence,
    ConfigPersistence.of({
      load: readJson<AppConfig>(configPath),
      save: (cfg) => writeJson(configPath, cfg),
      clear: Effect.promise(() => rm(configPath, { force: true })).pipe(Effect.catchAll(() => Effect.void)),
    }),
  )
}

export const JsonStudyLoggerPersistenceLive = (workspaceDir: string) => {
  const logsPath = path.join(workspaceDir, 'logs.json')
  return Layer.succeed(
    StudyLoggerPersistence,
    StudyLoggerPersistence.of({
      load: readJson<Record<string, StudyLogEntry[]>>(logsPath).pipe(
        Effect.map((logs) => (logs ? new Map(Object.entries(logs)) : null)),
      ),
      save: (logs) => writeJson(logsPath, Object.fromEntries(logs)),
      clear: Effect.promise(() => rm(logsPath, { force: true })).pipe(Effect.catchAll(() => Effect.void)),
    }),
  )
}
