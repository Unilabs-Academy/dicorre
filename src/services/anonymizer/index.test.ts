import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Anonymizer, AnonymizerLive } from './index'
import { DicomProcessor, DicomProcessorLive } from '../dicomProcessor'
import { Layer } from 'effect'
import { clearValueCache } from './handlers'
import type { DicomFile } from '@/types/dicom'
import { TestConfigLayer } from '../shared/test-layers'
import { ConfigService } from '../config'
import type { AnonymizationConfig } from '@/services/config/schema'

// Helper to load DICOM files from test-data
function loadTestDicomFile(relativePath: string): DicomFile {
  const fullPath = join(process.cwd(), 'test-data', relativePath)
  console.log(fullPath)
  const buffer = readFileSync(fullPath)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

  return {
    id: `effect-test-${Date.now()}`,
    fileName: relativePath.split('/').pop() || 'unknown.dcm',
    fileSize: arrayBuffer.byteLength,
    arrayBuffer,
    anonymized: false
  }
}

describe('Anonymizer Service (Effect Service Testing)', () => {
  // AnonymizerLive requires DicomProcessor and ConfigService, so we compose them properly
  const testLayer = Layer.mergeAll(
    DicomProcessorLive,
    TestConfigLayer,
    AnonymizerLive.pipe(Layer.provide(Layer.mergeAll(DicomProcessorLive, TestConfigLayer)))
  )

  const runTest = <A, E>(effect: Effect.Effect<A, E, Anonymizer | DicomProcessor | ConfigService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

  beforeEach(() => {
    clearValueCache()
  })

  describe('Configuration integration', () => {
    it('should anonymize file using config-based replacements', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      console.log(dicomFile)

      // First parse the file using the test layer
      const parsedFile = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFile(dicomFile)
        }).pipe(Effect.provide(testLayer))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        return yield* anonymizer.anonymizeFile(parsedFile, config)
      }))

      expect(result.anonymized).toBe(true)
      expect(result.metadata).toBeDefined()

      // Verify that the anonymized metadata contains expected patterns from test config
      if (result.metadata) {
        console.log('Anonymized metadata:', result.metadata)
        // These should be replaced with the processed random patterns (7 uppercase alphanumeric chars)
        expect(result.metadata.accessionNumber).toMatch(/^ACA[A-Z0-9]{7}$/)
        expect(result.metadata.patientId).toMatch(/^PAT[A-Z0-9]{7}$/)
        // PatientName should use default "REMOVED" since it's not in replacements
        // PatientName in DICOM can be a structured object
        if (typeof result.metadata.patientName === 'string') {
          expect(result.metadata.patientName).toBe('REMOVED')
        } else if (result.metadata.patientName && typeof result.metadata.patientName === 'object') {
          expect((result.metadata.patientName as any).Alphabetic).toBe('REMOVED')
        }
      }
    })
  })

  describe('File anonymization', () => {
    it('should anonymize DICOM file', async () => {
      const dicomFile = loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')

      // First parse the file using the test layer
      const parsedFile = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFile(dicomFile)
        }).pipe(Effect.provide(testLayer))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        return yield* anonymizer.anonymizeFile(parsedFile, config)
      }))

      expect(result.anonymized).toBe(true)
      expect(result.arrayBuffer).toBeDefined()
    })

    it('should anonymize multiple files', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      // Parse files first
      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        const studyResult = yield* anonymizer.anonymizeStudy('test-study', parsedFiles, config)
        return studyResult.anonymizedFiles
      }))

      expect(result).toHaveLength(1)
      expect(result[0].anonymized).toBe(true)
    })

    it('should anonymize study with events', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      // Parse files first
      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const config: AnonymizationConfig = {
        profileOptions: ['BasicProfile'],
        removePrivateTags: true,
        useCustomHandlers: false
      }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer

        // Start anonymization with progress callback
        let progressCalled = false
        const studyResult = yield* anonymizer.anonymizeStudy(
          'test-study-123',
          parsedFiles,
          config,
          {
            concurrency: 1,
            onProgress: () => { progressCalled = true }
          }
        )

        return { files: studyResult.anonymizedFiles, progressCalled }
      }))

      // Verify results
      expect(result.files).toHaveLength(1)
      expect(result.files[0].anonymized).toBe(true)
      expect(result.progressCalled).toBe(true)
    })
  })

  describe('Study anonymization', () => {
    it('applies per-study overrides to specific DICOM tags', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig

        const overrides = {
          "Patient's Birth Date": '19900101',
          "Patient's Sex": 'M'
        }

        return yield* anonymizer.anonymizeStudy(
          'test-study-overrides',
          parsedFiles,
          config,
          { concurrency: 1, overrides }
        )
      }))

      expect(result.anonymizedFiles.length).toBe(1)
      const meta = result.anonymizedFiles[0].metadata
      expect(meta).toBeDefined()
      if (meta) {
        expect(meta.patientBirthDate).toBe('19900101')
        expect(meta.patientSex).toBe('M')
      }
    })

    it('applies per-study override to Study Description', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig

        const overrides = {
          'Study Description': 'CUSTOM_DESC'
        }

        return yield* anonymizer.anonymizeStudy(
          'test-study-description-override',
          parsedFiles,
          config,
          { concurrency: 1, overrides }
        )
      }))

      expect(result.anonymizedFiles.length).toBe(1)
      const meta = result.anonymizedFiles[0].metadata
      expect(meta).toBeDefined()
      if (meta) {
        expect(meta.studyDescription).toBe('CUSTOM_DESC')
      }
    })
    it('should handle empty file list', async () => {
      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer

        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        return yield* anonymizer.anonymizeStudy(
          'test-study-empty',
          [],
          config,
          { concurrency: 1 }
        )
      }))

      expect(result.studyId).toBe('test-study-empty')
      expect(result.totalFiles).toBe(0)
      expect(result.anonymizedFiles).toHaveLength(0)
    })

    it('should handle concurrent file processing', async () => {
      // Create multiple test files
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ].map((file, index) => ({ ...file, id: `file-${index}` }))

      // Parse files first
      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig

        return yield* anonymizer.anonymizeStudy(
          'test-study-concurrent',
          parsedFiles,
          config,
          { concurrency: 3 } // Process all files concurrently
        )
      }))

      // Verify all files were processed
      expect(result.studyId).toBe('test-study-concurrent')
      expect(result.totalFiles).toBe(3)
      expect(result.anonymizedFiles).toHaveLength(3)

      // All files should be anonymized
      result.anonymizedFiles.forEach(file => {
        expect(file.anonymized).toBe(true)
      })
    })

    it('respects provided patientIdMap and keeps same assigned ID for same original IDs', async () => {
      // Load two files that will share the same original patientId after parsing
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      // Build patientIdMap using parsed metadata patientId
      const originalId = parsedFiles[0].metadata?.patientId || 'Unknown'
      const patientIdMap: Record<string, string> = { [originalId]: 'PATFIXED123' }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig

        return yield* anonymizer.anonymizeStudy(
          'test-study-mapping',
          parsedFiles,
          config,
          { concurrency: 2, patientIdMap }
        )
      }))

      expect(result.anonymizedFiles.length).toBe(2)
      const ids = result.anonymizedFiles.map(f => f.metadata?.patientId)
      expect(ids.every(id => id === 'PATFIXED123')).toBe(true)
    })

    it('keeps patient ID mapping when anonymizing incrementally with a study context', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC'),
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const originalId = parsedFiles[0].metadata?.patientId || 'Unknown'
      const patientIdMap: Record<string, string> = { [originalId]: 'PATSTREAM1' }

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const config = yield* configService.getAnonymizationConfig
        const context = anonymizer.createStudyContext('stream-study-mapping', config, { patientIdMap })

        const anonymized: DicomFile[] = []
        for (const file of parsedFiles) {
          anonymized.push(yield* anonymizer.anonymizeFileInStudyContext(file, context))
        }
        return anonymized
      }))

      expect(result).toHaveLength(2)
      expect(result.every(file => file.metadata?.patientId === 'PATSTREAM1')).toBe(true)
    })

    it('generates different core UIDs across runs when uidStrategy is perRun', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const baseConfig = yield* configService.getAnonymizationConfig
        const config: AnonymizationConfig = { ...baseConfig, uidStrategy: 'perRun' }

        const run1 = yield* anonymizer.anonymizeStudy('uid-per-run-study', parsedFiles, config, { concurrency: 1 })
        const run2 = yield* anonymizer.anonymizeStudy('uid-per-run-study', parsedFiles, config, { concurrency: 1 })

        return { run1, run2 }
      }))

      const meta1 = result.run1.anonymizedFiles[0].metadata
      const meta2 = result.run2.anonymizedFiles[0].metadata
      expect(meta1?.studyInstanceUID).toBeDefined()
      expect(meta2?.studyInstanceUID).toBeDefined()
      expect(meta1?.studyInstanceUID).not.toBe(meta2?.studyInstanceUID)
      expect(meta1?.seriesInstanceUID).not.toBe(meta2?.seriesInstanceUID)
      expect(meta1?.sopInstanceUID).not.toBe(meta2?.sopInstanceUID)
    })

    it('keeps core UIDs stable across runs when uidStrategy is deterministic', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const result = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const configService = yield* ConfigService
        const baseConfig = yield* configService.getAnonymizationConfig
        const config: AnonymizationConfig = { ...baseConfig, uidStrategy: 'deterministic' }

        const run1 = yield* anonymizer.anonymizeStudy('uid-deterministic-study', parsedFiles, config, { concurrency: 1 })
        const run2 = yield* anonymizer.anonymizeStudy('uid-deterministic-study', parsedFiles, config, { concurrency: 1 })

        return { run1, run2 }
      }))

      const meta1 = result.run1.anonymizedFiles[0].metadata
      const meta2 = result.run2.anonymizedFiles[0].metadata
      expect(meta1?.studyInstanceUID).toBe(meta2?.studyInstanceUID)
      expect(meta1?.seriesInstanceUID).toBe(meta2?.seriesInstanceUID)
      expect(meta1?.sopInstanceUID).toBe(meta2?.sopInstanceUID)
    })

    it('creates separate grouped studies across perRun anonymization runs', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const grouped = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const processor = yield* DicomProcessor
        const configService = yield* ConfigService
        const baseConfig = yield* configService.getAnonymizationConfig
        const config: AnonymizationConfig = { ...baseConfig, uidStrategy: 'perRun' }

        const overrides = { 'Patient ID': 'PAT-GROUP-001' }
        const run1 = yield* anonymizer.anonymizeStudy('group-study', parsedFiles, config, { concurrency: 1, overrides })
        const run2 = yield* anonymizer.anonymizeStudy('group-study', parsedFiles, config, { concurrency: 1, overrides })
        const run2Files = run2.anonymizedFiles.map((f, idx) => ({ ...f, id: `run2-${idx}-${f.id}` }))

        return yield* processor.groupFilesByStudy([...run1.anonymizedFiles, ...run2Files])
      }))

      expect(grouped.length).toBe(2)
    })

    it('keeps grouped study unified when Study Instance UID is pinned', async () => {
      const files = [
        loadTestDicomFile('CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
      ]

      const parsedFiles = await Effect.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files)
        }).pipe(Effect.provide(DicomProcessorLive))
      )

      const grouped = await runTest(Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        const processor = yield* DicomProcessor
        const configService = yield* ConfigService
        const baseConfig = yield* configService.getAnonymizationConfig
        const config: AnonymizationConfig = { ...baseConfig, uidStrategy: 'perRun' }

        const run1 = yield* anonymizer.anonymizeStudy(
          'group-study-pinned',
          parsedFiles,
          config,
          { concurrency: 1, overrides: { 'Patient ID': 'PAT-GROUP-002' } }
        )
        const pinnedStudyUid = run1.anonymizedFiles[0]?.metadata?.studyInstanceUID
        if (!pinnedStudyUid) {
          return yield* Effect.fail(new Error('Expected pinned Study Instance UID to be defined'))
        }
        const run2 = yield* anonymizer.anonymizeStudy(
          'group-study-pinned',
          parsedFiles,
          config,
          {
            concurrency: 1,
            overrides: {
              'Patient ID': 'PAT-GROUP-002',
              'Study Instance UID': pinnedStudyUid!
            }
          }
        )
        const run2Files = run2.anonymizedFiles.map((f, idx) => ({ ...f, id: `run2-pinned-${idx}-${f.id}` }))

        return yield* processor.groupFilesByStudy([...run1.anonymizedFiles, ...run2Files])
      }))

      expect(grouped.length).toBe(1)
    })
  })

  describe('Error handling', () => {
    it('should reject files without metadata', async () => {
      const fileWithoutMetadata: DicomFile = {
        id: 'test-no-metadata',
        fileName: 'invalid.dcm',
        fileSize: 100,
        arrayBuffer: new ArrayBuffer(100),
        anonymized: false
        // No metadata
      }

      const config: AnonymizationConfig = {
        profileOptions: ['BasicProfile'],
        removePrivateTags: true,
        useCustomHandlers: true
      }

      await expect(
        runTest(Effect.gen(function* () {
          const anonymizer = yield* Anonymizer
          return yield* anonymizer.anonymizeFile(fileWithoutMetadata, config)
        }))
      ).rejects.toThrow()
    })
  })
})
