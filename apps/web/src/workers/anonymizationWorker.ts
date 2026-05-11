import { ManagedRuntime } from 'effect'
import { AppLayer } from '@/services/shared/layers'
import type { DicomFile } from '@/types/dicom'
import type { AnonymizationConfig } from '@/services/config/schema'
import { anonymizeStudyIncrementally, type AnonymizationFileRef } from './anonymizationPipeline'

const runtime = ManagedRuntime.make(AppLayer)

// Message types
interface WorkerMessage {
  type: 'anonymize_study'
  data: {
    studyId: string
    files: AnonymizationFileRef[]
    anonymizationConfig: AnonymizationConfig
    concurrency?: number
    patientIdMap?: Record<string, string>
    overrides?: Record<string, string>
  }
}

type WorkerResponse =
  | { type: 'progress'; studyId: string; data: { total: number; completed: number; percentage: number; currentFile?: string } }
  | { type: 'complete'; studyId: string; data: { anonymizedFiles: DicomFile[] } }
  | { type: 'error'; studyId: string; data: { message: string; stack?: string; anonymizedFiles?: DicomFile[] } }

// Main worker function
async function anonymizeStudy(studyId: string, fileRefs: AnonymizationFileRef[], anonymizationConfig: AnonymizationConfig, _concurrency = 1, patientIdMap?: Record<string, string>, overrides?: Record<string, string>) {
  const savedFiles: DicomFile[] = []
  try {
    const anonymizedFiles = await runtime.runPromise(
      anonymizeStudyIncrementally(studyId, fileRefs, anonymizationConfig, {
        patientIdMap,
        overrides,
        onProgress: (progress) => {
          self.postMessage({ type: 'progress', studyId, data: progress } as WorkerResponse)
        },
        onFileSaved: (file) => {
          savedFiles.push(file)
        }
      })
    )

    self.postMessage({ type: 'complete', studyId, data: { anonymizedFiles } } as WorkerResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Anonymization worker failed for study ${studyId}:`, error)
    self.postMessage({
      type: 'error',
      studyId,
      data: {
        message,
        stack: error instanceof Error ? error.stack : undefined,
        anonymizedFiles: savedFiles
      }
    } as WorkerResponse)
  }
}

// Message listener
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data

  if (type === 'anonymize_study') {
    anonymizeStudy(data.studyId, data.files, data.anonymizationConfig, data.concurrency, data.patientIdMap, data.overrides)
  }
})

// Ready signal
self.postMessage({ type: 'complete', studyId: 'worker-ready', data: { anonymizedFiles: [] } } as WorkerResponse)
