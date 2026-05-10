import { Layer } from 'effect'
import { AnonymizerLive } from '@dicorre/shared/services/anonymizer'
import { ConfigServiceLive } from '@dicorre/shared/services/config'
import { DicomProcessorLive } from '@dicorre/shared/services/dicomProcessor'
import { DicomSenderLive } from '@dicorre/shared/services/dicomSender'
import { DownloadServiceLive } from '@dicorre/shared/services/downloadService'
import { PluginRegistryLive } from '@dicorre/shared/services/pluginRegistry'
import { StudyLoggerLive } from '@dicorre/shared/services/studyLogger'
import { FileSystemStorageLive } from './services/fileSystemStorage'
import { JsonConfigPersistenceLive, JsonStudyLoggerPersistenceLive } from './services/jsonPersistence'

export const makeCliLayer = (workspaceDir: string) => {
  const storage = FileSystemStorageLive(workspaceDir)
  const config = ConfigServiceLive.pipe(Layer.provide(JsonConfigPersistenceLive(workspaceDir)))
  const logger = StudyLoggerLive.pipe(Layer.provide(JsonStudyLoggerPersistenceLive(workspaceDir)))

  return Layer.mergeAll(
    storage,
    config,
    logger,
    DicomProcessorLive,
    DicomSenderLive,
    PluginRegistryLive,
    AnonymizerLive.pipe(Layer.provide(DicomProcessorLive)),
    DownloadServiceLive.pipe(Layer.provide(storage)),
  )
}
