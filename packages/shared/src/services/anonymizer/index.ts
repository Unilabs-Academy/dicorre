import { Effect, Context, Layer } from 'effect'
import {
  DicomDeidentifier,
  BasicProfile,
  CleanDescOption,
  CleanGraphOption,
  RetainLongModifDatesOption,
  RetainLongFullDatesOption,
  RetainUIDsOption,
  RetainPatientCharsOption,
  RetainSafePrivateOption,
  RetainDeviceIdentOption,
  RetainInstIdentOption,
  CleanStructContOption,
  type DeidentifyOptions,
  type ProfileOption,
} from '@umessen/dicom-deidentifier'
import * as dcmjs from 'dcmjs'
import type { DicomFile } from '@dicorre/shared/types/dicom'
import { DicomProcessor } from '../dicomProcessor'
import type { AnonymizationConfig } from '../config/schema'
import {
  createValueReplacementCache,
  getAllSpecialHandlers,
  getAllSpecialHandlersWithOverrides,
  type ValueReplacementCache,
} from './handlers'
import { getDicomReferenceDate, getDicomReferenceTime } from './dicomHelpers'
import { AnonymizationError, type AnonymizerError } from '@dicorre/shared/types/effects'
import { tag } from '@dicorre/shared/utils/dicom-tag-dictionary'

export { createValueReplacementCache } from './handlers'

/**
 * Max lengths for string-based DICOM VRs (per DICOM PS3.5).
 * Only includes string VRs where dcmjs will throw on write if exceeded.
 */
const STRING_VR_MAX_LENGTHS: Record<string, number> = {
  AE: 16, // Application Entity
  AS: 4, // Age String
  CS: 16, // Code String
  DA: 8, // Date
  DS: 16, // Decimal String
  DT: 26, // Date Time
  IS: 12, // Integer String
  TM: 16, // Time
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/**
 * Sanitize DICOM data by truncating string VR values that exceed their
 * max length per the DICOM standard. Some scanners produce non-conformant
 * data (e.g. CS values > 16 chars) which causes dcmjs to throw during write.
 *
 * This reads the DICOM, fixes offending values in the dict, and writes it
 * back so the deidentifier receives conformant data.
 */
function sanitizeDicomVRLengths(uint8Array: Uint8Array): Uint8Array {
  const dicomData = dcmjs.data.DicomMessage.readFile(toArrayBuffer(uint8Array)) as any
  const dict = dicomData.dict as Record<string, { vr?: string; Value?: any[] }>

  let modified = false

  for (const [_tag, element] of Object.entries(dict)) {
    const vr = element?.vr
    if (!vr || !element.Value || !Array.isArray(element.Value)) continue

    const maxLen = STRING_VR_MAX_LENGTHS[vr]
    if (!maxLen) continue

    for (let i = 0; i < element.Value.length; i++) {
      const val = element.Value[i]
      if (typeof val === 'string' && val.length > maxLen) {
        console.warn(
          `Truncating non-conformant DICOM value: tag=${_tag}, vr=${vr}, ` +
            `value="${val}" (${val.length} chars > max ${maxLen})`,
        )
        element.Value[i] = val.slice(0, maxLen)
        modified = true
      }
    }
  }

  if (!modified) return uint8Array

  // Write back with allowInvalidVRLength as a safety net in case
  // there are other edge cases we didn't catch above
  const buffer = dicomData.write({ allowInvalidVRLength: true })
  return new Uint8Array(buffer)
}

function ensurePatientIdTag(uint8Array: Uint8Array, patientId?: string): Uint8Array {
  if (!patientId) return uint8Array

  const arrayBuffer = toArrayBuffer(uint8Array)
  const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer) as any
  const dict = dicomData.dict as Record<string, { vr?: string; Value?: any[] }>
  const patientIdTag = tag('Patient ID')
  const existingPatientId = dict[patientIdTag]?.Value?.[0]

  if (existingPatientId) return uint8Array

  dict[patientIdTag] = {
    vr: 'LO',
    Value: [patientId],
  }

  const buffer = dicomData.write({ allowInvalidVRLength: true })
  return new Uint8Array(buffer)
}

export interface AnonymizationProgress {
  total: number
  completed: number
  percentage: number
  currentFile?: string
}

export interface StudyAnonymizationResult {
  studyId: string
  anonymizedFiles: DicomFile[]
  totalFiles: number
  completedFiles: number
}

export interface StudyAnonymizationContext {
  studyId: string
  config: AnonymizationConfig
  sharedRandom: string
  runId: string
  valueCache: ValueReplacementCache
  patientIdMap?: Record<string, string>
  overrides?: Record<string, string>
}

export interface StudyAnonymizationOptions {
  concurrency?: number
  onProgress?: (progress: AnonymizationProgress) => void
  patientIdMap?: Record<string, string>
  overrides?: Record<string, string>
}

export class Anonymizer extends Context.Tag('Anonymizer')<
  Anonymizer,
  {
    readonly createStudyContext: (
      studyId: string,
      config: AnonymizationConfig,
      options?: Pick<StudyAnonymizationOptions, 'patientIdMap' | 'overrides'>,
    ) => StudyAnonymizationContext
    readonly anonymizeFile: (
      file: DicomFile,
      config: AnonymizationConfig,
      sharedRandom?: string,
      patientIdMap?: Record<string, string>,
      overrides?: Record<string, string>,
      runId?: string,
      valueCache?: ValueReplacementCache,
    ) => Effect.Effect<DicomFile, AnonymizerError>
    readonly anonymizeFileInStudyContext: (
      file: DicomFile,
      context: StudyAnonymizationContext,
    ) => Effect.Effect<DicomFile, AnonymizerError>
    readonly anonymizeStudy: (
      studyId: string,
      files: DicomFile[],
      config: AnonymizationConfig,
      options?: StudyAnonymizationOptions,
    ) => Effect.Effect<StudyAnonymizationResult, AnonymizerError>
  }
>() {}

export const AnonymizerLive = Layer.effect(
  Anonymizer,
  Effect.gen(function* () {
    const dicomProcessor = yield* DicomProcessor

    const generateRandomString = (): string => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      let result = ''
      for (let i = 0; i < 7; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return result
    }

    const generateRunId = (): string =>
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const processReplacements = (
      replacements: Record<string, string>,
      sharedRandom?: string,
    ): Record<string, string> => {
      const processed: Record<string, string> = {}
      const randomString = sharedRandom || generateRandomString()

      for (const [key, value] of Object.entries(replacements)) {
        // Convert tag names to hex using the tag() helper, leave other keys as-is
        const processedKey = key === 'default' ? key : tag(key)
        processed[processedKey] = value.replace('{random}', randomString)
      }

      return processed
    }

    const createStudyContext = (
      studyId: string,
      config: AnonymizationConfig,
      options: Pick<StudyAnonymizationOptions, 'patientIdMap' | 'overrides'> = {},
    ): StudyAnonymizationContext => {
      const sharedRandom = generateRandomString()
      const runId = generateRunId()
      console.log(`[Effect Anonymizer] Using anonymization run ${runId} for study ${studyId}`)

      return {
        studyId,
        config,
        sharedRandom,
        runId,
        valueCache: createValueReplacementCache(),
        patientIdMap: options.patientIdMap,
        overrides: options.overrides,
      }
    }

    const anonymizeFile = (
      file: DicomFile,
      config: AnonymizationConfig,
      sharedRandom?: string,
      patientIdMap?: Record<string, string>,
      overrides?: Record<string, string>,
      runId: string = generateRunId(),
      valueCache: ValueReplacementCache = createValueReplacementCache(),
    ): Effect.Effect<DicomFile, AnonymizerError> =>
      Effect.gen(function* () {
        // Check if file has metadata
        if (!file.metadata) {
          return yield* Effect.fail(
            new AnonymizationError({
              message: `File ${file.fileName} has no metadata - cannot anonymize`,
              fileName: file.fileName,
            }),
          )
        }

        console.log(`Starting anonymization of file: ${file.fileName}`)

        // Process replacements with optional shared random string
        console.log('Processing replacements from config:', config.replacements)
        const processedReplacements = processReplacements(config.replacements || {}, sharedRandom)
        console.log('Processed replacements result:', processedReplacements)

        // If a patientIdMap is provided and the file has an original patientId, override the Patient ID replacement
        const originalPatientId = file.metadata?.patientId
        if (patientIdMap && originalPatientId) {
          const assignedId = patientIdMap[originalPatientId]
          if (assignedId) {
            processedReplacements[tag('Patient ID')] = assignedId
            console.log(
              `Overriding Patient ID replacement using mapping for ${file.fileName}: ${originalPatientId} -> ${assignedId}`,
            )
          }
        }

        // Apply per-study overrides last (highest precedence). Values used as-is (no {random} processing).
        if (overrides) {
          for (const [key, value] of Object.entries(overrides)) {
            processedReplacements[tag(key)] = value
          }
        }

        // Map string profile options to actual profile objects
        const uidStrategy = config.uidStrategy ?? 'perRun'
        const enforceUidStrategy = uidStrategy === 'perRun' || uidStrategy === 'deterministic'
        const requestedProfileOptions = config.profileOptions || ['BasicProfile']
        const filteredProfileOptions = enforceUidStrategy
          ? requestedProfileOptions.filter((option) => option !== 'RetainUIDsOption')
          : requestedProfileOptions
        const effectiveProfileOptions =
          filteredProfileOptions.length > 0 ? filteredProfileOptions : ['BasicProfile']

        if (enforceUidStrategy && requestedProfileOptions.includes('RetainUIDsOption')) {
          console.warn(
            `Ignoring RetainUIDsOption because UID Strategy is ${uidStrategy}; generated UID policy takes precedence.`,
          )
        }

        const profileOptions: ProfileOption[] = effectiveProfileOptions.map(
          (option) => {
            switch (option) {
              case 'BasicProfile':
                return BasicProfile
              case 'RetainLongModifDatesOption':
                return RetainLongModifDatesOption
              case 'RetainLongFullDatesOption':
                return RetainLongFullDatesOption
              case 'RetainUIDsOption':
                return RetainUIDsOption
              case 'CleanGraphOption':
                return CleanGraphOption
              case 'RetainPatientCharsOption':
                return RetainPatientCharsOption
              case 'RetainSafePrivateOption':
                return RetainSafePrivateOption
              case 'CleanDescOption':
                return CleanDescOption
              case 'RetainDeviceIdentOption':
                return RetainDeviceIdentOption
              case 'RetainInstIdentOption':
                return RetainInstIdentOption
              case 'CleanStructContOption':
                return CleanStructContOption
              default:
                return BasicProfile
            }
          },
        )

        // Keep only configured preserveTags; do not force-keep overrides so they can be replaced
        const coreUidTags = new Set([
          tag('Study Instance UID'),
          tag('Series Instance UID'),
          tag('SOP Instance UID'),
        ])
        const configuredKeep = (config.preserveTags ? [...config.preserveTags] : [])
          .map((k) => tag(k))
          .filter((k) => !enforceUidStrategy || !coreUidTags.has(k))
        const keep = Array.from(new Set(configuredKeep || []))

        // Configure deidentifier options
        const deidentifierConfig: DeidentifyOptions = {
          profileOptions,
          dummies: {
            default: processedReplacements.default || 'REMOVED',
            lookup: processedReplacements,
          },
          keep: keep.length > 0 ? keep : undefined,
          getReferenceDate: getDicomReferenceDate,
          getReferenceTime: getDicomReferenceTime,
        }

        // Add special handlers. Core UID handlers are always installed so
        // uidStrategy cannot be bypassed by profile or custom-handler settings.
        if (config.useCustomHandlers || enforceUidStrategy || (overrides && Object.keys(overrides).length > 0)) {
          const tagsToRemove = config.tagsToRemove ? [...config.tagsToRemove] : []
          const originalStudyId = file.metadata?.studyInstanceUID || 'unknown'
          const uidScopeKey =
            uidStrategy === 'perRun'
              ? `${originalStudyId}:${runId}`
              : originalStudyId
          const handlerOptions = {
            disablePatientId: !!patientIdMap,
            uidScopeKey,
            uidStrategy,
            organizationRoot: config.organizationRoot,
            valueCache,
            uidsOnly: !config.useCustomHandlers,
          }
          // If a patientIdMap is provided, disable PatientID generation in handlers to prevent conflicts
          const specialHandlers =
            overrides && Object.keys(overrides).length > 0
              ? getAllSpecialHandlersWithOverrides(
                  config.dateJitterDays || 31,
                  config.useCustomHandlers ? tagsToRemove : [],
                  originalStudyId,
                  handlerOptions,
                  overrides,
                )
              : getAllSpecialHandlers(
                  config.dateJitterDays || 31,
                  config.useCustomHandlers ? tagsToRemove : [],
                  originalStudyId,
                  handlerOptions,
                )
          deidentifierConfig.specialHandlers = specialHandlers
        }

        // Create deidentifier instance
        const deidentifier = yield* Effect.try({
          try: () => {
            const instance = new DicomDeidentifier(deidentifierConfig)
            console.log(
              `Created deidentifier for ${file.fileName} with ${config.useCustomHandlers ? 'custom' : 'standard'} handlers`,
            )
            return instance
          },
          catch: (error) =>
            new AnonymizationError({
              message: `Cannot create anonymizer: ${error}`,
              fileName: file.fileName,
              cause: error,
            }),
        })

        // Convert ArrayBuffer to Uint8Array for the deidentifier
        const rawUint8Array = new Uint8Array(file.arrayBuffer)
        console.log(`Converted to Uint8Array for ${file.fileName}, size: ${rawUint8Array.length}`)

        // Sanitize non-conformant VR values before deidentification
        let uint8Array: Uint8Array
        try {
          uint8Array = sanitizeDicomVRLengths(rawUint8Array)
        } catch (sanitizeError: any) {
          console.warn(`VR sanitization skipped for ${file.fileName}: ${sanitizeError.message}`)
          uint8Array = rawUint8Array
        }

        // Anonymize the DICOM file
        const anonymizedUint8Array = yield* Effect.try({
          try: () => {
            const result = deidentifier.deidentify(uint8Array)
            console.log(
              `Deidentified ${file.fileName} using library, result size: ${result.length}`,
            )
            return ensurePatientIdTag(result, processedReplacements[tag('Patient ID')])
          },
          catch: (error: any) => {
            console.error(`Library deidentification failed:`, error)
            console.error(`Error stack:`, error.stack)

            // Try to provide more context about the error
            if (error.message?.includes('Cannot read properties of undefined')) {
              console.error(
                `This might be due to malformed DICOM tags or unsupported private tags in ${file.fileName}`,
              )
              console.error(
                `Consider enabling removePrivateTags option or checking the DICOM file structure`,
              )
            }

            return new AnonymizationError({
              message: `Cannot anonymize file ${file.fileName}: ${error.message || error}`,
              fileName: file.fileName,
              cause: error,
            })
          },
        })

        // Convert back to ArrayBuffer
        const anonymizedArrayBuffer = toArrayBuffer(anonymizedUint8Array)

        // Create anonymized file with new data
        const anonymizedFile: DicomFile = {
          ...file,
          arrayBuffer: anonymizedArrayBuffer,
          anonymized: true,
        }

        // Re-parse the anonymized file
        const finalFile = yield* dicomProcessor.parseFile(anonymizedFile)
        console.log(`Successfully anonymized ${file.fileName}`)
        return finalFile
      })

    const anonymizeFileInStudyContext = (
      file: DicomFile,
      context: StudyAnonymizationContext,
    ): Effect.Effect<DicomFile, AnonymizerError> =>
      anonymizeFile(
        file,
        context.config,
        context.sharedRandom,
        context.patientIdMap,
        context.overrides,
        context.runId,
        context.valueCache,
      )

    const anonymizeStudy = (
      studyId: string,
      files: DicomFile[],
      config: AnonymizationConfig,
      options: StudyAnonymizationOptions = {},
    ): Effect.Effect<StudyAnonymizationResult, AnonymizerError> =>
      Effect.gen(function* () {
        const { concurrency = 3, onProgress } = options

        console.log(
          `[Effect Anonymizer] Starting anonymization of study ${studyId} with ${files.length} files`,
        )

        const context = createStudyContext(studyId, config, {
          patientIdMap: options.patientIdMap,
          overrides: options.overrides,
        })

        let completed = 0
        const total = files.length

        // Create individual effects with progress tracking
        const effectsWithProgress = files.map((file, index) =>
          Effect.gen(function* () {
            // Send progress update before processing
            if (onProgress) {
              onProgress({
                total,
                completed,
                percentage: Math.round((completed / total) * 100),
                currentFile: file.fileName,
              })
            }

            console.log(`[Effect Anonymizer] Starting file ${index + 1}/${total}: ${file.fileName}`)

            const result = yield* anonymizeFileInStudyContext(file, context)

            completed++

            // Send progress update after completion
            if (onProgress) {
              onProgress({
                total,
                completed,
                percentage: Math.round((completed / total) * 100),
                currentFile: file.fileName,
              })
            }

            console.log(
              `[Effect Anonymizer] Completed file ${index + 1}/${total}: ${file.fileName}`,
            )
            return result
          }),
        )

        // Run all effects concurrently with specified concurrency
        const anonymizedFiles = yield* Effect.all(effectsWithProgress, {
          concurrency,
          batching: true,
        })

        console.log(
          `[Effect Anonymizer] Study ${studyId} anonymization completed: ${anonymizedFiles.length} files processed`,
        )

        return {
          studyId,
          anonymizedFiles,
          totalFiles: total,
          completedFiles: anonymizedFiles.length,
        }
      })

    return {
      createStudyContext,
      anonymizeFile,
      anonymizeFileInStudyContext,
      anonymizeStudy,
    } as const
  }),
)
