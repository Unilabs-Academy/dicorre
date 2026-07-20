import { Effect, Context, Layer, SubscriptionRef, Stream } from "effect"
import type { AppConfig, DicomServerConfig, AnonymizationConfig, DicomProfileOption, ProjectConfig } from './schema'
import { ConfigurationError, type ConfigurationError as ConfigurationErrorType } from '@dicorre/shared/types/effects'
import defaultConfig from '../../../app.config.json'
import { validateAppConfig, CURRENT_CONFIG_VERSION, type AppConfig as AppConfigType } from './schema'
import { tagNameToHex, isValidTagName } from '@dicorre/shared/utils/dicom-tag-dictionary'
import { ConfigPersistence } from './configPersistence'
import { migrateConfig } from './migrations'

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  {
    readonly getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType>
    readonly getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType>
    readonly validateConfig: (config: unknown) => Effect.Effect<AppConfig, ConfigurationErrorType>
    readonly loadConfig: (configData: unknown) => Effect.Effect<void, ConfigurationErrorType>
    readonly getCurrentConfig: Effect.Effect<AppConfig, never>
    readonly getCurrentProject: Effect.Effect<ProjectConfig | undefined, never>
    readonly createProject: (name: string) => Effect.Effect<ProjectConfig, never>
    readonly updateProject: (project: ProjectConfig) => Effect.Effect<void, ConfigurationErrorType>
    readonly clearProject: Effect.Effect<void, ConfigurationErrorType>
    readonly configChanges: Stream.Stream<AppConfig>
  }
>() { }

export const ConfigServiceLive = Layer.scoped(
  ConfigService,
  Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make(defaultConfig as AppConfig)
    const persistence = yield* ConfigPersistence

    // On init, attempt to load persisted config; migrate or fall back to default
    const persisted = yield* persistence.load
    if (persisted) {
      try {
        const migrated = migrateConfig(persisted, { source: 'persisted' })
        yield* SubscriptionRef.set(ref, migrated)
        yield* persistence.save(migrated)
      } catch {
        const fallback = { ...(defaultConfig as AppConfigType), version: CURRENT_CONFIG_VERSION }
        yield* SubscriptionRef.set(ref, fallback)
        yield* persistence.save(fallback)
      }
    } else {
      const fallback = { ...(defaultConfig as AppConfigType), version: CURRENT_CONFIG_VERSION }
      yield* SubscriptionRef.set(ref, fallback)
      yield* persistence.save(fallback)
    }

    const validateConfig = (configToValidate: unknown): Effect.Effect<AppConfig, ConfigurationErrorType> =>
      validateAppConfig(configToValidate).pipe(
        Effect.mapError((parseError) =>
          new ConfigurationError({
            message: `Configuration validation failed: ${parseError.message}`,
            setting: 'config',
            value: configToValidate
          })
        )
      )

    const getServerConfig: Effect.Effect<DicomServerConfig, ConfigurationErrorType> = Effect.gen(function* () {
      const cfg = yield* SubscriptionRef.get(ref)
      yield* validateConfig(cfg)
      return { ...cfg.dicomServer }
    })

    const getAnonymizationConfig: Effect.Effect<AnonymizationConfig, ConfigurationErrorType> = Effect.gen(function* () {
      const cfg = yield* SubscriptionRef.get(ref)
      yield* validateConfig(cfg)
      const anonymizationConfig = cfg.anonymization

      let preserveTags = anonymizationConfig.preserveTags
      if (preserveTags) {
        preserveTags = preserveTags.map(tag => {
          if (/^[0-9A-Fa-f]{8}$/.test(tag)) return tag
          if (isValidTagName(tag)) {
            const hex = tagNameToHex(tag)
            if (hex) return hex
          }
          return tag
        })
      }

      return {
        removePrivateTags: anonymizationConfig.removePrivateTags,
        profileOptions: [...anonymizationConfig.profileOptions] as DicomProfileOption[],
        replacements: anonymizationConfig.replacements,
        preserveTags: preserveTags ? [...preserveTags] : undefined,
        tagsToRemove: anonymizationConfig.tagsToRemove ? [...anonymizationConfig.tagsToRemove] : undefined,
        dateJitterDays: anonymizationConfig.dateJitterDays,
        birthDateShiftMonths: anonymizationConfig.birthDateShiftMonths,
        useCustomHandlers: anonymizationConfig.useCustomHandlers,
        uidStrategy: anonymizationConfig.uidStrategy ?? 'perRun',
        organizationRoot: anonymizationConfig.organizationRoot
      }
    })

    const loadConfig = (configData: unknown): Effect.Effect<void, ConfigurationErrorType> => Effect.gen(function* () {
      try {
        const migrated = migrateConfig(configData, { source: 'uploaded' })
        yield* SubscriptionRef.set(ref, migrated)
        yield* persistence.save(migrated)
        console.log('Configuration loaded successfully')
      } catch (e) {
        const error = e as Error
        throw new ConfigurationError({
          message: `Configuration migration/validation failed: ${error.message}`,
          setting: 'config',
          value: configData
        })
      }
    })

    const getCurrentConfig: Effect.Effect<AppConfig, never> =
      SubscriptionRef.get(ref)

    const getCurrentProject: Effect.Effect<ProjectConfig | undefined, never> =
      Effect.map(SubscriptionRef.get(ref), (c) => c.project)

    const createProject = (name: string): Effect.Effect<ProjectConfig, never> =>
      Effect.succeed({
        name,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      })

    const updateProject = (project: ProjectConfig): Effect.Effect<void, ConfigurationErrorType> => Effect.gen(function* () {
      yield* SubscriptionRef.update(ref, (c) => ({ ...c, project }))
      const updated = yield* SubscriptionRef.get(ref)
      yield* persistence.save(updated)
      console.log('Project updated:', project.name)
    })

    const clearProject: Effect.Effect<void, ConfigurationErrorType> = Effect.gen(function* () {
      yield* SubscriptionRef.update(ref, (c) => {
        const { project: _omit, ...rest } = c
        return rest as AppConfig
      })
      const updated = yield* SubscriptionRef.get(ref)
      yield* persistence.save(updated)
      console.log('Project cleared, returned to default configuration')
    })

    return {
      getServerConfig,
      getAnonymizationConfig,
      validateConfig,
      loadConfig,
      getCurrentConfig,
      getCurrentProject,
      createProject,
      updateProject,
      clearProject,
      configChanges: ref.changes
    } as const
  })
)
