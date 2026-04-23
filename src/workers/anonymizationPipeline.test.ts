import { describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { Anonymizer, type StudyAnonymizationContext } from '@/services/anonymizer'
import { OPFSStorage } from '@/services/opfsStorage'
import { anonymizeStudyIncrementally, type AnonymizationFileRef } from './anonymizationPipeline'
import type { DicomFile } from '@/types/dicom'
import type { AnonymizationConfig } from '@/services/config/schema'

const baseConfig: AnonymizationConfig = {
  profileOptions: ['BasicProfile'],
  removePrivateTags: true,
  useCustomHandlers: true,
  uidStrategy: 'perRun',
  dateJitterDays: 31,
  organizationRoot: '1.2.826.0.1.3680043.8.498',
  preserveTags: [],
  tagsToRemove: [],
  replacements: { default: 'REMOVED' },
}

const fileRefs: AnonymizationFileRef[] = [
  {
    id: 'file-1',
    fileName: 'file-1.dcm',
    fileSize: 10,
    opfsFileId: 'file-1',
    metadata: { studyInstanceUID: 'study-1', sopInstanceUID: 'sop-1' },
  },
  {
    id: 'file-2',
    fileName: 'file-2.dcm',
    fileSize: 20,
    opfsFileId: 'file-2',
    metadata: { studyInstanceUID: 'study-1', sopInstanceUID: 'sop-2' },
  },
]

function makeLayer(options: { failOnFileId?: string } = {}) {
  const operations: string[] = []
  const saved = new Map<string, ArrayBuffer>()
  const source = new Map<string, ArrayBuffer>([
    ['file-1', new ArrayBuffer(10)],
    ['file-2', new ArrayBuffer(20)],
  ])

  const opfs = OPFSStorage.of({
    saveFile: (fileId, arrayBuffer) =>
      Effect.sync(() => {
        operations.push(`save:${fileId}`)
        saved.set(fileId, arrayBuffer)
      }),
    loadFile: (fileId) =>
      Effect.sync(() => {
        operations.push(`load:${fileId}`)
        const arrayBuffer = source.get(fileId)
        if (!arrayBuffer) throw new Error(`missing ${fileId}`)
        return arrayBuffer
      }),
    fileExists: (fileId) => Effect.succeed(source.has(fileId) || saved.has(fileId)),
    deleteFile: (fileId) =>
      Effect.sync(() => {
        operations.push(`delete:${fileId}`)
      }),
    listFiles: Effect.succeed([...source.keys(), ...saved.keys()]),
    clearAllFiles: Effect.succeed(undefined),
    getStorageInfo: Effect.succeed({ used: 0, quota: 1000 }),
  })

  const anonymizer = Anonymizer.of({
    createStudyContext: (studyId, config, contextOptions = {}) => ({
      studyId,
      config,
      sharedRandom: 'SHARED1',
      patientIdMap: contextOptions.patientIdMap,
      overrides: contextOptions.overrides,
    }),
    anonymizeFile: (file) => Effect.succeed({ ...file, anonymized: true }),
    anonymizeFileInStudyContext: (file: DicomFile, _context: StudyAnonymizationContext) =>
      Effect.sync(() => {
        operations.push(`anonymize:${file.id}`)
        if (file.id === options.failOnFileId) {
          throw new Error(`Cannot anonymize ${file.fileName}: Array buffer allocation failed`)
        }
        return {
          ...file,
          arrayBuffer: new ArrayBuffer(file.fileSize + 1),
          anonymized: true,
          metadata: {
            ...file.metadata,
            studyInstanceUID: 'anon-study-1',
          },
        }
      }),
    anonymizeStudy: (studyId, files) =>
      Effect.succeed({
        studyId,
        anonymizedFiles: files,
        totalFiles: files.length,
        completedFiles: files.length,
      }),
  })

  return {
    operations,
    saved,
    layer: Layer.mergeAll(
      Layer.succeed(OPFSStorage, opfs),
      Layer.succeed(Anonymizer, anonymizer),
    ),
  }
}

describe('anonymizeStudyIncrementally', () => {
  it('loads, anonymizes, saves, and releases one file before loading the next', async () => {
    const { layer, operations, saved } = makeLayer()
    const progress = vi.fn()
    const fileSaved = vi.fn()

    const result = await Effect.runPromise(
      anonymizeStudyIncrementally('study-1', fileRefs, baseConfig, {
        onProgress: progress,
        onFileSaved: fileSaved,
      }).pipe(Effect.provide(layer)),
    )

    expect(operations).toEqual([
      'load:file-1',
      'anonymize:file-1',
      'save:file-1',
      'load:file-2',
      'anonymize:file-2',
      'save:file-2',
    ])
    expect(saved.get('file-1')?.byteLength).toBe(11)
    expect(saved.get('file-2')?.byteLength).toBe(21)
    expect(result).toHaveLength(2)
    expect(result.every(file => file.arrayBuffer.byteLength === 0)).toBe(true)
    expect(result.every(file => file.anonymized)).toBe(true)
    expect(fileSaved).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenLastCalledWith({
      total: 2,
      completed: 2,
      percentage: 100,
      currentFile: 'file-2.dcm',
    })
  })

  it('keeps already saved files available when a later file fails', async () => {
    const { layer, operations, saved } = makeLayer({ failOnFileId: 'file-2' })
    const fileSaved = vi.fn()

    await expect(
      Effect.runPromise(
        anonymizeStudyIncrementally('study-1', fileRefs, baseConfig, {
          onFileSaved: fileSaved,
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow('Array buffer allocation failed')

    expect(operations).toEqual([
      'load:file-1',
      'anonymize:file-1',
      'save:file-1',
      'load:file-2',
      'anonymize:file-2',
    ])
    expect(saved.has('file-1')).toBe(true)
    expect(saved.has('file-2')).toBe(false)
    expect(fileSaved).toHaveBeenCalledTimes(1)
  })
})
