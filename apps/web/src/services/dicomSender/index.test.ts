import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import * as dcmjs from 'dcmjs'
import {
  DicomSender,
  DicomSenderLive,
  getEffectiveSendTimeoutMs,
  type SendStudyResult
} from './index'
import { OPFSStorage } from '@/services/opfsStorage'
import { StorageError } from '@/types/effects'
import type { DicomFile } from '@/types/dicom'

const originalFetch = globalThis.fetch
const MULTIFRAME_TRUE_COLOR_SC_UID = '1.2.840.10008.5.1.4.1.1.7.4'
const IMPLICIT_VR_LITTLE_ENDIAN_UID = '1.2.840.10008.1.2'

const createDicomFile = (overrides: Partial<DicomFile> = {}): DicomFile => ({
  id: overrides.id ?? 'file-1',
  fileName: overrides.fileName ?? 'test.dcm',
  fileSize: overrides.fileSize ?? 256,
  arrayBuffer: overrides.arrayBuffer ?? new ArrayBuffer(256),
  anonymized: overrides.anonymized ?? true,
  metadata: {
    patientName: 'Test Patient',
    patientId: 'TEST001',
    studyInstanceUID: '1.2.3.study',
    studyDate: '20260101',
    studyDescription: 'Test Study',
    seriesInstanceUID: '1.2.3.series',
    seriesDescription: 'Test Series',
    modality: 'MR',
    sopInstanceUID: overrides.metadata?.sopInstanceUID ?? `1.2.3.sop.${overrides.id ?? '1'}`,
    ...overrides.metadata
  }
})

const createSupportedMultiframeBuffer = (): ArrayBuffer => {
  const uid = () => (dcmjs.data as any).DicomMetaDictionary.uid()
  const sopInstanceUID = uid()
  const meta = {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1])] },
    '00020002': { vr: 'UI', Value: [MULTIFRAME_TRUE_COLOR_SC_UID] },
    '00020003': { vr: 'UI', Value: [sopInstanceUID] },
    '00020010': { vr: 'UI', Value: [IMPLICIT_VR_LITTLE_ENDIAN_UID] },
    '00020012': { vr: 'UI', Value: [uid()] },
    '00020013': { vr: 'SH', Value: ['RATATOSKR'] }
  }
  const dict = {
    '00080016': { vr: 'UI', Value: [MULTIFRAME_TRUE_COLOR_SC_UID] },
    '00080018': { vr: 'UI', Value: [sopInstanceUID] },
    '00080060': { vr: 'CS', Value: ['OT'] },
    '00100010': { vr: 'PN', Value: ['REMOVED'] },
    '00100020': { vr: 'LO', Value: ['PATIENT'] },
    '0020000D': { vr: 'UI', Value: [uid()] },
    '0020000E': { vr: 'UI', Value: [uid()] },
    '00200013': { vr: 'IS', Value: ['1'] },
    '00280002': { vr: 'US', Value: [3] },
    '00280004': { vr: 'CS', Value: ['RGB'] },
    '00280006': { vr: 'US', Value: [0] },
    '00280008': { vr: 'IS', Value: ['2'] },
    '00280010': { vr: 'US', Value: [2] },
    '00280011': { vr: 'US', Value: [4] },
    '00280100': { vr: 'US', Value: [8] },
    '00280101': { vr: 'US', Value: [8] },
    '00280102': { vr: 'US', Value: [7] },
    '00280103': { vr: 'US', Value: [0] },
    '7FE00010': { vr: 'OB', Value: [new Uint8Array(48)] }
  }
  const dicomDict = new (dcmjs.data as any).DicomDict(meta)
  dicomDict.dict = dict
  return dicomDict.write() as ArrayBuffer
}

const makeOpfsLayer = (buffers: Record<string, ArrayBuffer>) =>
  Layer.succeed(
    OPFSStorage,
    OPFSStorage.of({
      saveFile: () => Effect.succeed(undefined),
      loadFile: (fileId: string) =>
        fileId in buffers
          ? Effect.succeed(buffers[fileId]!)
          : Effect.fail(new StorageError({ message: `Missing OPFS file ${fileId}`, fileName: fileId })),
      fileExists: () => Effect.succeed(true),
      deleteFile: () => Effect.succeed(undefined),
      listFiles: Effect.succeed([]),
      clearAllFiles: Effect.succeed(undefined),
      getStorageInfo: Effect.succeed({ used: 0, quota: 0 })
    })
  )

const runSendFile = <A>(effect: Effect.Effect<A, unknown, DicomSender>) =>
  Effect.runPromise(effect.pipe(Effect.provide(DicomSenderLive)))

const runSendFiles = (
  effect: Effect.Effect<SendStudyResult, unknown, DicomSender | OPFSStorage>,
  files: DicomFile[]
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.mergeAll(DicomSenderLive, makeOpfsLayer(
        Object.fromEntries(files.map((file) => [file.id, file.arrayBuffer]))
      )))
    )
  )

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DicomSender Service', () => {
  it('keeps the configured timeout for normal-sized files', () => {
    const timeoutMs = getEffectiveSendTimeoutMs(createDicomFile({ fileSize: 1024 }), { timeout: 30000 })

    expect(timeoutMs).toBe(30000)
  })

  it('uses adaptive and increasing timeouts for large files', () => {
    const largeFile = createDicomFile({ fileSize: 641_222_812 })

    expect(getEffectiveSendTimeoutMs(largeFile, { timeout: 30000 }, 1)).toBe(335759)
    expect(getEffectiveSendTimeoutMs(largeFile, { timeout: 30000 }, 2)).toBe(503639)
    expect(getEffectiveSendTimeoutMs(largeFile, { timeout: 30000 }, 3)).toBe(600000)
  })

  it('uses configured headers and auth when testing connection', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValue(new Response('', { status: 200 })) as typeof fetch

    const result = await runSendFile(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.testConnection({
          url: 'http://localhost:8042',
          headers: { 'x-api-key': 'test-key' },
          auth: { type: 'bearer', credentials: 'test-token' },
          testConnectionPath: '/studies',
          description: 'Test Server'
        })
      })
    )

    expect(result).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8042/studies', {
      method: 'GET',
      headers: {
        'Accept': 'application/dicom+json',
        'x-api-key': 'test-key',
        'Authorization': 'Bearer test-token'
      }
    })
  })

  it('retries transient network failures and succeeds', async () => {
    vi.useFakeTimers()
    const file = createDicomFile()
    const retrySpy = vi.fn()

    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response('', { status: 200 })) as typeof fetch

    const promise = runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([file], {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        }, 1, {
          onFileRetry: retrySpy
        })
      }),
      [file]
    )

    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(retrySpy).toHaveBeenCalledTimes(1)
    expect(result.succeededCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(result.succeeded[0]?.attempts).toBe(2)
  })

  it('records a timeout failure after exhausting retries', async () => {
    vi.useFakeTimers()
    const file = createDicomFile()
    const retrySpy = vi.fn()

    globalThis.fetch = vi.fn()
      .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })) as typeof fetch

    const promise = runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([file], {
          url: 'http://localhost:8042',
          timeout: 25,
          description: 'Test Server'
        }, 1, {
          onFileRetry: retrySpy
        })
      }),
      [file]
    )

    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise

    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
    expect(retrySpy).toHaveBeenCalledTimes(2)
    expect(result.succeededCount).toBe(0)
    expect(result.failedCount).toBe(1)
    expect(result.failed[0]?.failureKind).toBe('timeout')
    expect(result.failed[0]?.attempts).toBe(3)
  })

  it('records the adaptive timeout used for a large file timeout', async () => {
    vi.useFakeTimers()
    const file = createDicomFile({
      fileSize: 60 * 1024 * 1024,
      arrayBuffer: new ArrayBuffer(1)
    })

    globalThis.fetch = vi.fn()
      .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })) as typeof fetch

    const promise = runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([file], {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        }, 1)
      }),
      [file]
    )

    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise

    expect(result.failedCount).toBe(1)
    expect(result.failed[0]?.failureKind).toBe('timeout')
    expect(result.failed[0]?.timeoutMs).toBe(60200)
  })

  it('falls back to split derived frames only after a large multi-frame file exhausts retries', async () => {
    vi.useFakeTimers()
    const arrayBuffer = createSupportedMultiframeBuffer()
    const file = createDicomFile({
      id: 'large-multiframe',
      fileName: 'large-multiframe.dcm',
      fileSize: 600 * 1024 * 1024,
      arrayBuffer,
      metadata: {
        sopInstanceUID: '1.2.3.large',
        transferSyntaxUID: IMPLICIT_VR_LITTLE_ENDIAN_UID
      }
    })
    const fallbackSpy = vi.fn()

    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockImplementation(() => Promise.resolve(new Response('', { status: 200 }))) as typeof fetch

    const promise = runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([file], {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        }, 1, {
          onSplitFallback: fallbackSpy
        })
      }),
      [file]
    )

    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise

    expect(globalThis.fetch).toHaveBeenCalledTimes(5)
    expect(result.succeededCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(fallbackSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'started',
      frameCount: 2
    }))
    expect(fallbackSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
      frameCount: 2
    }))
  })

  it('does not retry non-retryable 400 responses', async () => {
    const file = createDicomFile()

    globalThis.fetch = vi.fn()
      .mockResolvedValue(new Response('invalid dataset', { status: 400, statusText: 'Bad Request' })) as typeof fetch

    const result = await runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([file], {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        }, 1)
      }),
      [file]
    )

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(result.failedCount).toBe(1)
    expect(result.failed[0]?.failureKind).toBe('http')
    expect(result.failed[0]?.attempts).toBe(1)
  })

  it('continues sending remaining files when one file fails', async () => {
    const failingFile = createDicomFile({ id: 'file-fail', fileName: 'fail.dcm' })
    const successfulFile = createDicomFile({ id: 'file-pass', fileName: 'pass.dcm' })

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('invalid dataset', { status: 400, statusText: 'Bad Request' }))
      .mockResolvedValueOnce(new Response('', { status: 200 })) as typeof fetch

    const result = await runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([failingFile, successfulFile], {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        }, 1)
      }),
      [failingFile, successfulFile]
    )

    expect(result.succeededCount).toBe(1)
    expect(result.failedCount).toBe(1)
    expect(result.succeeded[0]?.fileName).toBe('pass.dcm')
    expect(result.failed[0]?.fileName).toBe('fail.dcm')
  })

  it('treats STOW success bodies with failed SOP sequences as failed sends', async () => {
    const file = createDicomFile()

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{
        '00081198': {
          vr: 'SQ',
          Value: [
            {
              '00081155': { vr: 'UI', Value: [file.metadata?.sopInstanceUID] },
              '00081197': { vr: 'US', Value: [43265] }
            }
          ]
        }
      }]), { status: 200 })
    ) as typeof fetch

    const result = await runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([file], {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        }, 1)
      }),
      [file]
    )

    expect(result.succeededCount).toBe(0)
    expect(result.failedCount).toBe(1)
    expect(result.failed[0]?.failureKind).toBe('server-reported')
  })

  it('captures STOW warning sequences on otherwise successful sends', async () => {
    const file = createDicomFile()

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{
        '00081199': {
          vr: 'SQ',
          Value: [
            {
              '00081155': { vr: 'UI', Value: [file.metadata?.sopInstanceUID] },
              '00081196': { vr: 'US', Value: [45056] }
            }
          ]
        }
      }]), { status: 202 })
    ) as typeof fetch

    const result = await runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([file], {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        }, 1)
      }),
      [file]
    )

    expect(result.succeededCount).toBe(1)
    expect(result.warningCount).toBe(1)
    expect(result.succeeded[0]?.warnings).toHaveLength(1)
  })

  it('does not treat a normal referenced SOP sequence as a warning', async () => {
    const file = createDicomFile()

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{
        '00081199': {
          vr: 'SQ',
          Value: [
            {
              '00081155': { vr: 'UI', Value: [file.metadata?.sopInstanceUID] }
            }
          ]
        }
      }]), { status: 200 })
    ) as typeof fetch

    const result = await runSendFiles(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFiles([file], {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        }, 1)
      }),
      [file]
    )

    expect(result.succeededCount).toBe(1)
    expect(result.warningCount).toBe(0)
    expect(result.succeeded[0]?.warnings).toHaveLength(0)
  })

  it('returns structured success details from sendFile', async () => {
    const file = createDicomFile()

    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 })) as typeof fetch

    const result = await runSendFile(
      Effect.gen(function* () {
        const sender = yield* DicomSender
        return yield* sender.sendFile(file, {
          url: 'http://localhost:8042',
          timeout: 100,
          description: 'Test Server'
        })
      })
    )

    expect(result.fileName).toBe(file.fileName)
    expect(result.attempts).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })
})
