import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Effect } from 'effect'
import { loadNodePlugins } from '@dicorre/plugins/node'
import { Anonymizer } from '@dicorre/shared/services/anonymizer'
import { ConfigService } from '@dicorre/shared/services/config'
import type { AppConfig, DicomServerConfig } from '@dicorre/shared/services/config/schema'
import { DicomProcessor } from '@dicorre/shared/services/dicomProcessor'
import {
  DicomSender,
  type SendFailureResult,
  type SendSkippedResult,
  type SendWarningResult,
} from '@dicorre/shared/services/dicomSender'
import { DownloadService } from '@dicorre/shared/services/downloadService'
import { FileStorage } from '@dicorre/shared/services/fileStorage'
import { PluginRegistry } from '@dicorre/shared/services/pluginRegistry'
import { ReceiptVerificationService, type ReceiptVerificationRecord, type ReceiptVerificationSettings } from '@dicorre/shared/services/receiptVerification'
import type { DicomFile, DicomStudy } from '@dicorre/shared/types/dicom'
import type { HookPlugin } from '@dicorre/shared/types/plugins'
import { isFileFormatPlugin, isHookPlugin } from '@dicorre/shared/types/plugins'
import { makeCliLayer } from './layers'
import { processInputPaths } from './fileProcessing'
import {
  createState,
  flattenStudyFiles,
  loadState,
  markFilesSent,
  mergeUpdatedFiles,
  saveState,
  selectStudies,
} from './state'

export interface CliPaths {
  readonly workspace: string
  readonly state: string
}

export interface IngestSummary {
  readonly filesRead: number
  readonly filesParsed: number
  readonly studies: number
  readonly statePath: string
}

export interface AnonymizeSummary {
  readonly studies: number
  readonly files: number
  readonly statePath: string
}

export interface DownloadSummary {
  readonly studies: number
  readonly files: string[]
}

export interface SendSummary {
  readonly studies: number
  readonly succeeded: number
  readonly failed: number
  readonly skipped: number
  readonly failedFiles: CliSendFailure[]
  readonly skippedFiles: CliSendSkipped[]
  readonly warnings: CliSendWarning[]
  readonly plugins: PluginHookResult[]
  readonly verification?: ReceiptVerificationRecord[]
}

export interface VerifySummary {
  readonly studies: number
  readonly verification: ReceiptVerificationRecord[]
}

export interface ServerProbeSummary {
  readonly url: string
  readonly method: 'GET'
  readonly ok: boolean
  readonly reachable: boolean
  readonly durationMs: number
  readonly failureKind?: 'http' | 'timeout' | 'tls' | 'network'
  readonly status?: number
  readonly statusText?: string
  readonly message?: string
  readonly code?: string
}

export interface ConfigSummary {
  readonly config: AppConfig
}

export interface ProjectSummary {
  readonly project?: {
    readonly id: string
    readonly name: string
    readonly createdAt: string
  }
}

export interface CliPluginContext {
  readonly summary: string
  readonly docs?: string
  readonly examples?: string[]
  readonly notes?: string[]
}

export interface PluginSummary {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly type: 'file-format' | 'hook'
  readonly enabled: boolean
  readonly description: string
  readonly supportedExtensions?: string[]
  readonly supportedMimeTypes?: string[]
  readonly hooks?: string[]
  readonly settings?: Record<string, unknown>
  readonly cli?: CliPluginContext
}

export interface PluginsSummary {
  readonly plugins: PluginSummary[]
  readonly supportedExtensions: string[]
  readonly supportedMimeTypes: string[]
}

export interface CliSendFailure {
  readonly id: string
  readonly fileName: string
  readonly studyInstanceUID?: string
  readonly accessionNumber?: string
  readonly patientId?: string
  readonly sopInstanceUID?: string
  readonly modality?: string
  readonly fileSize: number
  readonly attempts: number
  readonly failureKind: string
  readonly httpStatus?: number
  readonly timeoutMs?: number
  readonly message: string
}

export interface CliSendSkipped {
  readonly id: string
  readonly fileName: string
  readonly studyInstanceUID?: string
  readonly accessionNumber?: string
  readonly patientId?: string
  readonly reason: string
}

export interface CliSendWarning {
  readonly id: string
  readonly fileName: string
  readonly studyInstanceUID?: string
  readonly accessionNumber?: string
  readonly patientId?: string
  readonly sopInstanceUID?: string
  readonly message: string
  readonly httpStatus?: number
}

export interface PluginHookResult {
  readonly pluginId: string
  readonly hook: 'beforeSend' | 'afterSend' | 'onSendError'
  readonly studyInstanceUID?: string
  readonly accessionNumber?: string
  readonly status: 'success' | 'failed'
  readonly message?: string
}

const resolveCliPaths = (workspaceArg?: string, stateArg?: string): CliPaths => {
  const workspace = path.resolve(workspaceArg ?? '.dicorre')
  return {
    workspace,
    state: path.resolve(stateArg ?? path.join(workspace, 'state.json')),
  }
}

const loadConfigIfProvided = (configPath?: string) =>
  Effect.gen(function* () {
    if (!configPath) return
    const configService = yield* ConfigService
    const raw = yield* Effect.tryPromise({
      try: () => readFile(path.resolve(configPath), 'utf8'),
      catch: (error) => error,
    })
    yield* configService.loadConfig(JSON.parse(raw))
  })

const loadCliPlugins = () =>
  Effect.gen(function* () {
    const configService = yield* ConfigService
    const config = yield* configService.getCurrentConfig
    const pluginConfig = config.plugins
      ? { enabled: [...config.plugins.enabled], settings: config.plugins.settings }
      : { enabled: [] }
    return yield* loadNodePlugins(pluginConfig)
  })

const activeHookNames = (plugin: HookPlugin): string[] =>
  (['beforeProcess', 'afterProcess', 'beforeAnonymize', 'afterAnonymize', 'beforeSend', 'afterSend', 'onSendError'] as const)
    .filter((name) => !!plugin.hooks[name])

const runCliHook = <R>(
  pluginId: string,
  hookName: string,
  effect: Effect.Effect<void, unknown, R>,
): Effect.Effect<PluginHookResult, never, R> => {
  let originalLog: typeof console.log | undefined
  return Effect.sync(() => {
    originalLog = console.log
    console.log = (...args: unknown[]) => console.error(...args)
  }).pipe(
    Effect.zipRight(effect),
    Effect.as({
      pluginId,
      hook: hookName as PluginHookResult['hook'],
      status: 'success' as const,
    }),
    Effect.ensuring(Effect.sync(() => {
      if (originalLog) console.log = originalLog
    })),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`Plugin ${pluginId} ${hookName} hook failed: ${errorMessage(error)}`)
        return {
          pluginId,
          hook: hookName as PluginHookResult['hook'],
          status: 'failed' as const,
          message: errorMessage(error),
        }
      }),
    ),
  )
}

const errorCode = (error: unknown): string | undefined => {
  if (error && typeof error === 'object') {
    const direct = (error as { code?: unknown }).code
    if (typeof direct === 'string') return direct
    const cause = (error as { cause?: unknown }).cause
    if (cause && typeof cause === 'object') {
      const nested = (cause as { code?: unknown }).code
      if (typeof nested === 'string') return nested
    }
  }
  return undefined
}

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  const cause = error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined
  const causeMessage = cause
    ? cause instanceof Error
      ? cause.message
      : String(cause)
    : undefined
  return [message, causeMessage].filter(Boolean).join(': ')
    .replace(/https?:\/\/[^\s"'}]+/g, '[redacted-url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+\S+/gi, 'Basic [redacted]')
}

const classifyFetchError = (error: unknown): 'timeout' | 'tls' | 'network' => {
  const code = errorCode(error)
  const message = errorMessage(error)
  if (error instanceof Error && error.name === 'AbortError') return 'timeout'
  if (code?.includes('CERT') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || /certificate|tls|ssl/i.test(message)) {
    return 'tls'
  }
  return 'network'
}

const fileContext = (study: DicomStudy, fileId: string) => ({
  id: fileId,
  studyInstanceUID: study.studyInstanceUID,
  accessionNumber: study.accessionNumber,
  patientId: study.assignedPatientId || study.patientId,
})

const toCliFailure = (study: DicomStudy, failure: SendFailureResult): CliSendFailure => ({
  ...fileContext(study, failure.id),
  fileName: failure.fileName,
  sopInstanceUID: failure.sopInstanceUID,
  modality: failure.modality,
  fileSize: failure.fileSize,
  attempts: failure.attempts,
  failureKind: failure.failureKind,
  httpStatus: failure.httpStatus,
  timeoutMs: failure.timeoutMs,
  message: errorMessage(failure.message),
})

const toCliSkipped = (study: DicomStudy, skipped: SendSkippedResult): CliSendSkipped => ({
  ...fileContext(study, skipped.file.id),
  fileName: skipped.fileName,
  reason: skipped.reason,
})

const toCliWarning = (study: DicomStudy, warning: SendWarningResult): CliSendWarning => ({
  ...fileContext(study, warning.file.id),
  fileName: warning.fileName,
  sopInstanceUID: warning.sopInstanceUID,
  message: errorMessage(warning.message),
  httpStatus: warning.httpStatus,
})

const withStudy = (study: DicomStudy, result: PluginHookResult): PluginHookResult => ({
  ...result,
  studyInstanceUID: study.studyInstanceUID,
  accessionNumber: study.accessionNumber,
})

const buildReceiptVerifierSettings = (appConfig: any): ReceiptVerificationSettings | undefined => {
  const pluginSettings = appConfig.plugins?.settings?.['receipt-verifier'] || {}
  const provider = pluginSettings.provider || 'dicomweb-qido'
  const url = pluginSettings.url || (provider === 'dicomweb-qido' || provider === 'orthanc-dicomweb'
    ? appConfig.dicomServer?.url
    : undefined)
  if (!url) return undefined
  return {
    provider,
    url,
    archive: Number.isFinite(Number(pluginSettings.archive)) ? Number(pluginSettings.archive) : undefined,
    headers: pluginSettings.headers || appConfig.dicomServer?.headers || {},
    auth: pluginSettings.auth ?? appConfig.dicomServer?.auth ?? null,
    pollIntervalMs: Number.isFinite(Number(pluginSettings.pollIntervalMs)) ? Number(pluginSettings.pollIntervalMs) : undefined,
    timeoutMs: Number.isFinite(Number(pluginSettings.timeoutMs)) ? Number(pluginSettings.timeoutMs) : undefined,
    requireInstanceCountMatch: pluginSettings.requireInstanceCountMatch === true,
  }
}

const redactUrl = (value: string): string => {
  try {
    const url = new URL(value)
    if (url.username) url.username = '<redacted>'
    if (url.password) url.password = '<redacted>'
    return url.toString()
  } catch {
    return value
  }
}

const buildDicomServerHeaders = (serverConfig: DicomServerConfig): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/dicom+json',
    ...serverConfig.headers,
  }

  if (serverConfig.auth?.type === 'basic') headers.Authorization = `Basic ${serverConfig.auth.credentials}`
  if (serverConfig.auth?.type === 'bearer') headers.Authorization = `Bearer ${serverConfig.auth.credentials}`

  return headers
}

const serverProbeUrl = (serverConfig: DicomServerConfig): string => {
  const path = serverConfig.testConnectionPath || '/studies'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${serverConfig.url}${normalizedPath}`
}

const withNextCommand = (
  record: ReceiptVerificationRecord,
  workspace: string,
  config?: string,
): ReceiptVerificationRecord => {
  if (record.state === 'verified') return { ...record, nextCommand: undefined }
  const configPart = config ? ` --config ${config}` : ''
  return {
    ...record,
    nextCommand: `dicorre verify --study ${record.studyInstanceUID} --workspace ${workspace}${configPart}`,
  }
}

const parseDurationMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/)
  if (!match) return Number(value)
  const amount = Number(match[1])
  const unit = match[2] || 'ms'
  if (unit === 'm') return amount * 60_000
  if (unit === 's') return amount * 1000
  return amount
}

const redactPluginSettings = (
  pluginId: string,
  settings: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!settings || pluginId !== 'receipt-verifier') return settings
  const headers = settings.headers && typeof settings.headers === 'object'
    ? Object.fromEntries(Object.keys(settings.headers as Record<string, unknown>).map((name) => [name, '<redacted>']))
    : settings.headers
  const auth = settings.auth && typeof settings.auth === 'object'
    ? { type: (settings.auth as { type?: unknown }).type, credentials: '<redacted>' }
    : settings.auth
  return { ...settings, headers, auth }
}

export const ingest = async (
  inputPaths: string[],
  options: {
    readonly workspace?: string
    readonly state?: string
    readonly config?: string
    readonly converted?: boolean
    readonly parseConcurrency?: number
  } = {},
): Promise<IngestSummary> => {
  const paths = resolveCliPaths(options.workspace, options.state)
  const effect = Effect.gen(function* () {
    yield* loadConfigIfProvided(options.config)
    yield* loadCliPlugins()

    const processor = yield* DicomProcessor
    const configService = yield* ConfigService
    const storage = yield* FileStorage
    const rawFiles = yield* processInputPaths(inputPaths, { includeConverted: options.converted ?? true })
    const parsed = yield* processor.parseFiles(rawFiles, options.parseConcurrency ?? 3)
    const withStorageIds = parsed.map((file) => ({ ...file, opfsFileId: file.id }))

    for (const file of withStorageIds) {
      yield* storage.saveFile(file.id, file.arrayBuffer)
    }

    const grouped = yield* processor.groupFilesByStudy(withStorageIds)
    const cfg = yield* configService.getAnonymizationConfig
    const studies = yield* processor.assignPatientIds(grouped, cfg)
    const state = createState(withStorageIds, studies)
    yield* Effect.promise(() => saveState(paths.state, state))

    return {
      filesRead: rawFiles.length,
      filesParsed: withStorageIds.length,
      studies: studies.length,
      statePath: paths.state,
    }
  })

  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

const loadSelectedStudies = async (paths: CliPaths, studyIds: string[]) => {
  const state = await loadState(paths.state)
  const selected = selectStudies(state.studies, studyIds)
  return { state, selected }
}

const hydrateFiles = (files: DicomFile[]) =>
  Effect.gen(function* () {
    const storage = yield* FileStorage
    const hydrated: DicomFile[] = []
    for (const file of files) {
      const arrayBuffer = yield* storage.loadFile(file.id)
      hydrated.push({ ...file, arrayBuffer })
    }
    return hydrated
  })

export const anonymize = async (
  studyIds: string[],
  options: {
    readonly workspace?: string
    readonly state?: string
    readonly config?: string
    readonly concurrency?: number
  } = {},
): Promise<AnonymizeSummary> => {
  const paths = resolveCliPaths(options.workspace, options.state)
  const { state, selected } = await loadSelectedStudies(paths, studyIds)
  const effect = Effect.gen(function* () {
    yield* loadConfigIfProvided(options.config)

    const anonymizer = yield* Anonymizer
    const configService = yield* ConfigService
    const processor = yield* DicomProcessor
    const storage = yield* FileStorage
    const config = yield* configService.getAnonymizationConfig
    const updatedFiles: DicomFile[] = []

    for (const study of selected) {
      const files = yield* hydrateFiles(flattenStudyFiles([study]))
      const patientIdMap = study.patientId && study.assignedPatientId
        ? { [study.patientId]: study.assignedPatientId }
        : undefined
      const result = yield* anonymizer.anonymizeStudy(study.studyInstanceUID, files, config, {
        concurrency: options.concurrency ?? 3,
        patientIdMap,
        overrides: study.customFields,
      })
      for (const file of result.anonymizedFiles) {
        yield* storage.saveFile(file.id, file.arrayBuffer)
        updatedFiles.push({ ...file, opfsFileId: file.id })
      }
    }

    const next = mergeUpdatedFiles(state, updatedFiles)
    const allFilesForGrouping = next.files.map((file) => ({
      ...file,
      arrayBuffer: new ArrayBuffer(0),
    }))
    const regrouped = yield* processor.groupFilesByStudy(allFilesForGrouping)
    const saved = { ...next, studies: regrouped }
    yield* Effect.promise(() => saveState(paths.state, saved))

    return {
      studies: selected.length,
      files: updatedFiles.length,
      statePath: paths.state,
    }
  })

  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const download = async (
  studyIds: string[],
  options: {
    readonly workspace?: string
    readonly state?: string
    readonly out?: string
  } = {},
): Promise<DownloadSummary> => {
  const paths = resolveCliPaths(options.workspace, options.state)
  const { state, selected } = await loadSelectedStudies(paths, studyIds)
  const outBase = path.resolve(options.out ?? path.join(paths.workspace, 'download.zip'))
  const effect = Effect.gen(function* () {
    const downloadService = yield* DownloadService
    const blobs = yield* downloadService.packageStudiesForDownload(
      state.studies,
      selected.map((study) => study.studyInstanceUID),
    )
    const files: string[] = []
    for (let i = 0; i < blobs.length; i++) {
      const outputPath = blobs.length === 1
        ? outBase
        : outBase.replace(/\.zip$/u, `-${String(i + 1).padStart(3, '0')}.zip`)
      yield* Effect.promise(async () => {
        const bytes = Buffer.from(await blobs[i].arrayBuffer())
        await writeFile(outputPath, bytes)
      })
      files.push(outputPath)
    }
    return { studies: selected.length, files }
  })

  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const send = async (
  studyIds: string[],
  options: {
    readonly workspace?: string
    readonly state?: string
    readonly config?: string
    readonly concurrency?: number
  } = {},
): Promise<SendSummary> => {
  const paths = resolveCliPaths(options.workspace, options.state)
  const { state, selected } = await loadSelectedStudies(paths, studyIds)
  const effect = Effect.gen(function* () {
    yield* loadConfigIfProvided(options.config)
    yield* loadCliPlugins()

    const sender = yield* DicomSender
    const configService = yield* ConfigService
    const registry = yield* PluginRegistry
    const receiptVerification = yield* ReceiptVerificationService
    const config = yield* configService.getServerConfig
    const hooks = yield* registry.getHookPlugins()
    let succeeded = 0
    let failed = 0
    let skipped = 0
    const failedFiles: CliSendFailure[] = []
    const skippedFiles: CliSendSkipped[] = []
    const warnings: CliSendWarning[] = []
    const plugins: PluginHookResult[] = []
    const sentIds = new Set<string>()

    for (const study of selected) {
      for (const plugin of hooks) {
        if (plugin.hooks.beforeSend) {
          const hookResult = yield* runCliHook(plugin.id, 'beforeSend', plugin.hooks.beforeSend(study) as Effect.Effect<void, unknown, ConfigService>)
          plugins.push(withStudy(study, hookResult))
        }
      }

      const result = yield* sender.sendFiles(flattenStudyFiles([study]), config, options.concurrency ?? 3).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const err = error instanceof Error ? error : new Error(String(error))
            for (const plugin of hooks) {
              if (plugin.hooks.onSendError) {
                const hookResult = yield* runCliHook(plugin.id, 'onSendError', plugin.hooks.onSendError(study, err) as Effect.Effect<void, unknown, ConfigService>)
                plugins.push(withStudy(study, hookResult))
              }
            }
            return yield* Effect.fail(error)
          }),
        ),
      )
      succeeded += result.succeededCount
      failed += result.failedCount
      skipped += result.skippedCount
      failedFiles.push(...result.failed.map((failure) => toCliFailure(study, failure)))
      skippedFiles.push(...result.skipped.map((skip) => toCliSkipped(study, skip)))
      warnings.push(...result.warnings.map((warning) => toCliWarning(study, warning)))
      for (const success of result.succeeded) sentIds.add(success.file.id)

      if (result.failedCount === 0) {
        const sentStudy: DicomStudy = {
          ...study,
          series: study.series.map((series) => ({
            ...series,
            files: series.files.filter((file) => sentIds.has(file.id)),
          })),
        }
        for (const plugin of hooks) {
          if (plugin.hooks.afterSend) {
            const hookResult = yield* runCliHook(plugin.id, 'afterSend', plugin.hooks.afterSend(sentStudy) as Effect.Effect<void, unknown, ConfigService>)
            plugins.push(withStudy(study, hookResult))
          }
        }
      }
    }

    yield* Effect.promise(() => saveState(paths.state, markFilesSent(state, sentIds)))
    const verificationRecords = yield* receiptVerification.getAll
    const verification = selected
      .map((study) => verificationRecords.get(study.studyInstanceUID))
      .filter((record): record is ReceiptVerificationRecord => !!record)
      .map((record) => withNextCommand(record, paths.workspace, options.config))
    return { studies: selected.length, succeeded, failed, skipped, failedFiles, skippedFiles, warnings, plugins, verification }
  })

  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const serverProbe = async (
  options: {
    readonly workspace?: string
    readonly config?: string
  } = {},
): Promise<ServerProbeSummary> => {
  const paths = resolveCliPaths(options.workspace)
  const effect = Effect.gen(function* () {
    yield* loadConfigIfProvided(options.config)
    const configService = yield* ConfigService
    const serverConfig = yield* configService.getServerConfig
    const url = serverProbeUrl(serverConfig)

    return yield* Effect.promise(async () => {
      const started = Date.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), serverConfig.timeout ?? 30_000)
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: buildDicomServerHeaders(serverConfig),
          signal: controller.signal,
        })
        await response.text().catch(() => '')
        const durationMs = Date.now() - started
        return {
          url: redactUrl(url),
          method: 'GET' as const,
          ok: response.ok,
          reachable: true,
          durationMs,
          failureKind: response.ok ? undefined : 'http' as const,
          status: response.status,
          statusText: response.statusText,
        }
      } catch (error) {
        const kind = classifyFetchError(error)
        return {
          url: redactUrl(url),
          method: 'GET' as const,
          ok: false,
          reachable: false,
          durationMs: Date.now() - started,
          failureKind: kind,
          message: errorMessage(error),
          code: errorCode(error),
        }
      } finally {
        clearTimeout(timeout)
      }
    })
  })

  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const verify = async (
  studyIds: string[],
  options: {
    readonly workspace?: string
    readonly state?: string
    readonly config?: string
    readonly wait?: boolean
    readonly timeout?: string
  } = {},
): Promise<VerifySummary> => {
  const paths = resolveCliPaths(options.workspace, options.state)
  const { selected } = await loadSelectedStudies(paths, studyIds)
  const effect = Effect.gen(function* () {
    yield* loadConfigIfProvided(options.config)
    const configService = yield* ConfigService
    const receiptVerification = yield* ReceiptVerificationService
    const appConfig = yield* configService.getCurrentConfig
    const settings = buildReceiptVerifierSettings(appConfig)
    if (!settings) throw new Error('receipt-verifier settings require a provider URL')

    const verification: ReceiptVerificationRecord[] = []
    for (const study of selected) {
      const record = yield* receiptVerification.verifyStudy(study, settings, {
        wait: options.wait === true,
        timeoutMs: parseDurationMs(options.timeout),
        nextCommand: `dicorre verify --study ${study.studyInstanceUID} --workspace ${paths.workspace}${options.config ? ` --config ${options.config}` : ''}`,
      })
      verification.push(withNextCommand(record, paths.workspace, options.config))
    }
    return { studies: selected.length, verification }
  })

  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const listPlugins = async (
  options: { readonly workspace?: string; readonly config?: string } = {},
): Promise<PluginsSummary> => {
  const paths = resolveCliPaths(options.workspace)
  const effect = Effect.gen(function* () {
    yield* loadConfigIfProvided(options.config)
    yield* loadCliPlugins()
    const registry = yield* PluginRegistry
    const plugins = yield* registry.getAllPlugins()
    const supportedExtensions = yield* registry.getSupportedExtensions()
    const supportedMimeTypes = yield* registry.getSupportedMimeTypes()
    const summaries: PluginSummary[] = []

    for (const plugin of plugins) {
      const settings = yield* registry.getPluginSettings(plugin.id)
      summaries.push({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        type: plugin.type,
        enabled: plugin.enabled === true,
        description: plugin.description,
        supportedExtensions: isFileFormatPlugin(plugin) ? [...plugin.supportedExtensions] : undefined,
        supportedMimeTypes: isFileFormatPlugin(plugin) ? [...(plugin.supportedMimeTypes ?? [])] : undefined,
        hooks: isHookPlugin(plugin) ? activeHookNames(plugin) : undefined,
        settings: redactPluginSettings(plugin.id, settings),
        cli: (plugin as typeof plugin & { cli?: CliPluginContext }).cli,
      })
    }

    return { plugins: summaries, supportedExtensions, supportedMimeTypes }
  })
  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const validateConfig = async (
  configPath: string,
  options: { readonly workspace?: string } = {},
): Promise<{ valid: true }> => {
  const paths = resolveCliPaths(options.workspace)
  const effect = Effect.gen(function* () {
    const configService = yield* ConfigService
    const raw = yield* Effect.promise(() => readFile(path.resolve(configPath), 'utf8'))
    yield* configService.validateConfig(JSON.parse(raw))
    return { valid: true as const }
  })
  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const showConfig = async (
  options: { readonly workspace?: string } = {},
): Promise<ConfigSummary> => {
  const paths = resolveCliPaths(options.workspace)
  const effect = Effect.gen(function* () {
    const configService = yield* ConfigService
    const config = yield* configService.getCurrentConfig
    return { config }
  })
  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const loadConfig = async (
  configPath: string,
  options: { readonly workspace?: string } = {},
): Promise<ConfigSummary> => {
  const paths = resolveCliPaths(options.workspace)
  const effect = Effect.gen(function* () {
    yield* loadConfigIfProvided(configPath)
    const configService = yield* ConfigService
    const config = yield* configService.getCurrentConfig
    return { config }
  })
  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const createProject = async (
  name: string,
  options: { readonly workspace?: string } = {},
): Promise<ProjectSummary> => {
  const paths = resolveCliPaths(options.workspace)
  const effect = Effect.gen(function* () {
    const configService = yield* ConfigService
    const project = yield* configService.createProject(name)
    yield* configService.updateProject(project)
    return { project }
  })
  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const clearProject = async (
  options: { readonly workspace?: string } = {},
): Promise<ProjectSummary> => {
  const paths = resolveCliPaths(options.workspace)
  const effect = Effect.gen(function* () {
    const configService = yield* ConfigService
    yield* configService.clearProject
    return { project: undefined }
  })
  return Effect.runPromise(effect.pipe(Effect.provide(makeCliLayer(paths.workspace))))
}

export const setCustomField = async (
  studyId: string,
  field: string,
  value: string,
  options: { readonly workspace?: string; readonly state?: string } = {},
): Promise<{ studyId: string; field: string; value: string; statePath: string }> => {
  const paths = resolveCliPaths(options.workspace, options.state)
  const state = await loadState(paths.state)
  let matched = false
  const studies = state.studies.map((study) => {
    if (study.id !== studyId && study.studyInstanceUID !== studyId) return study
    matched = true
    return {
      ...study,
      customFields: {
        ...(study.customFields ?? {}),
        [field]: value,
      },
    }
  })
  if (!matched) throw new Error(`Study not found: ${studyId}`)
  await saveState(paths.state, { ...state, studies })
  return { studyId, field, value, statePath: paths.state }
}

export const clearCustomField = async (
  studyId: string,
  field: string,
  options: { readonly workspace?: string; readonly state?: string } = {},
): Promise<{ studyId: string; field: string; statePath: string }> => {
  const paths = resolveCliPaths(options.workspace, options.state)
  const state = await loadState(paths.state)
  let matched = false
  const studies = state.studies.map((study) => {
    if (study.id !== studyId && study.studyInstanceUID !== studyId) return study
    matched = true
    const customFields = { ...(study.customFields ?? {}) }
    delete customFields[field]
    return { ...study, customFields }
  })
  if (!matched) throw new Error(`Study not found: ${studyId}`)
  await saveState(paths.state, { ...state, studies })
  return { studyId, field, statePath: paths.state }
}

export const mergeStudies = async (
  studyIds: string[],
  options: { readonly workspace?: string; readonly state?: string } = {},
): Promise<{ studyId: string; merged: number; statePath: string }> => {
  if (studyIds.length < 2) throw new Error('study-merge requires at least two study ids')

  const paths = resolveCliPaths(options.workspace, options.state)
  const state = await loadState(paths.state)
  const selected = selectStudies(state.studies, studyIds)
  if (selected.length < 2) throw new Error('study-merge matched fewer than two studies')

  const target = selected[0]
  const selectedKeys = new Set(selected.flatMap((study) => [study.id, study.studyInstanceUID]))
  const mergedStudy = {
    ...target,
    customFields: {
      ...(target.customFields ?? {}),
      'Study Instance UID': target.studyInstanceUID,
    },
    series: selected.flatMap((study) => study.series),
  }

  const studies = [
    mergedStudy,
    ...state.studies.filter((study) => !selectedKeys.has(study.id) && !selectedKeys.has(study.studyInstanceUID)),
  ]
  await saveState(paths.state, { ...state, studies })
  return { studyId: target.studyInstanceUID, merged: selected.length, statePath: paths.state }
}

export const listStudies = async (
  options: { readonly workspace?: string; readonly state?: string } = {},
) => {
  const paths = resolveCliPaths(options.workspace, options.state)
  const state = await loadState(paths.state)
  return state.studies.map((study) => ({
    id: study.id,
    studyInstanceUID: study.studyInstanceUID,
    patientId: study.patientId,
    assignedPatientId: study.assignedPatientId,
    files: flattenStudyFiles([study]).length,
  }))
}
