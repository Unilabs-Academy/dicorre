import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'
import type { DicomStudy } from '@dicorre/shared/types/dicom'
import { NetworkError } from '@dicorre/shared/types/effects'
import { ReceiptVerificationPersistence } from './persistence'

export type ReceiptVerificationState =
  | 'not_started'
  | 'waiting'
  | 'verified'
  | 'not_found'
  | 'mismatch'
  | 'count_mismatch'
  | 'timeout'
  | 'error'

export type ReceiptVerifierProviderId = 'dicomweb-qido' | 'orthanc-dicomweb' | 'pacscenter'

export interface ReceiptVerificationSettings {
  readonly provider?: ReceiptVerifierProviderId
  readonly url?: string
  readonly archive?: number
  readonly headers?: Record<string, string>
  readonly auth?: { readonly type: 'basic' | 'bearer'; readonly credentials: string } | null
  readonly pollIntervalMs?: number
  readonly timeoutMs?: number
  readonly requireInstanceCountMatch?: boolean
}

export interface ReceiptVerificationQuery {
  readonly studyInstanceUID: string
  readonly accessionNumber?: string
  readonly patientId?: string
  readonly expectedInstanceCount?: number
}

export interface ReceiptVerificationProbe {
  readonly found: boolean
  readonly matchedBy?: 'studyInstanceUID' | 'accessionNumber' | 'patientId'
  readonly backendStudyInstanceUID?: string
  readonly accessionNumber?: string
  readonly patientId?: string
  readonly modality?: string
  readonly instanceCount?: number
  readonly rawSummary?: unknown
}

export interface ReceiptVerificationRecord {
  readonly studyInstanceUID: string
  readonly accessionNumber?: string
  readonly patientId?: string
  readonly expectedInstanceCount?: number
  readonly state: ReceiptVerificationState
  readonly provider?: ReceiptVerifierProviderId
  readonly startedAt?: string
  readonly checkedAt?: string
  readonly deadlineAt?: string
  readonly attempts: number
  readonly backend?: {
    readonly archive?: number
    readonly studyInstanceUID?: string
    readonly accessionNumber?: string
    readonly patientId?: string
    readonly modality?: string
    readonly numberImages?: number
  }
  readonly message?: string
  readonly nextCommand?: string
}

export interface ReceiptVerificationRunOptions {
  readonly wait?: boolean
  readonly timeoutMs?: number
  readonly pollIntervalMs?: number
  readonly nextCommand?: string
}

export class ReceiptVerificationService extends Context.Tag('ReceiptVerificationService')<
  ReceiptVerificationService,
  {
    readonly verifyStudy: (
      study: DicomStudy,
      settings: ReceiptVerificationSettings,
      options?: ReceiptVerificationRunOptions,
    ) => Effect.Effect<ReceiptVerificationRecord, never>
    readonly verifyQuery: (
      query: ReceiptVerificationQuery,
      settings: ReceiptVerificationSettings,
      options?: ReceiptVerificationRunOptions,
    ) => Effect.Effect<ReceiptVerificationRecord, never>
    readonly get: (studyInstanceUID: string) => Effect.Effect<ReceiptVerificationRecord | undefined, never>
    readonly getAll: Effect.Effect<Map<string, ReceiptVerificationRecord>, never>
    readonly clear: (studyInstanceUID: string) => Effect.Effect<void, never>
    readonly clearAll: Effect.Effect<void, never>
    readonly recordsChanges: Stream.Stream<Map<string, ReceiptVerificationRecord>>
  }
>() {}

const DEFAULT_POLL_INTERVAL_MS = 10_000
const DEFAULT_TIMEOUT_MS = 60_000

const countStudyFiles = (study: DicomStudy): number =>
  study.series.reduce((sum, series) => sum + series.files.length, 0)

const patientIdForStudy = (study: DicomStudy): string | undefined =>
  study.assignedPatientId || study.patientId

const nowIso = () => new Date().toISOString()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const headersFor = (settings: ReceiptVerificationSettings, accept = 'application/json'): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: accept,
    ...(settings.headers || {}),
  }
  if (settings.auth?.type === 'basic') headers.Authorization = `Basic ${settings.auth.credentials}`
  if (settings.auth?.type === 'bearer') headers.Authorization = `Bearer ${settings.auth.credentials}`
  return headers
}

const jsonFetch = async (url: string, init: RequestInit): Promise<unknown> => {
  const response = await fetch(url, init)
  const text = await response.text()
  let body: unknown = undefined
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    throw new NetworkError({
      message: `Receipt verification request failed: ${response.status} ${response.statusText}`,
      url,
      status: response.status,
      cause: typeof body === 'string' ? body.slice(0, 500) : body,
    })
  }
  return body
}

const firstDicomString = (dataset: Record<string, any> | undefined, tag: string): string | undefined => {
  const value = dataset?.[tag]?.Value?.[0]
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return undefined
}

const firstDicomNumber = (dataset: Record<string, any> | undefined, tag: string): number | undefined => {
  const value = firstDicomString(dataset, tag)
  const parsed = value === undefined ? NaN : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const normalizeUrl = (url: string): string => url.replace(/\/+$/, '')

const queryDicomweb = async (
  settings: ReceiptVerificationSettings,
  query: ReceiptVerificationQuery,
): Promise<ReceiptVerificationProbe> => {
  if (!settings.url) throw new Error('receipt-verifier requires url for dicomweb-qido provider')
  const base = normalizeUrl(settings.url)
  const accept = 'application/dicom+json, application/json'
  const urls = [
    `${base}/studies?StudyInstanceUID=${encodeURIComponent(query.studyInstanceUID)}&includefield=all`,
  ]
  if (query.accessionNumber || query.patientId) {
    const params = new URLSearchParams({ includefield: 'all' })
    if (query.accessionNumber) params.set('AccessionNumber', query.accessionNumber)
    if (query.patientId) params.set('PatientID', query.patientId)
    urls.push(`${base}/studies?${params.toString()}`)
  }

  for (const [index, url] of urls.entries()) {
    const body = await jsonFetch(url, { method: 'GET', headers: headersFor(settings, accept) })
    if (!Array.isArray(body)) throw new Error('DICOMweb QIDO response was not an array')
    if (!body.length) continue
    const match = body.find((item) => firstDicomString(item, '0020000D') === query.studyInstanceUID)
      || body.find((item) => query.accessionNumber && firstDicomString(item, '00080050') === query.accessionNumber)
      || body[0]
    return {
      found: true,
      matchedBy: index === 0 ? 'studyInstanceUID' : query.accessionNumber ? 'accessionNumber' : 'patientId',
      backendStudyInstanceUID: firstDicomString(match, '0020000D'),
      accessionNumber: firstDicomString(match, '00080050'),
      patientId: firstDicomString(match, '00100020'),
      modality: firstDicomString(match, '00080061'),
      instanceCount: firstDicomNumber(match, '00201208'),
      rawSummary: {
        resultCount: body.length,
      },
    }
  }

  return { found: false }
}

const pacscenterSearchBody = (
  settings: ReceiptVerificationSettings,
  query: ReceiptVerificationQuery,
): Record<string, unknown> => ({
  archives: [settings.archive ?? 1],
  date: 'none',
  specificDate: '',
  betweenFrom: '',
  betweenTo: '',
  patientID: query.patientId || '',
  patientName: '',
  patientGender: 'none',
  studyID: '',
  institution: '',
  accessionNumber: query.accessionNumber || '',
  modalities: [],
  priority: 'none',
  report: 'none',
  reviewed: 'none',
})

const queryPacscenter = async (
  settings: ReceiptVerificationSettings,
  query: ReceiptVerificationQuery,
): Promise<ReceiptVerificationProbe> => {
  if (!settings.url) throw new Error('receipt-verifier requires url for pacscenter provider')
  const base = normalizeUrl(settings.url)
  const search = await jsonFetch(`${base}/viewer/api/study/search`, {
    method: 'POST',
    headers: {
      ...headersFor(settings),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pacscenterSearchBody(settings, query)),
  })
  if (!Array.isArray(search)) throw new Error('PACScenter study search response was not an array')
  const match = search.find((item) => item?.id === query.studyInstanceUID)
    || search.find((item) => query.accessionNumber && item?.accessionNumber === query.accessionNumber)
    || search[0]
  if (!match) return { found: false }

  let instanceCount = Number.isFinite(Number(match.numberImages)) ? Number(match.numberImages) : undefined
  let rawSummary: unknown = { resultCount: search.length }
  if (match.id) {
    const archive = Number(match.archive || settings.archive || 1)
    const detail = await jsonFetch(`${base}/viewer/api/archive/${archive}/patient/null/study/${encodeURIComponent(match.id)}/series/null`, {
      method: 'GET',
      headers: headersFor(settings),
    }).catch(() => undefined)
    if (detail && typeof detail === 'object' && Array.isArray((detail as any).studies)) {
      const study = (detail as any).studies.find((item: any) => item.id === match.id) || (detail as any).studies[0]
      if (Array.isArray(study?.series)) {
        const summed = study.series.reduce((sum: number, series: any) => sum + Number(series.numberImages || 0), 0)
        if (Number.isFinite(summed) && summed > 0) instanceCount = summed
      }
      rawSummary = { resultCount: search.length, detailStudies: (detail as any).studies.length }
    }
  }

  return {
    found: true,
    matchedBy: match.id === query.studyInstanceUID ? 'studyInstanceUID' : query.accessionNumber ? 'accessionNumber' : 'patientId',
    backendStudyInstanceUID: match.id,
    accessionNumber: match.accessionNumber,
    patientId: match.patient?.id,
    modality: match.modality,
    instanceCount,
    rawSummary,
  }
}

const runProvider = (
  settings: ReceiptVerificationSettings,
  query: ReceiptVerificationQuery,
): Promise<ReceiptVerificationProbe> => {
  const provider = settings.provider || 'dicomweb-qido'
  if (provider === 'pacscenter') return queryPacscenter(settings, query)
  return queryDicomweb(settings, query)
}

const hasMismatch = (query: ReceiptVerificationQuery, probe: ReceiptVerificationProbe): boolean =>
  (!!probe.backendStudyInstanceUID && probe.backendStudyInstanceUID !== query.studyInstanceUID)
  || (!!query.accessionNumber && !!probe.accessionNumber && probe.accessionNumber !== query.accessionNumber)
  || (!!query.patientId && !!probe.patientId && probe.patientId !== query.patientId)

const toRecord = (
  query: ReceiptVerificationQuery,
  settings: ReceiptVerificationSettings,
  state: ReceiptVerificationState,
  attempts: number,
  deadlineAt: string,
  probe?: ReceiptVerificationProbe,
  message?: string,
  startedAt?: string,
  nextCommand?: string,
): ReceiptVerificationRecord => ({
  studyInstanceUID: query.studyInstanceUID,
  accessionNumber: query.accessionNumber,
  patientId: query.patientId,
  expectedInstanceCount: query.expectedInstanceCount,
  state,
  provider: settings.provider || 'dicomweb-qido',
  startedAt: startedAt || nowIso(),
  checkedAt: nowIso(),
  deadlineAt,
  attempts,
  backend: probe?.found ? {
    archive: settings.archive,
    studyInstanceUID: probe.backendStudyInstanceUID,
    accessionNumber: probe.accessionNumber,
    patientId: probe.patientId,
    modality: probe.modality,
    numberImages: probe.instanceCount,
  } : undefined,
  message,
  nextCommand,
})

const classifyProbe = (
  query: ReceiptVerificationQuery,
  settings: ReceiptVerificationSettings,
  probe: ReceiptVerificationProbe,
): { state: ReceiptVerificationState; message: string } => {
  if (!probe.found) return { state: 'not_found', message: 'Study was not found in the receipt backend' }
  if (hasMismatch(query, probe)) return { state: 'mismatch', message: 'Receipt backend returned a study with mismatched identifiers' }
  if (
    settings.requireInstanceCountMatch
    && query.expectedInstanceCount !== undefined
    && probe.instanceCount !== undefined
    && probe.instanceCount !== query.expectedInstanceCount
  ) {
    return { state: 'count_mismatch', message: `Receipt backend has ${probe.instanceCount}/${query.expectedInstanceCount} expected instances` }
  }
  return { state: 'verified', message: 'Study verified in receipt backend' }
}

export const ReceiptVerificationServiceLive = Layer.scoped(
  ReceiptVerificationService,
  Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make(new Map<string, ReceiptVerificationRecord>())
    const persistence = yield* ReceiptVerificationPersistence
    const persisted = yield* persistence.load
    if (persisted) yield* SubscriptionRef.set(ref, persisted)

    const saveRecord = (record: ReceiptVerificationRecord) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.update(ref, (records) => {
          const next = new Map(records)
          next.set(record.studyInstanceUID, record)
          return next
        })
        const updated = yield* SubscriptionRef.get(ref)
        yield* persistence.save(updated)
      })

    const verifyQuery = (
      query: ReceiptVerificationQuery,
      settingsArg: ReceiptVerificationSettings,
      options: ReceiptVerificationRunOptions = {},
    ) => Effect.gen(function* () {
      const settings: ReceiptVerificationSettings = {
        ...settingsArg,
        provider: settingsArg.provider === 'orthanc-dicomweb' ? 'dicomweb-qido' : settingsArg.provider,
      }
      const startedAt = nowIso()
      const timeoutMs = Math.max(0, options.timeoutMs ?? settings.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? settings.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
      const deadlineMs = Date.now() + timeoutMs
      const deadlineAt = new Date(deadlineMs).toISOString()
      let attempts = 0

      yield* saveRecord(toRecord(query, settings, 'waiting', attempts, deadlineAt, undefined, 'Waiting for receipt verification', startedAt, options.nextCommand))

      while (true) {
        attempts += 1
        const result = yield* Effect.tryPromise({
          try: () => runProvider(settings, query),
          catch: (cause) => cause,
        }).pipe(Effect.either)

        if (result._tag === 'Right') {
          const probe = result.right
          const classified = classifyProbe(query, settings, probe)
          const shouldKeepWaiting = options.wait === true && classified.state === 'not_found' && Date.now() < deadlineMs
          if (!shouldKeepWaiting) {
            const finalState = classified.state === 'not_found' && Date.now() >= deadlineMs ? 'timeout' : classified.state
            const finalMessage = finalState === 'timeout' ? 'Receipt verification timed out before the study was found' : classified.message
            const record = toRecord(query, settings, finalState, attempts, deadlineAt, probe, finalMessage, startedAt, options.nextCommand)
            yield* saveRecord(record)
            return record
          }
        } else {
          const message = result.left instanceof Error ? result.left.message : String(result.left)
          const shouldRetry = options.wait === true && Date.now() < deadlineMs
          if (!shouldRetry) {
            const record = toRecord(query, settings, 'error', attempts, deadlineAt, undefined, message, startedAt, options.nextCommand)
            yield* saveRecord(record)
            return record
          }
        }

        const waiting = toRecord(query, settings, 'waiting', attempts, deadlineAt, undefined, 'Waiting for receipt verification', startedAt, options.nextCommand)
        yield* saveRecord(waiting)
        yield* Effect.promise(() => sleep(Math.min(pollIntervalMs, Math.max(0, deadlineMs - Date.now()))))
      }
    })

    const verifyStudy = (
      study: DicomStudy,
      settings: ReceiptVerificationSettings,
      options?: ReceiptVerificationRunOptions,
    ) => verifyQuery({
      studyInstanceUID: study.studyInstanceUID,
      accessionNumber: study.accessionNumber,
      patientId: patientIdForStudy(study),
      expectedInstanceCount: countStudyFiles(study),
    }, settings, options)

    const get = (studyInstanceUID: string) =>
      Effect.map(SubscriptionRef.get(ref), (records) => records.get(studyInstanceUID))

    const clear = (studyInstanceUID: string) => Effect.gen(function* () {
      yield* SubscriptionRef.update(ref, (records) => {
        const next = new Map(records)
        next.delete(studyInstanceUID)
        return next
      })
      const updated = yield* SubscriptionRef.get(ref)
      yield* persistence.save(updated)
    })

    const clearAll = Effect.gen(function* () {
      yield* SubscriptionRef.set(ref, new Map())
      yield* persistence.clear
    })

    return {
      verifyStudy,
      verifyQuery,
      get,
      getAll: SubscriptionRef.get(ref),
      clear,
      clearAll,
      recordsChanges: ref.changes,
    } as const
  }),
)

export { ReceiptVerificationPersistence }
