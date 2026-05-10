import { Context, Effect } from 'effect'
import type { StorageErrorType } from '@dicorre/shared/types/effects'

export class FileStorage extends Context.Tag('FileStorage')<
  FileStorage,
  {
    readonly saveFile: (fileId: string, arrayBuffer: ArrayBuffer) => Effect.Effect<void, StorageErrorType>
    readonly loadFile: (fileId: string) => Effect.Effect<ArrayBuffer, StorageErrorType>
    readonly fileExists: (fileId: string) => Effect.Effect<boolean, StorageErrorType>
    readonly deleteFile: (fileId: string) => Effect.Effect<void, StorageErrorType>
    readonly listFiles: Effect.Effect<string[], StorageErrorType>
    readonly clearAllFiles: Effect.Effect<void, StorageErrorType>
    readonly getStorageInfo: Effect.Effect<{ used: number; quota: number }, StorageErrorType>
  }
>() {}
