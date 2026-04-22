import { ref, shallowRef, computed } from 'vue'
import { Effect, Fiber } from 'effect'
import type { DicomFile } from '@/types/dicom'
import { ConfigService } from '@/services/config'
import type { RuntimeType } from '@/types/effects'
import {
  DicomSender,
  type SendFailureResult,
  type SendProgressUpdate,
  type SendStudyResult,
  type SendWarningResult
} from '@/services/dicomSender'
import type { OPFSStorage } from '@/services/opfsStorage'

export interface SendingProgress {
  total: number
  completed: number
  percentage: number
  sentCount: number
  failedCount: number
  currentFile?: string
  retryingFile?: string
  retryAttempt?: number
  status?: SendProgressUpdate['status']
  statusText?: string
}

export function useDicomSender(runtime?: RuntimeType) {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<SendingProgress | null>(null)

  const fibers = shallowRef<Map<string, Fiber.RuntimeFiber<SendStudyResult, Error>>>(new Map())
  const progresses = shallowRef<Map<string, SendingProgress>>(new Map())
  const abortControllers = shallowRef<Map<string, AbortController>>(new Map())

  const setProgress = (studyId: string, patch: Partial<SendingProgress>) => {
    const prev = progresses.value.get(studyId) ?? {
      total: 0,
      completed: 0,
      percentage: 0,
      sentCount: 0,
      failedCount: 0
    }
    const next = { ...prev, ...patch }
    progresses.value.set(studyId, next)
    progresses.value = new Map(progresses.value)
  }

  const clearProgress = (studyId: string) => {
    progresses.value.delete(studyId)
    progresses.value = new Map(progresses.value)
  }

  const sendStudyEffect = (
    studyId: string,
    files: DicomFile[],
    concurrency: number,
    options?: {
      onProgress?: (progress: SendProgressUpdate) => void
      onSkip?: (file: DicomFile, reason: string) => void
      onFileRetry?: (failure: SendFailureResult, nextAttempt: number, delayMs: number) => void
      onFileFailure?: (failure: SendFailureResult) => void
      onFileWarning?: (warning: SendWarningResult) => void
    }
  ): Effect.Effect<SendStudyResult, Error, ConfigService | DicomSender | OPFSStorage> =>
    Effect.gen(function* () {
      if (!runtime) {
        return yield* Effect.fail(new Error('Runtime not provided to useDicomSender'))
      }
      // Guard against concurrent sends of the same study (works for both sendStudy and sendStudyEffect paths)
      if (progresses.value.has(studyId) || fibers.value.has(studyId)) {
        return yield* Effect.fail(new Error(`Study ${studyId} send already in progress`))
      }
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

      loading.value = true
      error.value = null
      const abortController = new AbortController()
      abortControllers.value.set(studyId, abortController)
      abortControllers.value = new Map(abortControllers.value)
      setProgress(studyId, {
        total: files.length,
        completed: 0,
        percentage: 0,
        sentCount: 0,
        failedCount: 0,
        currentFile: undefined,
        retryingFile: undefined,
        retryAttempt: undefined,
        status: 'sending',
        statusText: undefined
      })

      const configService = yield* ConfigService
      const sender = yield* DicomSender
      const serverConfig = yield* configService.getServerConfig

      const sent = yield* sender.sendFiles(files, serverConfig, concurrency, {
        signal: abortController.signal,
        onProgress: (sendProgress) => {
          setProgress(studyId, {
            total: sendProgress.total,
            completed: sendProgress.completed,
            percentage: sendProgress.percentage,
            sentCount: sendProgress.sentCount,
            failedCount: sendProgress.failedCount,
            currentFile: sendProgress.currentFile?.fileName,
            retryingFile: sendProgress.retryingFile?.fileName,
            retryAttempt: sendProgress.retryAttempt,
            status: sendProgress.status,
            statusText: sendProgress.statusText
          })
          options?.onProgress?.(sendProgress)
        },
        onSkip: (file, reason) => {
          // Keep simple local progress state untouched; higher-level logging handled in useAppState
          console.warn(`Skipping file for study ${studyId}: ${file.fileName} (${reason})`)
          options?.onSkip?.(file, reason)
        },
        onFileRetry: options?.onFileRetry,
        onFileFailure: options?.onFileFailure,
        onFileWarning: options?.onFileWarning
      })

      loading.value = false
      clearProgress(studyId)
      abortControllers.value.delete(studyId)
      abortControllers.value = new Map(abortControllers.value)
      return sent
    }).pipe(
      Effect.tapError((e) =>
        Effect.sync(() => {
          loading.value = false
          error.value = e instanceof Error ? e : new Error(String(e))
          clearProgress(studyId)
          abortControllers.value.delete(studyId)
          abortControllers.value = new Map(abortControllers.value)
        })
      ),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          loading.value = false
          error.value = new Error('Sending was cancelled')
          abortControllers.value.get(studyId)?.abort()
          abortControllers.value.delete(studyId)
          abortControllers.value = new Map(abortControllers.value)
          clearProgress(studyId)
        })
      )
    )

  const sendStudy = (
    studyId: string,
    files: DicomFile[],
    concurrency: number,
    options?: {
      onProgress?: (progress: SendProgressUpdate) => void
      onSkip?: (file: DicomFile, reason: string) => void
      onFileRetry?: (failure: SendFailureResult, nextAttempt: number, delayMs: number) => void
      onFileFailure?: (failure: SendFailureResult) => void
      onFileWarning?: (warning: SendWarningResult) => void
    }
  ): Promise<SendStudyResult> => {
    if (!runtime) throw new Error('Runtime not provided to useDicomSender')
    const effect = sendStudyEffect(studyId, files, concurrency, options)
    const fiber = runtime.runFork(effect)
    fibers.value.set(studyId, fiber)
    fibers.value = new Map(fibers.value)
    return runtime
      .runPromise(
        Fiber.join(fiber).pipe(
          Effect.catchAll(() => Effect.succeed<SendStudyResult>({
            succeeded: [],
            failed: [],
            skipped: [],
            warnings: [],
            total: files.length,
            attempted: files.length,
            succeededCount: 0,
            failedCount: files.length,
            skippedCount: 0,
            warningCount: 0
          }))
        )
      )
      .finally(() => {
        fibers.value.delete(studyId)
        fibers.value = new Map(fibers.value)
      })
  }

  const cancelStudy = (studyId: string) => {
    abortControllers.value.get(studyId)?.abort()
    const fiber = fibers.value.get(studyId)
    if (!fiber) return
    Effect.runSync(Fiber.interrupt(fiber))
  }

  const cancelAll = () => {
    for (const [, controller] of abortControllers.value.entries()) {
      controller.abort()
    }
    for (const [, fiber] of fibers.value.entries()) {
      Effect.runSync(Fiber.interrupt(fiber))
    }
  }

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
    progresses.value = new Map()
    abortControllers.value = new Map()
  }

  const testConnection = (): Effect.Effect<void, Error, ConfigService | DicomSender> =>
    Effect.gen(function* () {
      if (!runtime) {
        return yield* Effect.fail(new Error('Runtime not provided to useDicomSender'))
      }
      const configService = yield* ConfigService
      const sender = yield* DicomSender
      const serverConfig = yield* configService.getServerConfig
      const ok = yield* sender.testConnection(serverConfig)
      if (!ok) {
        return yield* Effect.fail(new Error(`DICOM server test failed: ${serverConfig.url}${serverConfig.testConnectionPath}`))
      }
      return undefined
    })

  const progressPercentage = computed(() => progress.value?.percentage || 0)
  const getStudyProgress = (studyId: string) => computed(() => progresses.value.get(studyId))
  const isStudySending = (studyId: string): boolean =>
    Boolean(progresses.value.get(studyId) || fibers.value.get(studyId) || abortControllers.value.get(studyId))
  const hasActiveSending = computed(() => fibers.value.size > 0 || abortControllers.value.size > 0)

  return {
    // UI state
    loading,
    error,
    progress,
    progressPercentage,

    // Progress accessors
    getStudyProgress,
    isStudySending,
    hasActiveSending,

    // Operations
    sendStudyEffect,
    sendStudy,
    cancelStudy,
    cancelAll,
    testConnection,
    reset
  }
}
