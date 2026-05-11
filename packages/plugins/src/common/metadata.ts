import type { DicomMetadata } from '@dicorre/shared/types/dicom'

const fallbackRandomUuid = (): string =>
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (char) =>
    (Number(char) ^ (Math.random() * 16 >> (Number(char) / 4))).toString(16),
  )

export const generateDicomUid = (): string => {
  const uuid = (globalThis.crypto?.randomUUID?.() ?? fallbackRandomUuid()).replace(/-/g, '')
  return `2.25.${BigInt(`0x${uuid}`).toString()}`
}

export const truncateDicomLo = (value: string): string =>
  value.length <= 64 ? value : value.slice(0, 64)

export const createDefaultConversionMetadata = (
  fileName: string,
  overrides: Partial<DicomMetadata> = {},
): DicomMetadata => ({
  patientName: 'Converted^File',
  patientId: `CONV-${Date.now()}`,
  studyInstanceUID: generateDicomUid(),
  seriesInstanceUID: generateDicomUid(),
  sopInstanceUID: generateDicomUid(),
  studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  modality: 'SC',
  studyDescription: truncateDicomLo(fileName),
  seriesDescription: 'File Conversion',
  instanceNumber: 1,
  transferSyntaxUID: '1.2.840.10008.1.2.1',
  ...overrides,
})

export const fileId = (prefix: string, index?: number): string =>
  `${prefix}-${Date.now()}${index === undefined ? '' : `-${index}`}-${Math.random().toString(36).slice(2, 11)}`
