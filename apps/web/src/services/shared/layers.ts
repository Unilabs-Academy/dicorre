/**
 * Application-wide Effect layers for dependency injection
 */

import { Layer } from "effect"
import { ConfigServiceLive } from '../config'
import { ConfigPersistenceLocalStorage } from '../config/configPersistence'
import { FileHandlerLive } from '../fileHandler'
import { OPFSStorageLive } from '../opfsStorage'
import { PluginRegistryLive } from '../pluginRegistry'
import { DicomProcessorLive } from '../dicomProcessor'
import { AnonymizerLive } from '../anonymizer'
import { DicomSenderLive } from '../dicomSender'
import { DownloadServiceLive } from '../downloadService'
import { SessionPersistenceLive } from '../sessionPersistence'
import { StudyLoggerLive } from '../studyLogger'
import { StudyLoggerPersistenceLocalStorage } from '../studyLogger/persistence'

/**
 * Base services with no dependencies
 */
export const BaseServicesLayer = Layer.mergeAll(
  ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceLocalStorage)),
  PluginRegistryLive,
  OPFSStorageLive,
  SessionPersistenceLive,
  StudyLoggerLive.pipe(Layer.provide(StudyLoggerPersistenceLocalStorage))
)

/**
 * Services that depend on base services
 */
export const ProcessingServicesLayer = Layer.mergeAll(
  DicomProcessorLive,
  FileHandlerLive.pipe(Layer.provide(PluginRegistryLive))
).pipe(
  Layer.provide(BaseServicesLayer)
)

/**
 * Services that depend on processing services
 */
export const AdvancedServicesLayer = Layer.mergeAll(
  AnonymizerLive.pipe(Layer.provide(DicomProcessorLive)),
  DicomSenderLive
).pipe(
  Layer.provide(ProcessingServicesLayer)
)

/**
 * Complete application layer with all services
 */
export const AppLayer = Layer.mergeAll(
  ConfigServiceLive.pipe(Layer.provide(ConfigPersistenceLocalStorage)),
  PluginRegistryLive,
  OPFSStorageLive,
  DicomProcessorLive,
  SessionPersistenceLive.pipe(Layer.provide(Layer.mergeAll(DicomProcessorLive, OPFSStorageLive))),
  AnonymizerLive.pipe(Layer.provide(DicomProcessorLive)),
  DicomSenderLive,
  DownloadServiceLive.pipe(Layer.provide(OPFSStorageLive)),
  StudyLoggerLive.pipe(Layer.provide(StudyLoggerPersistenceLocalStorage))
).pipe(
  Layer.provideMerge(Layer.mergeAll(
    FileHandlerLive.pipe(Layer.provide(PluginRegistryLive))
  ))
)

/**
 * Individual service exports for selective use
 */
export const ConfigLayer = ConfigServiceLive
export const PluginRegistryLayer = PluginRegistryLive
export const FileHandlerLayer = FileHandlerLive.pipe(Layer.provide(PluginRegistryLive))
export const OPFSStorageLayer = OPFSStorageLive
export const DicomProcessorLayer = DicomProcessorLive.pipe(Layer.provide(BaseServicesLayer))
export const AnonymizerLayer = AnonymizerLive.pipe(Layer.provide(DicomProcessorLive))
export const DicomSenderLayer = DicomSenderLive
export const DownloadServiceLayer = DownloadServiceLive.pipe(Layer.provide(OPFSStorageLive))

