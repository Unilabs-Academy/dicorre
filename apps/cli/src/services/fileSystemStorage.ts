import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { FileStorage } from '@dicorre/shared/services/fileStorage'
import { StorageError, ValidationError, type StorageErrorType } from '@dicorre/shared/types/effects'

export class StorageRoot extends Context.Tag('StorageRoot')<StorageRoot, string>() {}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const encodeFileId = (fileId: string): string => `${encodeURIComponent(fileId)}.dcm`
const decodeFileName = (fileName: string): string => decodeURIComponent(fileName.slice(0, -4))

const validateFileId = (fileId: string): Effect.Effect<void, ValidationError> =>
  fileId.trim().length > 0
    ? Effect.void
    : Effect.fail(new ValidationError({ message: 'File ID cannot be empty', fileName: fileId }))

const directorySize = async (dir: string): Promise<number> => {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(fullPath)
    } else if (entry.isFile()) {
      total += (await stat(fullPath)).size
    }
  }
  return total
}

export const FileSystemStorageLive = (rootDir: string) =>
  Layer.effect(
    FileStorage,
    Effect.sync(() => {
      const filesDir = path.join(rootDir, 'files')
      const filePath = (fileId: string): string => path.join(filesDir, encodeFileId(fileId))

      const saveFile = (fileId: string, arrayBuffer: ArrayBuffer): Effect.Effect<void, StorageErrorType> =>
        Effect.gen(function* () {
          yield* validateFileId(fileId)
          if (arrayBuffer.byteLength === 0) {
            return yield* Effect.fail(new ValidationError({
              message: `Cannot save empty file: ${fileId}`,
              fileName: fileId,
            }))
          }
          yield* Effect.tryPromise({
            try: async () => {
              await mkdir(filesDir, { recursive: true })
              await writeFile(filePath(fileId), Buffer.from(arrayBuffer))
            },
            catch: (error) => new StorageError({
              message: `Failed to save file: ${fileId}`,
              operation: 'save',
              fileName: fileId,
              cause: error,
            }),
          })
        })

      const loadFile = (fileId: string): Effect.Effect<ArrayBuffer, StorageErrorType> =>
        Effect.gen(function* () {
          yield* validateFileId(fileId)
          const bytes = yield* Effect.tryPromise({
            try: () => readFile(filePath(fileId)),
            catch: (error) => new StorageError({
              message: `File not found: ${fileId}`,
              operation: 'load',
              fileName: fileId,
              cause: error,
            }),
          })
          return toArrayBuffer(bytes)
        })

      const fileExists = (fileId: string): Effect.Effect<boolean, StorageErrorType> =>
        Effect.gen(function* () {
          yield* validateFileId(fileId)
          return yield* Effect.tryPromise({
            try: async () => {
              await stat(filePath(fileId))
              return true
            },
            catch: () => false,
          }).pipe(Effect.orElse(() => Effect.succeed(false)))
        })

      const deleteFile = (fileId: string): Effect.Effect<void, StorageErrorType> =>
        Effect.gen(function* () {
          yield* validateFileId(fileId)
          yield* Effect.tryPromise({
            try: () => rm(filePath(fileId), { force: true }),
            catch: (error) => new StorageError({
              message: `Failed to delete file: ${fileId}`,
              operation: 'delete',
              fileName: fileId,
              cause: error,
            }),
          })
        })

      const listFiles: Effect.Effect<string[], StorageErrorType> = Effect.tryPromise({
        try: async () => {
          await mkdir(filesDir, { recursive: true })
          const entries = await readdir(filesDir, { withFileTypes: true })
          return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.dcm'))
            .map((entry) => decodeFileName(entry.name))
        },
        catch: (error) => new StorageError({
          message: 'Failed to list storage files',
          operation: 'list',
          cause: error,
        }),
      })

      const clearAllFiles: Effect.Effect<void, StorageErrorType> = Effect.tryPromise({
        try: async () => {
          await rm(filesDir, { recursive: true, force: true })
          await mkdir(filesDir, { recursive: true })
        },
        catch: (error) => new StorageError({
          message: 'Failed to clear storage files',
          operation: 'clear',
          cause: error,
        }),
      })

      const getStorageInfo: Effect.Effect<{ used: number; quota: number }, StorageErrorType> =
        Effect.tryPromise({
          try: async () => ({ used: await directorySize(filesDir), quota: Number.MAX_SAFE_INTEGER }),
          catch: (error) => new StorageError({
            message: 'Failed to read storage info',
            operation: 'info',
            cause: error,
          }),
        })

      return FileStorage.of({
        saveFile,
        loadFile,
        fileExists,
        deleteFile,
        listFiles,
        clearAllFiles,
        getStorageInfo,
      })
    }),
  )
