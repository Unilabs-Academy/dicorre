import { Effect, Context, Layer } from "effect"
import * as dcmjs from 'dcmjs'
import type { DicomFile, DicomMetadata, DicomStudy } from '@/types/dicom'
import { ParseError, ValidationError, type DicomProcessorError } from '@/types/effects'
import { tag } from '@/utils/dicom-tag-dictionary'

export class DicomProcessor extends Context.Tag("DicomProcessor")<
  DicomProcessor,
  {
    readonly parseFile: (file: DicomFile) => Effect.Effect<DicomFile, DicomProcessorError>
    readonly parseFiles: (files: DicomFile[], concurrency?: number, options?: { onProgress?: (completed: number, total: number, currentFile?: DicomFile) => void }) => Effect.Effect<DicomFile[], DicomProcessorError>
    readonly groupFilesByStudy: (files: DicomFile[]) => Effect.Effect<DicomStudy[], DicomProcessorError>
    readonly assignPatientIds: (studies: DicomStudy[], anonymizationConfig: { replacements?: Record<string, string> }) => Effect.Effect<DicomStudy[], never>
    readonly validateFile: (file: DicomFile) => Effect.Effect<void, ValidationError>
  }
>() { }

export const DicomProcessorLive = Layer.succeed(
  DicomProcessor,
  (() => {
    const validateFile = (file: DicomFile): Effect.Effect<void, ValidationError> =>
      Effect.gen(function* () {
        if (!file.arrayBuffer || file.arrayBuffer.byteLength === 0) {
          return yield* Effect.fail(new ValidationError({
            message: `File ${file.fileName} has no data`,
            fileName: file.fileName
          }))
        }

        if (file.arrayBuffer.byteLength < 132) {
          return yield* Effect.fail(new ValidationError({
            message: `File ${file.fileName} is too small to be a valid DICOM file`,
            fileName: file.fileName
          }))
        }

        // Verify DICOM magic number
        const view = new DataView(file.arrayBuffer)
        try {
          const magic = String.fromCharCode(
            view.getUint8(128),
            view.getUint8(129),
            view.getUint8(130),
            view.getUint8(131)
          )

          if (magic !== 'DICM') {
            return yield* Effect.fail(new ValidationError({
              message: `File ${file.fileName} does not have valid DICOM magic number`,
              fileName: file.fileName
            }))
          }
        } catch (error) {
          return yield* Effect.fail(new ValidationError({
            message: `Error reading DICOM magic number in ${file.fileName} - ${error}`,
            fileName: file.fileName,
          }))
        }
      })

    const parseFile = (file: DicomFile): Effect.Effect<DicomFile, DicomProcessorError> =>
      Effect.gen(function* () {
        yield* validateFile(file)

        const result = yield* Effect.try({
          try: () => {
            console.log(`Parsing DICOM file: ${file.fileName}`)

            const dataset = dcmjs.data.DicomMessage.readFile(file.arrayBuffer)
            const dict = dataset.dict

            const metadata: DicomMetadata = {
              accessionNumber: dict[tag('Accession Number')]?.Value?.[0] || '',
              patientName: dict[tag("Patient's Name")]?.Value?.[0] || 'Unknown',
              patientId: dict[tag('Patient ID')]?.Value?.[0] || 'Unknown',
              patientBirthDate: dict[tag("Patient's Birth Date")]?.Value?.[0] || '',
              patientAge: dict[tag("Patient's Age")]?.Value?.[0] || '',
              patientSex: dict[tag("Patient's Sex")]?.Value?.[0] || '',
              patientWeight: dict[tag("Patient's Weight")]?.Value?.[0] || 0,
              patientHeight: dict[tag("Patient's Size")]?.Value?.[0] || 0,
              studyInstanceUID: dict[tag('Study Instance UID')]?.Value?.[0] || '',
              studyDate: dict[tag('Study Date')]?.Value?.[0] || '',
              studyDescription: dict[tag('Study Description')]?.Value?.[0] || '',
              seriesInstanceUID: dict[tag('Series Instance UID')]?.Value?.[0] || '',
              seriesDescription: dict[tag('Series Description')]?.Value?.[0] || '',
              modality: dict[tag('Modality')]?.Value?.[0] || 'Unknown',
              sopInstanceUID: dict[tag('SOP Instance UID')]?.Value?.[0] || '',
              instanceNumber: dict[tag('Instance Number')]?.Value?.[0] || 1,
              transferSyntaxUID: dict[tag('Transfer Syntax UID')]?.Value?.[0] || '1.2.840.10008.1.2'
            }

            console.log(`Successfully parsed ${file.fileName}: Patient ${metadata.patientId}, Study ${metadata.accessionNumber}`)

            return {
              ...file,
              metadata,
              parsed: true
            }
          },
          catch: (error) => new ParseError({
            message: `Failed to parse DICOM file: ${file.fileName}`,
            fileName: file.fileName,
            cause: error
          })
        })

        return result
      })

    const parseFiles = (
      files: DicomFile[],
      concurrency = 3,
      options?: { onProgress?: (completed: number, total: number, currentFile?: DicomFile) => void }
    ): Effect.Effect<DicomFile[], DicomProcessorError> =>
      Effect.gen(function* () {
        if (files.length === 0) {
          return []
        }

        console.log(`Starting to parse ${files.length} DICOM files with concurrency ${concurrency}`)

        let completed = 0
        const total = files.length

        // Create parsing effects with progress tracking
        const parsingEffects = files.map(file =>
          parseFile(file).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.sync(() => {
                  completed++
                  options?.onProgress?.(completed, total, file)
                  console.warn(`Skipping unparseable DICOM file ${file.fileName}:`, error)
                  return undefined
                }),
              onSuccess: (parsedFile) =>
                Effect.sync(() => {
                  completed++
                  options?.onProgress?.(completed, total, parsedFile)
                  return parsedFile
                })
            })
          )
        )

        const results = yield* Effect.all(parsingEffects, { concurrency, batching: true })

        const successfulResults = results.filter((file): file is DicomFile => !!file?.parsed)
        console.log(`Successfully parsed ${successfulResults.length}/${files.length} DICOM files`)

        return successfulResults
      })

    const groupFilesByStudy = (files: DicomFile[]): Effect.Effect<DicomStudy[], DicomProcessorError> =>
      Effect.sync(() => {
        const studyMap = new Map<string, DicomStudy>()

        for (const file of files) {
          if (!file.metadata) {
            console.warn(`File ${file.fileName} has no metadata, skipping`)
            continue
          }

          const {
            accessionNumber,
            patientId,
            patientName,
            studyInstanceUID,
            studyDate,
            studyDescription,
            seriesInstanceUID,
            seriesDescription,
            modality
          } = file.metadata

          const studyKey = `${patientId}|${studyInstanceUID}`

          if (!studyMap.has(studyKey)) {
            studyMap.set(studyKey, {
              id: '', // assigned after files are collected
              accessionNumber: accessionNumber || '',
              studyInstanceUID: studyInstanceUID || '',
              patientName: patientName || 'Unknown',
              patientId: patientId || 'Unknown',
              studyDate: studyDate || '',
              studyDescription: studyDescription || 'Unknown Study',
              series: []
            })
          }

          const study = studyMap.get(studyKey)!

          let series = study.series.find(s => s.seriesInstanceUID === seriesInstanceUID)
          if (!series) {
            series = {
              seriesInstanceUID: seriesInstanceUID || '',
              seriesDescription: seriesDescription || 'Unknown Series',
              modality: modality || 'Unknown',
              files: []
            }
            study.series.push(series)
          }

          series.files.push(file)
        }

        // Assign deterministic stable id per study based on smallest file id
        for (const study of studyMap.values()) {
          const allIds = study.series.flatMap(s => s.files.map(f => f.id)).sort()
          study.id = allIds[0] || ''
        }

        // Convert map to array and sort
        const studies = Array.from(studyMap.values())

        // Sort studies by patient ID and study date
        studies.sort((a, b) => {
          const patientCompare = a.patientId?.localeCompare(b.patientId || '') || 0
          if (patientCompare !== 0) return patientCompare
          return a.studyDate?.localeCompare(b.studyDate || '') || 0
        })

        // Sort series within each study
        studies.forEach(study => {
          study.series.sort((a, b) => a.seriesInstanceUID.localeCompare(b.seriesInstanceUID))
        })

        return studies
      })

    const assignPatientIds = (studies: DicomStudy[], anonymizationConfig: { replacements?: Record<string, string> }): Effect.Effect<DicomStudy[], never> =>
      Effect.sync(() => {
        const pattern = anonymizationConfig.replacements?.['Patient ID'] || anonymizationConfig.replacements?.[tag('Patient ID')] || 'PAT{random}'

        const generateRandomString = (): string => {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
          let result = ''
          for (let i = 0; i < 7; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length))
          }
          return result
        }

        const originalToAssigned = new Map<string, string>()

        const updated = studies.map(study => {
          const original = study.patientId || 'Unknown'
          // Respect existing assignedPatientId if set (pre-grouped)
          if (study.assignedPatientId) {
            originalToAssigned.set(original, study.assignedPatientId)
          } else if (!originalToAssigned.has(original)) {
            const assigned = pattern.replace('{random}', generateRandomString())
            originalToAssigned.set(original, assigned)
          }
          const assignedPatientId = originalToAssigned.get(original)!
          return { ...study, assignedPatientId }
        })

        return updated
      })

    return {
      parseFile,
      parseFiles,
      groupFilesByStudy,
      assignPatientIds,
      validateFile
    } as const
  })()
)
