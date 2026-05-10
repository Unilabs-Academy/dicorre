import { ManagedRuntime } from 'effect'
import { Data } from "effect"

export type RuntimeType = ReturnType<typeof ManagedRuntime.make<any, any>>

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string
  readonly fileName?: string
  readonly cause?: unknown
}> { }

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string
  readonly fileName?: string
  readonly field?: string
  readonly value?: unknown
}> { }

export class AnonymizationError extends Data.TaggedError("AnonymizationError")<{
  readonly message: string
  readonly fileName?: string
  readonly cause?: unknown
}> { }

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string
  readonly url?: string
  readonly status?: number
  readonly cause?: unknown
}> { }

export class CancelledError extends Data.TaggedError("CancelledError")<{
  readonly message: string
  readonly cause?: unknown
}> { }

export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly message: string
  readonly path?: string
  readonly operation?: string
  readonly cause?: unknown
}> { }

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly message: string
  readonly setting?: string
  readonly value?: unknown
}> { }

export class FileHandlerError extends Data.TaggedError("FileHandlerError")<{
  readonly message: string
  readonly fileName?: string
  readonly cause?: unknown
}> { }

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string
  readonly operation?: string
  readonly fileName?: string
  readonly cause?: unknown
}> { }

export class PluginError extends Data.TaggedError("PluginError")<{
  readonly message: string
  readonly pluginId?: string
  readonly cause?: unknown
}> { }

// Union types for different service error domains
export type DicomProcessorError = ParseError | ValidationError | FileSystemError
export type AnonymizerError = AnonymizationError | ConfigurationError | FileSystemError | ParseError | ValidationError
export type DicomSenderError = NetworkError | ValidationError | ConfigurationError | CancelledError
export type FileHandlerErrorType = FileHandlerError | ValidationError | FileSystemError
export type StorageErrorType = StorageError | ValidationError
export type PluginErrorType = PluginError | ValidationError
