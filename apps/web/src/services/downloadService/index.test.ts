import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { DownloadService, DownloadServiceLive } from './index'
import { OPFSStorage } from '../opfsStorage'
import { StorageError } from '@/types/effects'
import type { DicomStudy, DicomFile } from '@/types/dicom'

// Mock JSZip
const mockFile = vi.fn()
const mockGenerateAsync = vi
  .fn()
  .mockResolvedValue(new Blob(['mock zip content'], { type: 'application/zip' }))

vi.mock('jszip', () => ({
  default: vi.fn().mockImplementation(() => ({
    file: mockFile,
    generateAsync: mockGenerateAsync,
    files: {},
  })),
}))

// Mock OPFS Storage
const mockOPFSStorage = () => {
  const mockFiles = new Map<string, ArrayBuffer>()

  // Add some test files
  mockFiles.set('file1', new ArrayBuffer(100))
  mockFiles.set('file2', new ArrayBuffer(200))
  mockFiles.set('file3', new ArrayBuffer(300))

  return {
    listFiles: Effect.succeed(['file1', 'file2', 'file3']),
    loadFile: (fileId: string) =>
      mockFiles.has(fileId)
        ? Effect.succeed(mockFiles.get(fileId)!)
        : Effect.fail(
            new StorageError({
              message: `File not found: ${fileId}`,
              operation: 'load',
              fileName: fileId,
            }),
          ),
    saveFile: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    fileExists: vi.fn().mockReturnValue(Effect.succeed(true)),
    deleteFile: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    clearAllFiles: Effect.succeed(undefined),
    getStorageInfo: Effect.succeed({ used: 1000, quota: 10000 }),
  }
}

const createTestStudy = (
  studyInstanceUID: string,
  patientId: string = 'TEST001',
  seriesCount: number = 1,
): DicomStudy => ({
  id: `study-${studyInstanceUID}`,
  studyInstanceUID,
  patientId,
  patientName: `Patient ${patientId}`,
  studyDate: '20241201',
  studyDescription: `Test Study ${studyInstanceUID}`,
  series: Array.from({ length: seriesCount }, (_, i) => ({
    seriesInstanceUID: `${studyInstanceUID}.${i + 1}`,
    seriesDescription: `Test Series ${i + 1}`,
    modality: 'CT',
    files: [
      {
        id: `file${i + 1}`,
        fileName: `image${i + 1}.dcm`,
        fileSize: (i + 1) * 100,
        arrayBuffer: new ArrayBuffer((i + 1) * 100),
        opfsFileId: `file${i + 1}`,
        metadata: {
          instanceNumber: i + 1,
          sopInstanceUID: `${studyInstanceUID}.${i + 1}.1`,
        },
      } as DicomFile,
    ],
  })),
})

describe('DownloadService', () => {
  const mockStorage = mockOPFSStorage()

  const testLayer = Layer.mergeAll(
    Layer.succeed(OPFSStorage, OPFSStorage.of(mockStorage)),
    DownloadServiceLive.pipe(
      Layer.provide(Layer.succeed(OPFSStorage, OPFSStorage.of(mockStorage))),
    ),
  )

  const runTest = <A, E>(effect: Effect.Effect<A, E, DownloadService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

  beforeEach(() => {
    vi.clearAllMocks()
    mockFile.mockClear()
    mockGenerateAsync.mockClear()
  })

  describe('packageStudiesForDownload', () => {
    it('should create zip with single study', async () => {
      const studies = [createTestStudy('1.2.3.4.5', 'PAT001')]
      const studyIds = ['1.2.3.4.5']

      const result = await runTest(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Blob)
      expect(result[0].type).toBe('application/zip')

      // Verify JSZip was used correctly
      expect(mockFile).toHaveBeenCalledWith(
        'PAT001/1.2.3.4.5/1.2.3.4.5.1/image1.dcm',
        expect.any(ArrayBuffer),
      )
    })

    it('should create zip with multiple studies', async () => {
      const studies = [
        createTestStudy('1.2.3.4.5', 'PAT001'),
        createTestStudy('1.2.3.4.6', 'PAT002'),
      ]
      const studyIds = ['1.2.3.4.5', '1.2.3.4.6']

      const result = await runTest(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Blob)

      // Should have files from both studies
      expect(mockFile).toHaveBeenCalledWith(
        'PAT001/1.2.3.4.5/1.2.3.4.5.1/image1.dcm',
        expect.any(ArrayBuffer),
      )
      expect(mockFile).toHaveBeenCalledWith(
        'PAT002/1.2.3.4.6/1.2.3.4.6.1/image1.dcm',
        expect.any(ArrayBuffer),
      )
    })

    it('should handle study with multiple series', async () => {
      const studies = [createTestStudy('1.2.3.4.5', 'PAT001', 2)]
      const studyIds = ['1.2.3.4.5']

      const result = await runTest(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Blob)

      // Should have files from both series
      expect(mockFile).toHaveBeenCalledWith(
        'PAT001/1.2.3.4.5/1.2.3.4.5.1/image1.dcm',
        expect.any(ArrayBuffer),
      )
      expect(mockFile).toHaveBeenCalledWith(
        'PAT001/1.2.3.4.5/1.2.3.4.5.2/image2.dcm',
        expect.any(ArrayBuffer),
      )
    })

    it('should return empty blob when no matching study IDs', async () => {
      const studies = [createTestStudy('1.2.3.4.5', 'PAT001')]
      const studyIds = ['nonexistent.id']

      const result = await runTest(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Blob)
      expect(result[0].size).toBe(0)
      expect(result[0].type).toBe('application/zip')
    })

    it('should return empty blob when no studies provided', async () => {
      const studies: DicomStudy[] = []
      const studyIds = ['1.2.3.4.5']

      const result = await runTest(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Blob)
      expect(result[0].size).toBe(0)
    })

    it('should handle missing files in OPFS gracefully', async () => {
      // Create study with file that doesn't exist in OPFS
      const study = createTestStudy('1.2.3.4.5', 'PAT001')
      study.series[0].files[0].opfsFileId = 'nonexistent-file'

      const studies = [study]
      const studyIds = ['1.2.3.4.5']

      const result = await runTest(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Blob)

      // Should still create zip but without the missing file
      // File should not be added to zip since it doesn't exist in OPFS
      expect(mockFile).not.toHaveBeenCalledWith(
        expect.stringContaining('nonexistent-file'),
        expect.any(ArrayBuffer),
      )
    })

    it('should sanitize folder and file names', async () => {
      const study = createTestStudy('1.2.3.4.5', 'PAT<>001')
      study.patientName = 'Patient/With\\Invalid:Chars'
      study.series[0].files[0].fileName = 'file|with*invalid?chars.dcm'

      const studies = [study]
      const studyIds = ['1.2.3.4.5']

      const result = await runTest(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Blob)

      // Should sanitize invalid characters
      expect(mockFile).toHaveBeenCalledWith(
        'PAT__001/1.2.3.4.5/1.2.3.4.5.1/file_with_invalid_chars.dcm',
        expect.any(ArrayBuffer),
      )
    })

    it('should handle missing patient ID gracefully', async () => {
      const study = createTestStudy('1.2.3.4.5')
      study.patientId = undefined

      const studies = [study]
      const studyIds = ['1.2.3.4.5']

      const result = await runTest(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Blob)

      // Should use "Unknown_Patient" when patient ID is missing
      expect(mockFile).toHaveBeenCalledWith(
        'Unknown_Patient/1.2.3.4.5/1.2.3.4.5.1/image1.dcm',
        expect.any(ArrayBuffer),
      )
    })
  })
})
