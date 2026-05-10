import { Effect, Context, Layer } from "effect"
import { OPFSStorage } from "@/services/opfsStorage"
import { DicomProcessor } from "@/services/dicomProcessor"
import type { DicomFile, DicomFileMetadata, DicomStudy } from "@/types/dicom"

interface PersistedSession {
  files: DicomFileMetadata[]
  studies: Array<{
    studyInstanceUID: string
    patientId?: string
    assignedPatientId?: string
    customFields?: Record<string, string>
  }>
}

const STORAGE_KEY = 'dicom-session'

export class SessionPersistence extends Context.Tag("SessionPersistence")<
  SessionPersistence,
  {
    readonly persist: (files: ReadonlyArray<DicomFile>, studies?: ReadonlyArray<DicomStudy>) => Effect.Effect<void, never>
    readonly restore: (onProgress?: (progress: number) => void) => Effect.Effect<{ files: DicomFile[]; studies: DicomStudy[] }, never>
    readonly clear: Effect.Effect<void, never>
  }
>() { }

export const SessionPersistenceLive = Layer.scoped(
  SessionPersistence,
  Effect.gen(function* () {
    const storage = yield* OPFSStorage
    const processor = yield* DicomProcessor

    const readPersisted = Effect.sync(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return { files: [], studies: [] } as PersistedSession
        const parsed = JSON.parse(raw) as PersistedSession
        if (!parsed || !Array.isArray(parsed.files)) return { files: [], studies: [] }
        if (!Array.isArray((parsed as any).studies)) (parsed as any).studies = []
        return parsed
      } catch {
        return { files: [], studies: [] }
      }
    })

    const writePersisted = (files: ReadonlyArray<DicomFile>, studies?: ReadonlyArray<DicomStudy>) =>
      Effect.sync(() => {
        const payload: PersistedSession = {
          files: files.map<DicomFileMetadata>((f) => ({
            id: f.id,
            fileName: f.fileName,
            fileSize: f.fileSize,
            metadata: f.metadata,
            anonymized: f.anonymized,
            sent: f.sent
          })),
          studies: (studies ?? []).map((s) => ({
            studyInstanceUID: s.studyInstanceUID,
            patientId: s.patientId,
            assignedPatientId: (s as any).assignedPatientId,
            customFields: (s as any).customFields
          }))
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
        } catch {
          // ignore
        }
      })

    const persist = (files: ReadonlyArray<DicomFile>, studiesArg?: ReadonlyArray<DicomStudy>): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        if (files.length === 0) return

        const existingIds = new Set((yield* readPersisted).files.map((m) => m.id))

        for (const file of files) {
          if (!existingIds.has(file.id)) {
            yield* Effect.catchAll(
              Effect.gen(function* () {
                const exists = yield* storage.fileExists(file.id)
                if (!exists) {
                  yield* storage.saveFile(file.id, file.arrayBuffer)
                  const verify = yield* storage.fileExists(file.id)
                  if (!verify) {
                    // best-effort; do not fail the persistence effect
                  }
                }
              }),
              () => Effect.succeed(undefined) // ignore OPFS failures in persist
            )
          }
        }

        yield* writePersisted(files, studiesArg)
      })

    const restore = (onProgress?: (progress: number) => void): Effect.Effect<{ files: DicomFile[]; studies: DicomStudy[] }, never> =>
      Effect.gen(function* () {
        const persisted = yield* readPersisted

        // Defensive OPFS GC before rebuilding any state
        const opfsIds = yield* Effect.catchAll(
          storage.listFiles,
          () => Effect.succeed([] as string[])
        )
        if (!persisted.files || persisted.files.length === 0) {
          // No session references remain: purge all OPFS files
          if (opfsIds.length > 0) {
            const deleteAll = opfsIds.map((id) =>
              storage.deleteFile(id).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
            )
            yield* Effect.all(deleteAll, { concurrency: 5, batching: true })
          }
          return { files: [], studies: [] }
        } else if (opfsIds.length > 0) {
          const persistedIds = new Set(persisted.files.map((m) => m.id))
          const toDelete = opfsIds.filter((id) => !persistedIds.has(id))
          if (toDelete.length > 0) {
            const deleteDangling = toDelete.map((id) =>
              storage.deleteFile(id).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
            )
            yield* Effect.all(deleteDangling, { concurrency: 5, batching: true })
          }
        }

        const restored: DicomFile[] = []
        for (let idx = 0; idx < persisted.files.length; idx++) {
          const meta = persisted.files[idx]
          // Do not load bytes into memory; OPFS is the source of truth
          restored.push({
            id: meta.id,
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            arrayBuffer: new ArrayBuffer(0),
            metadata: meta.metadata,
            anonymized: meta.anonymized,
            sent: meta.sent,
            opfsFileId: meta.id
          })
          if (onProgress) {
            try {
              onProgress(Math.round(((idx + 1) / persisted.files.length) * 100))
            } catch { }
          }
        }

        const studies = yield* Effect.catchAll(
          processor.groupFilesByStudy(restored),
          () => Effect.succeed([] as DicomStudy[])
        )

        // Merge persisted assignedPatientId back into rebuilt studies
        const assignedMap = new Map(persisted.studies.map(s => [s.studyInstanceUID, s.assignedPatientId]))
        const customMap = new Map(persisted.studies.map(s => [s.studyInstanceUID, s.customFields]))
        const merged = studies.map(s => ({
          ...s,
          assignedPatientId: assignedMap.get(s.studyInstanceUID) || (s as any).assignedPatientId,
          customFields: customMap.get(s.studyInstanceUID) || (s as any).customFields
        }))

        return { files: restored, studies: merged }
      })

    const clear: Effect.Effect<void, never> = Effect.gen(function* () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ files: [], studies: [] } satisfies PersistedSession))
      } catch { }
      yield* Effect.catchAll(
        storage.clearAllFiles,
        () => Effect.succeed(undefined)
      )
    })

    return {
      persist,
      restore,
      clear
    } as const
  })
)


