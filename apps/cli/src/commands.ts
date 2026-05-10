import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Effect } from 'effect'
import { loadNodePlugins } from '@dicorre/plugins/node'
import { Anonymizer } from '@dicorre/shared/services/anonymizer'
import { ConfigService } from '@dicorre/shared/services/config'
import type { AppConfig } from '@dicorre/shared/services/config/schema'
import { DicomProcessor } from '@dicorre/shared/services/dicomProcessor'
import { DicomSender } from '@dicorre/shared/services/dicomSender'
import { DownloadService } from '@dicorre/shared/services/downloadService'
import { FileStorage } from '@dicorre/shared/services/fileStorage'
import { PluginRegistry } from '@dicorre/shared/services/pluginRegistry'
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
): Effect.Effect<void, never, R> => {
  let originalLog: typeof console.log | undefined
  return Effect.sync(() => {
    originalLog = console.log
    console.log = (...args: unknown[]) => console.error(...args)
  }).pipe(
    Effect.zipRight(effect),
    Effect.ensuring(Effect.sync(() => {
      if (originalLog) console.log = originalLog
    })),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`Plugin ${pluginId} ${hookName} hook failed:`, error)
      }),
    ),
  )
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
    const config = yield* configService.getServerConfig
    const hooks = yield* registry.getHookPlugins()
    let succeeded = 0
    let failed = 0
    let skipped = 0
    const sentIds = new Set<string>()

    for (const study of selected) {
      for (const plugin of hooks) {
        if (plugin.hooks.beforeSend) {
          yield* runCliHook(plugin.id, 'beforeSend', plugin.hooks.beforeSend(study) as Effect.Effect<void, unknown, ConfigService>)
        }
      }

      const result = yield* sender.sendFiles(flattenStudyFiles([study]), config, options.concurrency ?? 3).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const err = error instanceof Error ? error : new Error(String(error))
            for (const plugin of hooks) {
              if (plugin.hooks.onSendError) {
                yield* runCliHook(plugin.id, 'onSendError', plugin.hooks.onSendError(study, err) as Effect.Effect<void, unknown, ConfigService>)
              }
            }
            return yield* Effect.fail(error)
          }),
        ),
      )
      succeeded += result.succeededCount
      failed += result.failedCount
      skipped += result.skippedCount
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
            yield* runCliHook(plugin.id, 'afterSend', plugin.hooks.afterSend(sentStudy) as Effect.Effect<void, unknown, ConfigService>)
          }
        }
      }
    }

    yield* Effect.promise(() => saveState(paths.state, markFilesSent(state, sentIds)))
    return { studies: selected.length, succeeded, failed, skipped }
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
        settings,
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
