import { Effect, Context, Layer } from "effect"
import type { DicomFile } from '@/types/dicom'
import type { DicomServerConfig } from '@/services/config/schema'
import { CancelledError, NetworkError, ValidationError, type DicomSenderError, type StorageErrorType } from '@/types/effects'
import { OPFSStorage } from '@/services/opfsStorage'
import { DicomSplitError, inspectMultiframeSplit, splitMultiframeDicom, type SplitRefusalReason } from '@/services/dicomSplitter'

export type SendFailureKind = 'timeout' | 'network' | 'http' | 'server-reported' | 'validation'

export interface SendWarningResult {
  readonly file: DicomFile
  readonly fileName: string
  readonly sopInstanceUID?: string
  readonly message: string
  readonly httpStatus?: number
}

export interface SendSplitFallbackResult {
  readonly file: DicomFile
  readonly fileName: string
  readonly status: 'started' | 'succeeded' | 'skipped' | 'failed'
  readonly message: string
  readonly reason?: SplitRefusalReason
  readonly frameCount?: number
  readonly derivedSeriesInstanceUID?: string
}

export interface SendSkippedResult {
  readonly file: DicomFile
  readonly fileName: string
  readonly reason: string
}

export interface SendFailureResult {
  readonly file: DicomFile
  readonly fileName: string
  readonly id: string
  readonly sopInstanceUID?: string
  readonly modality?: string
  readonly fileSize: number
  readonly attempts: number
  readonly failureKind: SendFailureKind
  readonly httpStatus?: number
  readonly timeoutMs?: number
  readonly message: string
}

export interface SendSuccessResult {
  readonly file: DicomFile
  readonly fileName: string
  readonly attempts: number
  readonly httpStatus?: number
  readonly warnings: SendWarningResult[]
}

export interface SendStudyResult {
  readonly succeeded: SendSuccessResult[]
  readonly failed: SendFailureResult[]
  readonly skipped: SendSkippedResult[]
  readonly warnings: SendWarningResult[]
  readonly total: number
  readonly attempted: number
  readonly succeededCount: number
  readonly failedCount: number
  readonly skippedCount: number
  readonly warningCount: number
}

export interface SendProgressUpdate {
  readonly total: number
  readonly completed: number
  readonly percentage: number
  readonly currentFile?: DicomFile
  readonly sentCount: number
  readonly failedCount: number
  readonly retryingFile?: DicomFile
  readonly retryAttempt?: number
  readonly status: 'sending' | 'retrying' | 'waiting' | 'timed-out'
  readonly statusText?: string
}

interface ParsedStowIssue {
  readonly sopInstanceUID?: string
  readonly message: string
  readonly warningReason?: string
  readonly failureReason?: string
}

interface ParsedStowResponse {
  readonly failures: ParsedStowIssue[]
  readonly warnings: ParsedStowIssue[]
}

interface SendAttemptSuccess {
  readonly httpStatus?: number
  readonly warnings: ParsedStowIssue[]
}

class SendAttemptError extends Error {
  readonly failureKind: SendFailureKind
  readonly httpStatus?: number
  readonly retryable: boolean
  readonly timeoutMs?: number

  constructor(params: {
    message: string
    failureKind: SendFailureKind
    httpStatus?: number
    retryable: boolean
    timeoutMs?: number
  }) {
    super(params.message)
    this.name = 'SendAttemptError'
    this.failureKind = params.failureKind
    this.httpStatus = params.httpStatus
    this.retryable = params.retryable
    this.timeoutMs = params.timeoutMs
  }
}

const MAX_RETRIES = 2
const DEFAULT_SEND_TIMEOUT_MS = 30000
const MAX_SEND_TIMEOUT_MS = 600000
const LARGE_FILE_TIMEOUT_THRESHOLD_BYTES = 50 * 1024 * 1024
const LARGE_FILE_TIMEOUT_BYTES_PER_SECOND = 2 * 1024 * 1024

export const LARGE_DICOM_FILE_WARNING_BYTES = 100 * 1024 * 1024
export const EXTREME_DICOM_FILE_WARNING_BYTES = 500 * 1024 * 1024

const FAILURE_REASON_MAP: Record<string, string> = {
  '272': 'Duplicate SOP instance',
  '290': 'Storage out of resources',
  '43264': 'Coercion of data elements',
  '43265': 'Dataset does not match SOP class',
  '45056': 'Cannot understand'
}

const WARNING_REASON_MAP: Record<string, string> = {
  '45056': 'Elements discarded',
  '45057': 'Dataset does not match SOP class',
  '45058': 'Coercion of data elements'
}

const getRetryDelayMs = (attemptNumber: number): number => {
  const base = attemptNumber === 1 ? 1000 : 3000
  const jitter = Math.floor(Math.random() * 250)
  return base + jitter
}

const shouldRetryStatus = (status?: number): boolean =>
  status === 408 || status === 429 || (status !== undefined && status >= 500)

export const getEffectiveSendTimeoutMs = (
  file: Pick<DicomFile, 'fileSize' | 'arrayBuffer'>,
  config: Pick<DicomServerConfig, 'timeout'>,
  attemptNumber = 1
): number => {
  const configuredTimeout = Math.min(config.timeout ?? DEFAULT_SEND_TIMEOUT_MS, MAX_SEND_TIMEOUT_MS)
  const fileSize = Math.max(file.fileSize || 0, file.arrayBuffer?.byteLength || 0)

  if (fileSize < LARGE_FILE_TIMEOUT_THRESHOLD_BYTES) {
    return configuredTimeout
  }

  const uploadBudgetMs = Math.ceil((fileSize / LARGE_FILE_TIMEOUT_BYTES_PER_SECOND) * 1000)
  const adaptiveTimeout = Math.max(configuredTimeout, configuredTimeout + uploadBudgetMs)
  const retryMultiplier = 1 + Math.max(0, attemptNumber - 1) * 0.5

  return Math.min(Math.ceil(adaptiveTimeout * retryMultiplier), MAX_SEND_TIMEOUT_MS)
}

const getValueList = (dataset: Record<string, any>, naturalKey: string, hexKey: string): any[] => {
  const natural = dataset[naturalKey]
  if (Array.isArray(natural)) return natural
  if (natural !== undefined && natural !== null) return [natural]

  const hex = dataset[hexKey]
  if (hex && Array.isArray(hex.Value)) return hex.Value

  return []
}

const getFirstStringValue = (dataset: Record<string, any>, naturalKey: string, hexKey: string): string | undefined => {
  const values = getValueList(dataset, naturalKey, hexKey)
  const first = values[0]
  return typeof first === 'string' || typeof first === 'number' ? String(first) : undefined
}

const formatReason = (value: string | undefined, lookup: Record<string, string>, fallback: string): string => {
  if (!value) return fallback
  return lookup[value] || `${fallback} (${value})`
}

const parseIssueSequence = (
  dataset: Record<string, any>,
  naturalKey: string,
  hexKey: string,
  kind: 'failure' | 'warning'
): ParsedStowIssue[] => {
  const items = getValueList(dataset, naturalKey, hexKey)
  return items
    .filter((item): item is Record<string, any> => !!item && typeof item === 'object')
    .filter((item) => {
      if (kind === 'failure') return true
      return !!getFirstStringValue(item, 'WarningReason', '00081196')
    })
    .map((item) => {
      const sopInstanceUID = getFirstStringValue(item, 'ReferencedSOPInstanceUID', '00081155')
      const failureReason = getFirstStringValue(item, 'FailureReason', '00081197')
      const warningReason = getFirstStringValue(item, 'WarningReason', '00081196')

      let message = kind === 'failure'
        ? formatReason(failureReason, FAILURE_REASON_MAP, 'Server rejected instance')
        : formatReason(warningReason, WARNING_REASON_MAP, 'Server accepted with warning')

      if (!failureReason && !warningReason && sopInstanceUID) {
        message = kind === 'failure'
          ? `Server rejected SOP ${sopInstanceUID}`
          : `Server warned for SOP ${sopInstanceUID}`
      }

      return {
        sopInstanceUID,
        message,
        failureReason,
        warningReason
      }
    })
}

const parseStowResponse = (bodyText: string): ParsedStowResponse => {
  if (!bodyText.trim()) {
    return { failures: [], warnings: [] }
  }

  try {
    const parsed = JSON.parse(bodyText)
    const dataset = Array.isArray(parsed) ? parsed[0] : parsed
    if (!dataset || typeof dataset !== 'object') {
      return { failures: [], warnings: [] }
    }

    return {
      failures: [
        ...parseIssueSequence(dataset, 'FailedSOPSequence', '00081198', 'failure'),
        ...parseIssueSequence(dataset, 'OtherFailuresSequence', '0008119A', 'failure')
      ],
      warnings: parseIssueSequence(dataset, 'ReferencedSOPSequence', '00081199', 'warning')
    }
  } catch {
    return { failures: [], warnings: [] }
  }
}

const toWarningResult = (file: DicomFile, issue: ParsedStowIssue, httpStatus?: number): SendWarningResult => ({
  file,
  fileName: file.fileName,
  sopInstanceUID: issue.sopInstanceUID || file.metadata?.sopInstanceUID,
  message: issue.message,
  httpStatus
})

const toFailureResult = (
  file: DicomFile,
  failureKind: SendFailureKind,
  message: string,
  attempts: number,
  httpStatus?: number,
  timeoutMs?: number
): SendFailureResult => ({
  file,
  fileName: file.fileName,
  id: file.id,
  sopInstanceUID: file.metadata?.sopInstanceUID,
  modality: file.metadata?.modality,
  fileSize: file.fileSize,
  attempts,
  failureKind,
  httpStatus,
  timeoutMs,
  message
})

const executeSendAttempt = (
  candidate: DicomFile,
  serverConfig: DicomServerConfig,
  signal?: AbortSignal,
  attemptNumber = 1
): Effect.Effect<SendAttemptSuccess, SendAttemptError | ValidationError | CancelledError> =>
  Effect.gen(function* () {
    if (!candidate.arrayBuffer || candidate.arrayBuffer.byteLength === 0) {
      return yield* Effect.fail(new ValidationError({
        message: `File ${candidate.fileName} has no data`,
        fileName: candidate.fileName
      }))
    }

    if (!candidate.metadata?.sopInstanceUID) {
      return yield* Effect.fail(new ValidationError({
        message: `File ${candidate.fileName} has no SOP Instance UID`,
        fileName: candidate.fileName
      }))
    }

    yield* Effect.log(`Sending DICOM file: ${candidate.fileName}`)

    const headers: Record<string, string> = {
      'Accept': 'application/dicom+json',
      ...serverConfig.headers
    }

    if (serverConfig.auth) {
      if (serverConfig.auth.type === 'basic') {
        headers['Authorization'] = `Basic ${serverConfig.auth.credentials}`
      } else if (serverConfig.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${serverConfig.auth.credentials}`
      }
    }

    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`
    const contentType = `multipart/related; type="application/dicom"; boundary=${boundary}`

    const textPart = [
      `--${boundary}`,
      'Content-Type: application/dicom',
      '',
      ''
    ].join('\r\n')

    const endBoundary = `\r\n--${boundary}--`
    const textPartBytes = new TextEncoder().encode(textPart)
    const endBoundaryBytes = new TextEncoder().encode(endBoundary)
    const body = new Blob([textPartBytes, candidate.arrayBuffer, endBoundaryBytes], { type: contentType })

    const timeoutMs = getEffectiveSendTimeoutMs(candidate, serverConfig, attemptNumber)
    const controller = new AbortController()
    let cancelled = false
    const abortForTimeout = () => {
      controller.abort()
    }
    const abortForCancel = () => {
      cancelled = true
      controller.abort()
    }
    const timeoutId = setTimeout(abortForTimeout, timeoutMs)
    const onCancel = () => abortForCancel()

    if (signal) {
      if (signal.aborted) {
        cancelled = true
        clearTimeout(timeoutId)
        return yield* Effect.fail(new CancelledError({
          message: `Sending cancelled while sending ${candidate.fileName}`
        }))
      }
      signal.addEventListener('abort', onCancel, { once: true })
    }

    try {
      const stowUrl = `${serverConfig.url}/studies`
      const response = yield* Effect.tryPromise({
        try: async () => fetch(stowUrl, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': contentType
          },
          body,
          signal: controller.signal
        }),
        catch: (error) => {
          if (cancelled || signal?.aborted) {
            return new CancelledError({
              message: `Sending cancelled while sending ${candidate.fileName}`,
              cause: error
            })
          }

          if ((error as Error)?.name === 'AbortError') {
            return new SendAttemptError({
              message: `Timed out after ${timeoutMs}ms while sending ${candidate.fileName}`,
              failureKind: 'timeout',
              retryable: true,
              timeoutMs
            })
          }

          return new SendAttemptError({
            message: `Network error while sending ${candidate.fileName}: ${error instanceof Error ? error.message : String(error)}`,
            failureKind: 'network',
            retryable: true
          })
        }
      })

      const responseText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (error) => new SendAttemptError({
          message: `Failed to read STOW-RS response for ${candidate.fileName}: ${error instanceof Error ? error.message : String(error)}`,
          failureKind: 'network',
          httpStatus: response.status,
          retryable: shouldRetryStatus(response.status)
        })
      })

      if (!response.ok) {
        return yield* Effect.fail(new SendAttemptError({
          message: `STOW-RS failed: ${response.status} ${response.statusText}${responseText ? ` - ${responseText}` : ''}`,
          failureKind: 'http',
          httpStatus: response.status,
          retryable: shouldRetryStatus(response.status)
        }))
      }

      const parsed = parseStowResponse(responseText)
      if (parsed.failures.length > 0) {
        const firstFailure = parsed.failures[0]
        return yield* Effect.fail(new SendAttemptError({
          message: firstFailure?.message || `Server reported failure for ${candidate.fileName}`,
          failureKind: 'server-reported',
          httpStatus: response.status,
          retryable: false
        }))
      }

      return {
        httpStatus: response.status,
        warnings: parsed.warnings
      }
    } finally {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onCancel)
    }
  })


export class DicomSender extends Context.Tag("DicomSender")<
  DicomSender,
  {
    readonly testConnection: (config: DicomServerConfig) => Effect.Effect<boolean, DicomSenderError>
    readonly sendFile: (
      file: DicomFile,
      config: DicomServerConfig,
      options?: { signal?: AbortSignal; attemptNumber?: number }
    ) => Effect.Effect<SendSuccessResult, DicomSenderError>
    readonly sendFiles: (
      files: DicomFile[],
      config: DicomServerConfig,
      concurrency?: number,
      options?: {
        signal?: AbortSignal
        onProgress?: (progress: SendProgressUpdate) => void
        onSkip?: (file: DicomFile, reason: string) => void
	        onFileRetry?: (failure: SendFailureResult, nextAttempt: number, delayMs: number) => void
	        onFileFailure?: (failure: SendFailureResult) => void
	        onFileWarning?: (warning: SendWarningResult) => void
	        onSplitFallback?: (fallback: SendSplitFallbackResult) => void
	      }
    ) => Effect.Effect<SendStudyResult, DicomSenderError | StorageErrorType, OPFSStorage | DicomSender>
  }
>() { }

/**
 * Live implementation layer - stateless, accepts config as parameter
 */
export const DicomSenderLive = Layer.succeed(
  DicomSender,
  {
    testConnection: (config: DicomServerConfig): Effect.Effect<boolean, DicomSenderError> =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: async () => {
            const path = (config as any).testConnectionPath || "/studies"
            const normalizedPath = path.startsWith("/") ? path : `/${path}`
            const testUrl = `${config.url}${normalizedPath}`
            const response = await fetch(testUrl, {
              method: 'GET',
              headers: { 'Accept': 'application/dicom+json', ...config.headers }
            })
            return response.ok
          },
          catch: (error) => new NetworkError({
            message: `Failed to connect to DICOM server: ${config.url}/${config.testConnectionPath}`,
            cause: error
          })
        })

        return result
      }),

    sendFile: (
      file: DicomFile,
      config: DicomServerConfig,
      options?: { signal?: AbortSignal; attemptNumber?: number }
    ): Effect.Effect<SendSuccessResult, DicomSenderError> =>
      Effect.gen(function* () {
        const result = yield* executeSendAttempt(file, config, options?.signal, options?.attemptNumber).pipe(
          Effect.mapError((error) => {
            if (error instanceof CancelledError || error instanceof ValidationError) {
              return error
            }

            return new NetworkError({
              message: error.message,
              url: `${config.url}/studies`,
              status: error.httpStatus,
              cause: error
            })
          })
        )

        return {
          file,
          fileName: file.fileName,
          attempts: 1,
          httpStatus: result.httpStatus,
          warnings: result.warnings.map((warning) => toWarningResult(file, warning, result.httpStatus))
        }
      }),

    sendFiles: (
      files: DicomFile[],
      config: DicomServerConfig,
      concurrency = 3,
      options?: {
        signal?: AbortSignal
        onProgress?: (progress: SendProgressUpdate) => void
        onSkip?: (file: DicomFile, reason: string) => void
	        onFileRetry?: (failure: SendFailureResult, nextAttempt: number, delayMs: number) => void
	        onFileFailure?: (failure: SendFailureResult) => void
	        onFileWarning?: (warning: SendWarningResult) => void
	        onSplitFallback?: (fallback: SendSplitFallbackResult) => void
	      }
    ): Effect.Effect<SendStudyResult, DicomSenderError | StorageErrorType, OPFSStorage | DicomSender> =>
      Effect.gen(function* () {
        if (files.length === 0) {
          return {
            succeeded: [],
            failed: [],
            skipped: [],
            warnings: [],
            total: 0,
            attempted: 0,
            succeededCount: 0,
            failedCount: 0,
            skippedCount: 0,
            warningCount: 0
          }
        }

        const filesToSend = files.filter((f) => f.anonymized)
        const nonAnonymized = files.filter((f) => !f.anonymized)
        const skipped: SendSkippedResult[] = nonAnonymized.map((file) => ({
          file,
          fileName: file.fileName,
          reason: 'not anonymized'
        }))

        if (nonAnonymized.length > 0) {
          for (const file of nonAnonymized) {
            try { options?.onSkip?.(file, 'not anonymized') } catch { }
          }
        }

        if (filesToSend.length === 0) {
          return yield* Effect.fail(new ValidationError({
            message: 'No anonymized files to send',
            fileName: nonAnonymized[0]?.fileName
          }))
        }

        const opfs = yield* OPFSStorage
        const sender = yield* DicomSender
        const total = filesToSend.length
        const succeeded: SendSuccessResult[] = []
        const failed: SendFailureResult[] = []
        const warnings: SendWarningResult[] = []
        let sentCount = 0
        let failedCount = 0
        let completed = 0

        const emitProgress = (patch: Partial<SendProgressUpdate>) => {
          try {
            options?.onProgress?.({
              total,
              completed,
              percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
              sentCount,
              failedCount,
              status: 'sending',
              ...patch
            })
          } catch { }
        }

	        const failIfCancelled = () =>
	          options?.signal?.aborted
	            ? Effect.fail(new CancelledError({ message: 'Sending was cancelled' }))
	            : Effect.void

	        const notifySplitFallback = (fallback: SendSplitFallbackResult) => {
	          try { options?.onSplitFallback?.(fallback) } catch { }
	        }

	        const shouldAttemptSplitFallback = (source: DicomFile, failureKind: SendFailureKind): boolean =>
	          source.fileSize >= EXTREME_DICOM_FILE_WARNING_BYTES &&
	          (failureKind === 'timeout' || failureKind === 'network')

	        const sendSplitFallback = (
	          source: DicomFile,
	          originalAttempts: number
	        ): Effect.Effect<SendSuccessResult | undefined, DicomSenderError> =>
	          Effect.gen(function* () {
	            const decision = inspectMultiframeSplit(source)
	            if (!decision.canSplit) {
	              notifySplitFallback({
	                file: source,
	                fileName: source.fileName,
	                status: 'skipped',
	                reason: decision.reason,
	                message: decision.message
	              })
	              return undefined
	            }

	            notifySplitFallback({
	              file: source,
	              fileName: source.fileName,
	              status: 'started',
	              frameCount: decision.frameCount,
	              message: `Sending ${decision.frameCount} derived frame instances after large file send failure`
	            })

	            const splitWarnings: SendWarningResult[] = []
	            let lastHttpStatus: number | undefined

	            const splitResult = yield* splitMultiframeDicom(source, (frame) =>
	              Effect.gen(function* () {
	                yield* failIfCancelled()
	                emitProgress({
	                  currentFile: frame.file,
	                  retryingFile: undefined,
	                  retryAttempt: undefined,
	                  status: 'sending',
	                  statusText: `Sending split frame ${frame.frameNumber}/${frame.totalFrames} for ${source.fileName}`
	                })

	                const frameResult = yield* sender.sendFile(frame.file, config, { signal: options?.signal, attemptNumber: 1 }).pipe(
	                  Effect.mapError((error) => {
	                    if (error instanceof CancelledError) return error
	                    return new NetworkError({
	                      message: `Split frame ${frame.frameNumber}/${frame.totalFrames} failed for ${source.fileName}: ${error.message}`,
	                      url: `${config.url}/studies`,
	                      cause: error
	                    })
	                  })
	                )

	                lastHttpStatus = frameResult.httpStatus
	                for (const warning of frameResult.warnings) {
	                  splitWarnings.push(warning)
	                  warnings.push(warning)
	                  options?.onFileWarning?.(warning)
	                }
	              })
	            ).pipe(
	              Effect.mapError((error) => {
	                if (error instanceof CancelledError || error instanceof NetworkError) return error
		                if (error instanceof DicomSplitError) {
		                  return new ValidationError({
		                    message: error.message,
		                    fileName: source.fileName
		                  })
		                }
		                return error
		              }),
	              Effect.either
	            )

	            if (splitResult._tag === 'Left') {
	              if (splitResult.left instanceof CancelledError) {
	                return yield* Effect.fail(splitResult.left)
	              }
	              notifySplitFallback({
	                file: source,
	                fileName: source.fileName,
	                status: 'failed',
	                frameCount: decision.frameCount,
	                message: splitResult.left.message
	              })
	              return undefined
	            }

	            notifySplitFallback({
	              file: source,
	              fileName: source.fileName,
	              status: 'succeeded',
	              frameCount: splitResult.right.frameCount,
	              derivedSeriesInstanceUID: splitResult.right.derivedSeriesInstanceUID,
	              message: `Sent ${splitResult.right.frameCount} derived frame instances`
	            })

	            return {
	              file: source,
	              fileName: source.fileName,
	              attempts: originalAttempts,
	              httpStatus: lastHttpStatus,
	              warnings: splitWarnings
	            }
	          })

        const sendEffects = filesToSend.map((file) =>
          Effect.gen(function* () {
            yield* failIfCancelled()

            emitProgress({
              currentFile: file,
              retryingFile: undefined,
              retryAttempt: undefined,
              status: 'sending',
              statusText: `Sending ${file.fileName}`
            })

            let attempts = 0
            while (attempts <= MAX_RETRIES) {
              yield* failIfCancelled()
              attempts++

              const loaded = yield* opfs.loadFile(file.id).pipe(
                Effect.catchAll((error) => {
                  const failure = toFailureResult(
                    file,
                    'validation',
                    `Failed to load ${file.fileName} from storage: ${(error as any)?.message || String(error)}`,
                    attempts
                  )
                  failed.push(failure)
                  failedCount++
                  completed++
                  options?.onFileFailure?.(failure)
                  emitProgress({
                    currentFile: file,
                    retryingFile: undefined,
                    retryAttempt: undefined,
                    status: 'timed-out',
                    statusText: failure.message
                  })
                  return Effect.succeed(undefined)
                })
              )

              if (!loaded) {
                return undefined
              }

              const toSend = { ...file, arrayBuffer: loaded }
              const result = yield* sender.sendFile(toSend, config, { signal: options?.signal, attemptNumber: attempts }).pipe(
                Effect.either
              )

              if (result._tag === 'Left' && result.left instanceof CancelledError) {
                return yield* Effect.fail(result.left)
              }

              if (result._tag === 'Right') {
                const successResult: SendSuccessResult = {
                  ...result.right,
                  attempts
                }
                succeeded.push(successResult)
                sentCount++
                completed++
                for (const warning of successResult.warnings) {
                  warnings.push(warning)
                  options?.onFileWarning?.(warning)
                }
                emitProgress({
                  currentFile: toSend,
                  retryingFile: undefined,
                  retryAttempt: undefined,
                  status: 'sending',
                  statusText: `Sent ${toSend.fileName}`
                })
                return successResult
              }

              const error = result.left
              if (error instanceof ValidationError) {
                const failure = toFailureResult(toSend, 'validation', error.message, attempts)
                failed.push(failure)
                failedCount++
                completed++
                options?.onFileFailure?.(failure)
                emitProgress({
                  currentFile: toSend,
                  retryingFile: undefined,
                  retryAttempt: undefined,
                  status: 'sending',
                  statusText: failure.message
                })
                return undefined
              }

              const cause = (error as NetworkError).cause
              const attemptError = cause instanceof SendAttemptError ? cause : undefined
              const failureKind = attemptError?.failureKind || ((error as NetworkError).status ? 'http' : 'network')
              const failure = toFailureResult(
                toSend,
                failureKind,
                error.message,
                attempts,
                (error as NetworkError).status,
                attemptError?.timeoutMs
              )

              if (attemptError?.retryable && attempts <= MAX_RETRIES) {
                const delayMs = getRetryDelayMs(attempts)
                options?.onFileRetry?.(failure, attempts + 1, delayMs)
                emitProgress({
                  currentFile: toSend,
                  retryingFile: toSend,
                  retryAttempt: attempts,
                  status: failureKind === 'timeout' ? 'timed-out' : 'waiting',
                  statusText: `Retry ${attempts}/${MAX_RETRIES} for ${toSend.fileName}`
                })
                yield* Effect.sleep(delayMs)
                continue
              }

	              if (shouldAttemptSplitFallback(toSend, failureKind)) {
	                const splitFallbackSuccess = yield* sendSplitFallback(toSend, attempts)
	                if (splitFallbackSuccess) {
	                  succeeded.push(splitFallbackSuccess)
	                  sentCount++
	                  completed++
	                  emitProgress({
	                    currentFile: toSend,
	                    retryingFile: undefined,
	                    retryAttempt: undefined,
	                    status: 'sending',
	                    statusText: `Sent ${toSend.fileName} as split derived frames`
	                  })
	                  return splitFallbackSuccess
	                }
	              }

	              failed.push(failure)
	              failedCount++
	              completed++
	              options?.onFileFailure?.(failure)
	              emitProgress({
	                currentFile: toSend,
	                retryingFile: undefined,
	                retryAttempt: undefined,
	                status: failureKind === 'timeout' ? 'timed-out' : 'sending',
	                statusText: failure.message
	              })
	              return undefined
            }

            return undefined
          })
        )

        yield* failIfCancelled()
        yield* Effect.all(sendEffects, { concurrency, batching: true })

        return {
          succeeded,
          failed,
          skipped,
          warnings,
          total: files.length,
          attempted: filesToSend.length,
          succeededCount: succeeded.length,
          failedCount: failed.length,
          skippedCount: skipped.length,
          warningCount: warnings.length
        }
      })
  }
)
