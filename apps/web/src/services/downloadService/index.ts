import { Effect, Context, Layer } from 'effect'
import JSZip from 'jszip'
import type { DicomStudy } from '@/types/dicom'
import { OPFSStorage } from '@/services/opfsStorage'
import { StorageError, type StorageErrorType } from '@/types/effects'

// ~1.8 GB limit per ZIP to stay safely under the browser's ~2GB ArrayBuffer cap
const MAX_ZIP_SIZE_BYTES = 1.8 * 1024 * 1024 * 1024

interface FileEntry {
  path: string
  data: ArrayBuffer
}

export class DownloadService extends Context.Tag('DownloadService')<
  DownloadService,
  {
    readonly packageStudiesForDownload: (
      studies: DicomStudy[],
      studyIds: string[],
    ) => Effect.Effect<Blob[], StorageErrorType>
  }
>() {}

export const DownloadServiceLive = Layer.effect(
  DownloadService,
  Effect.gen(function* () {
    const opfsStorage = yield* OPFSStorage

    const sanitizeFolderName = (name: string): string => {
      return name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 255)
    }

    const sanitizeFileName = (filename: string): string => {
      return filename
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 255)
    }

    /**
     * Collect all files from studies into a flat list of { path, data } entries.
     */
    const collectFiles = (selectedStudies: DicomStudy[], availableFileIds: string[]) =>
      Effect.gen(function* () {
        const entries: FileEntry[] = []

        for (const study of selectedStudies) {
          const patientFolder = sanitizeFolderName(study.patientId || 'Unknown_Patient')
          const studyFolder = sanitizeFolderName(study.studyInstanceUID)

          for (const series of study.series) {
            const seriesFolder = sanitizeFolderName(series.seriesInstanceUID)
            const folderPath = `${patientFolder}/${studyFolder}/${seriesFolder}`

            for (const file of series.files) {
              const fileId = file.opfsFileId || file.id

              if (availableFileIds.includes(fileId)) {
                const fileData = yield* opfsStorage.loadFile(fileId)
                const fileName = file.fileName || `${file.metadata?.instanceNumber || 'image'}.dcm`
                const sanitizedFileName = sanitizeFileName(fileName)
                const fullPath = `${folderPath}/${sanitizedFileName}`

                entries.push({ path: fullPath, data: fileData })
                yield* Effect.logDebug(`Collected file for zip: ${fullPath}`)
              } else {
                yield* Effect.logWarning(`File not found in OPFS: ${fileId}`)
              }
            }
          }
        }

        return entries
      })

    /**
     * Build a single JSZip blob from a list of file entries.
     */
    const buildZip = (entries: FileEntry[]) =>
      Effect.gen(function* () {
        const zip = new JSZip()
        for (const entry of entries) {
          zip.file(entry.path, entry.data)
        }

        const blob = yield* Effect.tryPromise({
          try: () => zip.generateAsync({ type: 'blob' }),
          catch: (error) =>
            new StorageError({
              message: `Failed to generate ZIP file: ${error}`,
              operation: 'package',
            }),
        })

        return blob
      })

    const packageStudiesForDownload = (studies: DicomStudy[], studyIds: string[]) =>
      Effect.gen(function* () {
        // Get all available files from OPFS
        const availableFileIds = yield* opfsStorage.listFiles

        // Filter studies by the provided IDs
        const selectedStudies = studies.filter((study) => studyIds.includes(study.studyInstanceUID))

        if (selectedStudies.length === 0) {
          yield* Effect.logWarning('No studies found matching the provided IDs')
          return [new Blob([], { type: 'application/zip' })]
        }

        yield* Effect.logInfo(`Packaging ${selectedStudies.length} studies for download`)

        // Collect all files first so we can check total size
        const allEntries = yield* collectFiles(selectedStudies, availableFileIds)
        const totalSize = allEntries.reduce((sum, e) => sum + e.data.byteLength, 0)

        if (totalSize <= MAX_ZIP_SIZE_BYTES) {
          // Small enough for a single ZIP
          const blob = yield* buildZip(allEntries)
          yield* Effect.logInfo(
            `Successfully created download package with ${allEntries.length} files`,
          )
          return [blob]
        }

        // Split into multiple ZIPs, each staying under the size limit
        yield* Effect.logInfo(
          `Total size ${(totalSize / (1024 * 1024 * 1024)).toFixed(1)} GB exceeds limit, splitting into multiple ZIPs`,
        )

        const blobs: Blob[] = []
        let currentBatch: FileEntry[] = []
        let currentBatchSize = 0

        for (const entry of allEntries) {
          // If adding this file would exceed the limit and we already have files, flush the batch
          if (
            currentBatchSize + entry.data.byteLength > MAX_ZIP_SIZE_BYTES &&
            currentBatch.length > 0
          ) {
            const blob = yield* buildZip(currentBatch)
            blobs.push(blob)
            currentBatch = []
            currentBatchSize = 0
          }

          currentBatch.push(entry)
          currentBatchSize += entry.data.byteLength
        }

        // Flush remaining files
        if (currentBatch.length > 0) {
          const blob = yield* buildZip(currentBatch)
          blobs.push(blob)
        }

        yield* Effect.logInfo(
          `Successfully created ${blobs.length} download packages with ${allEntries.length} total files`,
        )

        return blobs
      })

    return {
      packageStudiesForDownload,
    } as const
  }),
)
