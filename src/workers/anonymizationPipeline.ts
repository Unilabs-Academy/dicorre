import { Effect } from 'effect'
import { Anonymizer } from '@/services/anonymizer'
import { OPFSStorage } from '@/services/opfsStorage'
import type { DicomFile } from '@/types/dicom'
import type { AnonymizationConfig } from '@/services/config/schema'
import type { AnonymizerError } from '@/types/effects'
import type { StorageErrorType } from '@/types/effects'

export interface AnonymizationFileRef {
  id: string
  fileName: string
  fileSize: number
  opfsFileId: string
  metadata?: unknown
}

export interface IncrementalAnonymizationProgress {
  total: number
  completed: number
  percentage: number
  currentFile?: string
}

export interface IncrementalAnonymizationOptions {
  patientIdMap?: Record<string, string>
  overrides?: Record<string, string>
  onProgress?: (progress: IncrementalAnonymizationProgress) => void
  onFileSaved?: (file: DicomFile) => void
}

export const anonymizeStudyIncrementally = (
  studyId: string,
  fileRefs: AnonymizationFileRef[],
  anonymizationConfig: AnonymizationConfig,
  options: IncrementalAnonymizationOptions = {},
): Effect.Effect<DicomFile[], Error | AnonymizerError | StorageErrorType, OPFSStorage | Anonymizer> =>
  Effect.gen(function* () {
    const opfs = yield* OPFSStorage
    const anonymizer = yield* Anonymizer
    const context = anonymizer.createStudyContext(studyId, anonymizationConfig, {
      patientIdMap: options.patientIdMap,
      overrides: options.overrides,
    })

    const anonymizedFiles: DicomFile[] = []
    const total = fileRefs.length
    let completed = 0

    for (const fileRef of fileRefs) {
      options.onProgress?.({
        total,
        completed,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        currentFile: fileRef.fileName,
      })

      const arrayBuffer = yield* opfs.loadFile(fileRef.opfsFileId).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            new Error(`File loading failed for ${fileRef.fileName} (${fileRef.opfsFileId}): ${error.message}`),
          ),
        ),
      )

      const sourceFile: DicomFile = {
        id: fileRef.id,
        fileName: fileRef.fileName,
        fileSize: fileRef.fileSize,
        arrayBuffer,
        anonymized: false,
        opfsFileId: fileRef.opfsFileId,
        metadata: fileRef.metadata as DicomFile['metadata'],
      }

      const anonymizedFile = yield* anonymizer.anonymizeFileInStudyContext(sourceFile, context)
      const targetId = anonymizedFile.id

      yield* opfs.saveFile(targetId, anonymizedFile.arrayBuffer).pipe(
        Effect.catchAll((error) =>
          Effect.fail(new Error(`File saving failed for ${anonymizedFile.fileName}: ${error.message}`)),
        ),
      )

      if (anonymizedFile.opfsFileId && anonymizedFile.opfsFileId !== targetId) {
        yield* opfs.deleteFile(anonymizedFile.opfsFileId).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        )
      }

      const lightweightFile: DicomFile = {
        ...anonymizedFile,
        opfsFileId: targetId,
        anonymized: true,
        arrayBuffer: new ArrayBuffer(0),
      }

      anonymizedFiles.push(lightweightFile)
      options.onFileSaved?.(lightweightFile)
      completed++

      options.onProgress?.({
        total,
        completed,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        currentFile: fileRef.fileName,
      })
    }

    return anonymizedFiles
  })
