import { Effect, Context, Layer, Schedule } from "effect"
import { StorageError, ValidationError, type StorageErrorType } from '@/types/effects'

export class OPFSStorage extends Context.Tag("OPFSStorage")<
  OPFSStorage,
  {
    readonly saveFile: (fileId: string, arrayBuffer: ArrayBuffer) => Effect.Effect<void, StorageErrorType>
    readonly loadFile: (fileId: string) => Effect.Effect<ArrayBuffer, StorageErrorType>
    readonly fileExists: (fileId: string) => Effect.Effect<boolean, StorageErrorType>
    readonly deleteFile: (fileId: string) => Effect.Effect<void, StorageErrorType>
    readonly listFiles: Effect.Effect<string[], StorageErrorType>
    readonly clearAllFiles: Effect.Effect<void, StorageErrorType>
    readonly getStorageInfo: Effect.Effect<{ used: number; quota: number }, StorageErrorType>
  }
>() {
  static isSupported(): boolean {
    return 'storage' in navigator && 'getDirectory' in navigator.storage
  }
}

export const OPFSStorageLive = Layer.succeed(
  OPFSStorage,
  (() => {
    const rootDirName = 'dicom-files'
    let rootDirHandle: FileSystemDirectoryHandle | null = null

    const initEffect = (): Effect.Effect<void, StorageErrorType> =>
      Effect.gen(function* () {
        if (!OPFSStorage.isSupported()) {
          return yield* Effect.fail(new StorageError({
            message: 'OPFS is not supported in this browser',
            operation: 'init'
          }))
        }

        const root = yield* Effect.tryPromise({
          try: () => navigator.storage.getDirectory(),
          catch: (error) => new StorageError({
            message: 'Failed to access OPFS root directory',
            operation: 'init',
            cause: error
          })
        })

        const rootDir = yield* Effect.tryPromise({
          try: () => root.getDirectoryHandle(rootDirName, { create: true }),
          catch: (error) => new StorageError({
            message: `Failed to create/access directory: ${rootDirName}`,
            operation: 'init',
            cause: error
          })
        })

        rootDirHandle = rootDir
      })

    const saveFile = (fileId: string, arrayBuffer: ArrayBuffer): Effect.Effect<void, StorageErrorType> =>
      Effect.gen(function* () {
        // Validate inputs
        if (!fileId || fileId.trim() === '') {
          return yield* Effect.fail(new ValidationError({
            message: 'File ID cannot be empty',
            fileName: fileId
          }))
        }

        if (arrayBuffer.byteLength === 0) {
          return yield* Effect.fail(new ValidationError({
            message: `Cannot save empty file: ${fileId}`,
            fileName: fileId
          }))
        }

        // Ensure initialized
        if (!rootDirHandle) {
          yield* initEffect()
        }

        // Create file handle
        const fileHandle = yield* Effect.tryPromise({
          try: () => rootDirHandle!.getFileHandle(`${fileId}.dcm`, { create: true }),
          catch: (error) => new StorageError({
            message: `Failed to create file handle for: ${fileId}`,
            operation: 'save',
            fileName: fileId,
            cause: error
          })
        })

        // Create writable stream
        const writable = yield* Effect.tryPromise({
          try: () => fileHandle.createWritable(),
          catch: (error) => new StorageError({
            message: `Failed to create writable stream for: ${fileId}`,
            operation: 'save',
            fileName: fileId,
            cause: error
          })
        })

        // Write and close
        yield* Effect.tryPromise({
          try: async () => {
            await writable.write(arrayBuffer)
            await writable.close()
          },
          catch: (error) => new StorageError({
            message: `Failed to write file: ${fileId}`,
            operation: 'save',
            fileName: fileId,
            cause: error
          })
        })
      })

    // Core file loading logic without retry
    const loadFileCore = (fileId: string): Effect.Effect<ArrayBuffer, StorageErrorType> =>
      Effect.gen(function* () {
        // Validate input
        if (!fileId || fileId.trim() === '') {
          return yield* Effect.fail(new ValidationError({
            message: 'File ID cannot be empty',
            fileName: fileId
          }))
        }

        // Ensure initialized
        if (!rootDirHandle) {
          yield* initEffect()
        }

        // Get file handle
        const fileHandle = yield* Effect.tryPromise({
          try: () => rootDirHandle!.getFileHandle(`${fileId}.dcm`),
          catch: (error) => new StorageError({
            message: `File not found: ${fileId}`,
            operation: 'load',
            fileName: fileId,
            cause: error
          })
        })

        // Get file
        const file = yield* Effect.tryPromise({
          try: () => fileHandle.getFile(),
          catch: (error) => new StorageError({
            message: `Failed to access file: ${fileId}`,
            operation: 'load',
            fileName: fileId,
            cause: error
          })
        })

        // Read as ArrayBuffer
        const arrayBuffer = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (error) => new StorageError({
            message: `Failed to read file: ${fileId}`,
            operation: 'load',
            fileName: fileId,
            cause: error
          })
        })

        return arrayBuffer
      })

    // Public loadFile with retry logic for race condition protection
    const loadFile = (fileId: string): Effect.Effect<ArrayBuffer, StorageErrorType> =>
      loadFileCore(fileId).pipe(
        Effect.retry(
          Schedule.exponential("100 millis").pipe(
            Schedule.intersect(Schedule.recurs(3))
          )
        ),
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            // Log the final failure after all retries
            yield* Effect.logWarning(`Failed to load file ${fileId} after retries: ${error.message}`)
            return yield* Effect.fail(error)
          })
        )
      )

    // Check if a file exists in OPFS
    const fileExists = (fileId: string): Effect.Effect<boolean, StorageErrorType> =>
      Effect.gen(function* () {
        // Validate input
        if (!fileId || fileId.trim() === '') {
          return yield* Effect.fail(new ValidationError({
            message: 'File ID cannot be empty',
            fileName: fileId
          }))
        }

        // Ensure initialized
        if (!rootDirHandle) {
          yield* initEffect()
        }

        // Try to get file handle - if it exists, return true, otherwise false
        return yield* Effect.tryPromise({
          try: async () => {
            await rootDirHandle!.getFileHandle(`${fileId}.dcm`)
            return true
          },
          catch: () => false // File doesn't exist
        }).pipe(
          Effect.orElse(() => Effect.succeed(false))
        )
      })

    const deleteFile = (fileId: string): Effect.Effect<void, StorageErrorType> =>
      Effect.gen(function* () {
        if (!fileId || fileId.trim() === '') {
          return yield* Effect.fail(new ValidationError({
            message: 'File ID cannot be empty',
            fileName: fileId
          }))
        }

        if (!rootDirHandle) {
          yield* initEffect()
        }

        yield* Effect.tryPromise({
          try: () => rootDirHandle!.removeEntry(`${fileId}.dcm`),
          catch: (error) => new StorageError({
            message: `Failed to delete file: ${fileId}`,
            operation: 'delete',
            fileName: fileId,
            cause: error
          })
        })
      })

    const listFiles: Effect.Effect<string[], StorageErrorType> = Effect.gen(function* () {
      if (!rootDirHandle) {
        yield* initEffect()
      }

      const fileIds: string[] = []

      const entries = yield* Effect.tryPromise({
        try: async () => {
          const entries = []
          // @ts-expect-error - values() exists but TypeScript types might be outdated
          for await (const entry of rootDirHandle!.values()) {
            entries.push(entry)
          }
          return entries
        },
        catch: (error) => new StorageError({
          message: 'Failed to list directory entries',
          operation: 'list',
          cause: error
        })
      })

      for (const entry of entries) {
        if (entry.kind === 'file' && entry.name.endsWith('.dcm')) {
          fileIds.push(entry.name.slice(0, -4))
        }
      }

      return fileIds
    })

    const clearAllFiles: Effect.Effect<void, StorageErrorType> = Effect.gen(function* () {
      if (!rootDirHandle) {
        yield* initEffect()
      }

      const entries = yield* Effect.tryPromise({
        try: async () => {
          const entries = []
          // @ts-expect-error - values() exists but TypeScript types might be outdated
          for await (const entry of rootDirHandle!.values()) {
            entries.push(entry)
          }
          return entries
        },
        catch: (error) => new StorageError({
          message: 'Failed to list directory entries for clearing',
          operation: 'clear',
          cause: error
        })
      })

      // Delete files concurrently with Effect
      const deleteOperations = entries
        .filter(entry => entry.kind === 'file')
        .map(entry =>
          Effect.tryPromise({
            try: () => rootDirHandle!.removeEntry(entry.name),
            catch: (error) => new StorageError({
              message: `Failed to delete file: ${entry.name}`,
              operation: 'clear',
              fileName: entry.name,
              cause: error
            })
          })
        )

      yield* Effect.all(deleteOperations, { concurrency: 5, batching: true })
    })

    const getStorageInfo: Effect.Effect<{ used: number; quota: number }, StorageErrorType> = Effect.gen(function* () {
      const estimate = yield* Effect.tryPromise({
        try: () => navigator.storage.estimate(),
        catch: (error) => new StorageError({
          message: 'Failed to get storage estimate',
          operation: 'info',
          cause: error
        })
      })

      return {
        used: estimate.usage || 0,
        quota: estimate.quota || 0
      }
    })

    return {
      saveFile,
      loadFile,
      fileExists,
      deleteFile,
      listFiles,
      clearAllFiles,
      getStorageInfo
    } as const
  })()
)

