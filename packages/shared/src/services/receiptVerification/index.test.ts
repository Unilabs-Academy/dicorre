import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import {
  ReceiptVerificationPersistence,
  ReceiptVerificationService,
  ReceiptVerificationServiceLive,
  type ReceiptVerificationRecord,
} from './index'

const originalFetch = globalThis.fetch

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const dicomStudy = (
  studyInstanceUID: string,
  accessionNumber: string,
  patientId: string,
  instanceCount: number,
) => ({
  '0020000D': { vr: 'UI', Value: [studyInstanceUID] },
  '00080050': { vr: 'SH', Value: [accessionNumber] },
  '00100020': { vr: 'LO', Value: [patientId] },
  '00080061': { vr: 'CS', Value: ['MR'] },
  '00201208': { vr: 'IS', Value: [String(instanceCount)] },
})

const makePersistenceLayer = () => {
  let records = new Map<string, ReceiptVerificationRecord>()
  return Layer.succeed(
    ReceiptVerificationPersistence,
    ReceiptVerificationPersistence.of({
      load: Effect.sync(() => new Map(records)),
      save: (next) => Effect.sync(() => {
        records = new Map(next)
      }),
      clear: Effect.sync(() => {
        records = new Map()
      }),
    }),
  )
}

const runReceiptTest = <A>(effect: Effect.Effect<A, never, ReceiptVerificationService>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.provide(ReceiptVerificationServiceLive, makePersistenceLayer())),
    ),
  )

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('ReceiptVerificationService', () => {
  it('verifies a DICOMweb QIDO study by StudyInstanceUID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      dicomStudy('1.2.3', 'ACC-1', 'PAT-1', 3),
    ]))
    globalThis.fetch = fetchMock

    const record = await runReceiptTest(Effect.gen(function* () {
      const service = yield* ReceiptVerificationService
      return yield* service.verifyQuery({
        studyInstanceUID: '1.2.3',
        accessionNumber: 'ACC-1',
        patientId: 'PAT-1',
        expectedInstanceCount: 3,
      }, {
        provider: 'dicomweb-qido',
        url: 'http://receipt.test/dicom-web',
        requireInstanceCountMatch: true,
      })
    }))

    expect(record.state).toBe('verified')
    expect(record.backend).toMatchObject({ studyInstanceUID: '1.2.3', numberImages: 3 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/studies?StudyInstanceUID=1.2.3&includefield=all'),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('falls back to accession and patient search when direct QIDO lookup is empty', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([dicomStudy('1.2.3', 'ACC-1', 'PAT-1', 1)]))
    globalThis.fetch = fetchMock

    const record = await runReceiptTest(Effect.gen(function* () {
      const service = yield* ReceiptVerificationService
      return yield* service.verifyQuery({
        studyInstanceUID: '1.2.3',
        accessionNumber: 'ACC-1',
        patientId: 'PAT-1',
      }, {
        provider: 'orthanc-dicomweb',
        url: 'http://receipt.test/dicom-web',
      })
    }))

    expect(record.state).toBe('verified')
    expect(record.provider).toBe('dicomweb-qido')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('AccessionNumber=ACC-1')
    expect(fetchMock.mock.calls[1][0]).toContain('PatientID=PAT-1')
  })

  it('reports count mismatch when the backend image count differs from the expected count', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([
      dicomStudy('1.2.3', 'ACC-1', 'PAT-1', 2),
    ]))

    const record = await runReceiptTest(Effect.gen(function* () {
      const service = yield* ReceiptVerificationService
      return yield* service.verifyQuery({
        studyInstanceUID: '1.2.3',
        accessionNumber: 'ACC-1',
        patientId: 'PAT-1',
        expectedInstanceCount: 3,
      }, {
        provider: 'dicomweb-qido',
        url: 'http://receipt.test/dicom-web',
        requireInstanceCountMatch: true,
      })
    }))

    expect(record.state).toBe('count_mismatch')
    expect(record.message).toContain('2/3')
  })

  it('marks malformed DICOMweb JSON as a non-fatal verification error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ not: 'an array' }))

    const record = await runReceiptTest(Effect.gen(function* () {
      const service = yield* ReceiptVerificationService
      return yield* service.verifyQuery({
        studyInstanceUID: '1.2.3',
      }, {
        provider: 'dicomweb-qido',
        url: 'http://receipt.test/dicom-web',
      })
    }))

    expect(record.state).toBe('error')
    expect(record.message).toContain('not an array')
  })

  it('verifies PACScenter through study search and enriches image count from details', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        archive: 1,
        id: '1.2.3',
        accessionNumber: 'ACC-1',
        modality: 'MR',
        numberImages: 2,
        patient: { id: 'PAT-1' },
      }]))
      .mockResolvedValueOnce(jsonResponse({
        studies: [{
          id: '1.2.3',
          series: [{ numberImages: 1 }, { numberImages: 2 }],
        }],
      }))
    globalThis.fetch = fetchMock

    const record = await runReceiptTest(Effect.gen(function* () {
      const service = yield* ReceiptVerificationService
      return yield* service.verifyQuery({
        studyInstanceUID: '1.2.3',
        accessionNumber: 'ACC-1',
        patientId: 'PAT-1',
        expectedInstanceCount: 3,
      }, {
        provider: 'pacscenter',
        url: 'https://pacs.example',
        archive: 1,
        requireInstanceCountMatch: true,
      })
    }))

    expect(record.state).toBe('verified')
    expect(record.backend).toMatchObject({ studyInstanceUID: '1.2.3', numberImages: 3 })
    expect(fetchMock.mock.calls[0][0]).toBe('https://pacs.example/viewer/api/study/search')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      archives: [1],
      patientID: 'PAT-1',
      accessionNumber: 'ACC-1',
    })
    expect(fetchMock.mock.calls[1][0]).toBe('https://pacs.example/viewer/api/archive/1/patient/null/study/1.2.3/series/null')
  })
})
