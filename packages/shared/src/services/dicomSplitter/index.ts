import { Effect } from 'effect'
import * as dcmjs from 'dcmjs'
import type { DicomFile } from '@dicorre/shared/types/dicom'

const MULTIFRAME_TRUE_COLOR_SC_UID = '1.2.840.10008.5.1.4.1.1.7.4'
const SECONDARY_CAPTURE_IMAGE_STORAGE_UID = '1.2.840.10008.5.1.4.1.1.7'
const IMPLICIT_VR_LITTLE_ENDIAN_UID = '1.2.840.10008.1.2'
const EXPLICIT_VR_LITTLE_ENDIAN_UID = '1.2.840.10008.1.2.1'
const SUPPORTED_TRANSFER_SYNTAXES = new Set([
  IMPLICIT_VR_LITTLE_ENDIAN_UID,
  EXPLICIT_VR_LITTLE_ENDIAN_UID
])

const TAGS = {
  sopClassUID: '00080016',
  sopInstanceUID: '00080018',
  imageType: '00080008',
  derivationDescription: '00082111',
  sourceImageSequence: '00082112',
  referencedSOPClassUID: '00081150',
  referencedSOPInstanceUID: '00081155',
  seriesInstanceUID: '0020000E',
  instanceNumber: '00200013',
  imagesInAcquisition: '00201002',
  samplesPerPixel: '00280002',
  photometricInterpretation: '00280004',
  planarConfiguration: '00280006',
  numberOfFrames: '00280008',
  rows: '00280010',
  columns: '00280011',
  bitsAllocated: '00280100',
  bitsStored: '00280101',
  highBit: '00280102',
  pixelRepresentation: '00280103',
  pixelData: '7FE00010',
  mediaStorageSOPClassUID: '00020002',
  mediaStorageSOPInstanceUID: '00020003',
  transferSyntaxUID: '00020010'
} as const

const MULTIFRAME_ONLY_TAGS = new Set([
  '00280008', // Number of Frames
  '00280009', // Frame Increment Pointer
  '00181063', // Frame Time
  '00181065', // Frame Time Vector
  '00082144', // Recommended Display Frame Rate
  '00180040', // Cine Rate
  '00181066', // Frame Delay
  '00181062', // Nominal Interval
  '00082142', // Start Trim
  '00082143', // Stop Trim
  '00181242', // Actual Frame Duration
  '52009229', // Shared Functional Groups Sequence
  '52009230' // Per-frame Functional Groups Sequence
])

export type SplitRefusalReason =
  | 'parse-error'
  | 'not-multiframe-true-color-secondary-capture'
  | 'unsupported-transfer-syntax'
  | 'not-multiframe'
  | 'unsupported-pixel-layout'
  | 'missing-pixel-data'
  | 'pixel-data-size-mismatch'
  | 'unsupported-overlay'

export type SplitDecision =
  | {
      readonly canSplit: true
      readonly frameCount: number
      readonly rows: number
      readonly columns: number
      readonly bytesPerFrame: number
    }
  | {
      readonly canSplit: false
      readonly reason: SplitRefusalReason
      readonly message: string
    }

export interface SplitFrame {
  readonly file: DicomFile
  readonly frameNumber: number
  readonly totalFrames: number
  readonly derivedSeriesInstanceUID: string
  readonly sourceSOPInstanceUID: string
}

export interface SplitSummary {
  readonly frameCount: number
  readonly derivedSeriesInstanceUID: string
  readonly sourceSOPInstanceUID: string
}

export class DicomSplitError extends Error {
  readonly reason: SplitRefusalReason

  constructor(reason: SplitRefusalReason, message: string) {
    super(message)
    this.name = 'DicomSplitError'
    this.reason = reason
  }
}

interface ParsedSplitContext {
  readonly dicomData: any
  readonly dict: Record<string, any>
  readonly decision: Extract<SplitDecision, { canSplit: true }>
  readonly pixelData: ArrayBuffer
  readonly sourceSOPClassUID: string
  readonly sourceSOPInstanceUID: string
  readonly sourceSeriesInstanceUID: string
  readonly transferSyntaxUID: string
}

const getFirstValue = (dict: Record<string, any>, tag: string): any =>
  dict[tag]?.Value?.[0]

const decodeAsciiValue = (value: ArrayBuffer): string =>
  new TextDecoder().decode(value).replace(/\0/g, '').trim()

const getStringValue = (dict: Record<string, any>, tag: string): string => {
  const value = getFirstValue(dict, tag)
  if (value instanceof ArrayBuffer) return decodeAsciiValue(value)
  if (value instanceof Uint8Array) return decodeAsciiValue(toArrayBuffer(value))
  return String(value ?? '')
}

const getNumberValue = (dict: Record<string, any>, tag: string): number => {
  const value = getFirstValue(dict, tag)
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value.trim())
  if (value instanceof Uint8Array) return getNumberValue({ [tag]: { Value: [toArrayBuffer(value)] } }, tag)
  if (value instanceof ArrayBuffer) {
    const ascii = decodeAsciiValue(value)
    if (/^[+-]?\d+$/.test(ascii)) return Number(ascii)
    if (value.byteLength >= 2) return new DataView(value).getUint16(0, true)
  }
  return 0
}

const toArrayBuffer = (value: ArrayBuffer | Uint8Array): ArrayBuffer =>
  value instanceof Uint8Array
    ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
    : value

const deterministicUID = (seed: string): string => {
  let h1 = 0xcbf29ce484222325n
  let h2 = 0x84222325cbf29ce4n
  const prime = 0x100000001b3n
  const mask = (1n << 64n) - 1n

  for (let i = 0; i < seed.length; i++) {
    const code = BigInt(seed.charCodeAt(i))
    h1 ^= code
    h1 = (h1 * prime) & mask
    h2 ^= code + BigInt(i + 1)
    h2 = (h2 * prime) & mask
  }

  const value = ((h1 << 64n) | h2) || 1n
  return `2.25.${value.toString()}`
}

const cloneValue = <T>(value: T): T => {
  if (value instanceof ArrayBuffer) return value.slice(0) as T
  if (value instanceof Uint8Array) return value.slice() as T
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T
  if (value && typeof value === 'object') {
    const cloned: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) cloned[key] = cloneValue(item)
    }
    return cloned as T
  }
  return value
}

const padEven = (bytes: Uint8Array): Uint8Array => {
  if (bytes.byteLength % 2 === 0) return bytes
  const padded = new Uint8Array(bytes.byteLength + 1)
  padded.set(bytes)
  return padded
}

const cloneDatasetWithoutBulkData = (dict: Record<string, any>): Record<string, any> => {
  const cloned: Record<string, any> = {}

  for (const [tag, element] of Object.entries(dict)) {
    if (tag === TAGS.pixelData || MULTIFRAME_ONLY_TAGS.has(tag)) continue
    if (tag.match(/^60[0-1][0-9]3000$/)) continue
    cloned[tag] = cloneValue(element)
  }

  return cloned
}

const getOverlayGroups = (dict: Record<string, any>): number[] => {
  const groups: number[] = []
  for (let group = 0x6000; group <= 0x601e; group += 2) {
    const tag = `${group.toString(16).toUpperCase().padStart(4, '0')}3000`
    if (dict[tag]) groups.push(group)
  }
  return groups
}

const overlayTag = (group: number, element: string): string =>
  `${group.toString(16).toUpperCase().padStart(4, '0')}${element}`

const validateOverlays = (
  dict: Record<string, any>,
  imageRows: number,
  imageColumns: number,
  imageFrames: number
): SplitDecision | undefined => {
  for (const group of getOverlayGroups(dict)) {
    const groupLabel = group.toString(16).toUpperCase().padStart(4, '0')
    const rows = getNumberValue(dict, overlayTag(group, '0010'))
    const columns = getNumberValue(dict, overlayTag(group, '0011'))
    const frames = getNumberValue(dict, overlayTag(group, '0015')) || 1
    const origin = getNumberValue(dict, overlayTag(group, '0051')) || 1
    const bitsAllocated = getNumberValue(dict, overlayTag(group, '0100'))
    const bitPosition = getNumberValue(dict, overlayTag(group, '0102'))
    const data = getFirstValue(dict, overlayTag(group, '3000'))

    if (
      rows !== imageRows ||
      columns !== imageColumns ||
      frames < 1 ||
      origin < 1 ||
      origin + frames - 1 > imageFrames ||
      bitsAllocated !== 1 ||
      bitPosition !== 0 ||
      !(data instanceof ArrayBuffer || data instanceof Uint8Array)
    ) {
      return {
        canSplit: false,
        reason: 'unsupported-overlay',
        message: `Overlay ${groupLabel} has an unsupported layout`
      }
    }

    const overlayBytes = toArrayBuffer(data).byteLength
    const expectedBytes = Math.ceil((rows * columns * frames) / 8)
    const expectedPaddedBytes = expectedBytes % 2 === 0 ? expectedBytes : expectedBytes + 1
    if (overlayBytes !== expectedPaddedBytes) {
      return {
        canSplit: false,
        reason: 'unsupported-overlay',
        message: `Overlay ${groupLabel} data length does not match its frame layout`
      }
    }
  }

  return undefined
}

const parseSplitContext = (file: DicomFile): ParsedSplitContext | SplitDecision => {
  let dicomData: any
  try {
    dicomData = dcmjs.data.DicomMessage.readFile(file.arrayBuffer) as any
  } catch (error) {
    return {
      canSplit: false,
      reason: 'parse-error',
      message: `Could not parse ${file.fileName}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const dict = dicomData.dict as Record<string, any>
  const sourceSOPClassUID = getStringValue(dict, TAGS.sopClassUID)
  const sourceSOPInstanceUID = getStringValue(dict, TAGS.sopInstanceUID)
  const sourceSeriesInstanceUID = getStringValue(dict, TAGS.seriesInstanceUID)
  const transferSyntaxUID =
    getStringValue(dicomData.meta ?? {}, TAGS.transferSyntaxUID) ||
    file.metadata?.transferSyntaxUID ||
    IMPLICIT_VR_LITTLE_ENDIAN_UID

  if (sourceSOPClassUID !== MULTIFRAME_TRUE_COLOR_SC_UID) {
    return {
      canSplit: false,
      reason: 'not-multiframe-true-color-secondary-capture',
      message: `SOP Class ${sourceSOPClassUID || 'unknown'} is not supported for safe splitting`
    }
  }

  if (!SUPPORTED_TRANSFER_SYNTAXES.has(transferSyntaxUID)) {
    return {
      canSplit: false,
      reason: 'unsupported-transfer-syntax',
      message: `Transfer Syntax ${transferSyntaxUID || 'unknown'} is not supported for safe splitting`
    }
  }

  const frameCount = getNumberValue(dict, TAGS.numberOfFrames)
  if (!Number.isInteger(frameCount) || frameCount <= 1) {
    return {
      canSplit: false,
      reason: 'not-multiframe',
      message: 'DICOM is not a multi-frame instance'
    }
  }

  const rows = getNumberValue(dict, TAGS.rows)
  const columns = getNumberValue(dict, TAGS.columns)
  const samplesPerPixel = getNumberValue(dict, TAGS.samplesPerPixel)
  const photometricInterpretation = getStringValue(dict, TAGS.photometricInterpretation)
  const planarConfiguration = getNumberValue(dict, TAGS.planarConfiguration)
  const bitsAllocated = getNumberValue(dict, TAGS.bitsAllocated)
  const bitsStored = getNumberValue(dict, TAGS.bitsStored)
  const highBit = getNumberValue(dict, TAGS.highBit)
  const pixelRepresentation = getNumberValue(dict, TAGS.pixelRepresentation)

  if (
    rows <= 0 ||
    columns <= 0 ||
    samplesPerPixel !== 3 ||
    photometricInterpretation !== 'RGB' ||
    planarConfiguration !== 0 ||
    bitsAllocated !== 8 ||
    bitsStored !== 8 ||
    highBit !== 7 ||
    pixelRepresentation !== 0
  ) {
    return {
      canSplit: false,
      reason: 'unsupported-pixel-layout',
      message: 'Only uncompressed interleaved 8-bit RGB multi-frame images are supported for splitting'
    }
  }

  const pixelDataValue = getFirstValue(dict, TAGS.pixelData)
  if (!(pixelDataValue instanceof ArrayBuffer || pixelDataValue instanceof Uint8Array)) {
    return {
      canSplit: false,
      reason: 'missing-pixel-data',
      message: 'Pixel Data is missing or not readable'
    }
  }

  const pixelData = toArrayBuffer(pixelDataValue)
  const bytesPerFrame = rows * columns * samplesPerPixel
  if (pixelData.byteLength < bytesPerFrame * frameCount) {
    return {
      canSplit: false,
      reason: 'pixel-data-size-mismatch',
      message: 'Pixel Data length is smaller than the declared frame layout'
    }
  }

  const overlayDecision = validateOverlays(dict, rows, columns, frameCount)
  if (overlayDecision) return overlayDecision

  return {
    dicomData,
    dict,
    pixelData,
    sourceSOPClassUID,
    sourceSOPInstanceUID,
    sourceSeriesInstanceUID,
    transferSyntaxUID,
    decision: {
      canSplit: true,
      frameCount,
      rows,
      columns,
      bytesPerFrame
    }
  }
}

export const inspectMultiframeSplit = (file: DicomFile): SplitDecision => {
  const context = parseSplitContext(file)
  return 'decision' in context ? context.decision : context
}

const sliceOverlayFrame = (
  overlayData: ArrayBuffer,
  rows: number,
  columns: number,
  frameIndex: number
): Uint8Array => {
  const source = new Uint8Array(overlayData)
  const bitsPerFrame = rows * columns

  if (bitsPerFrame % 8 === 0) {
    const bytesPerFrame = bitsPerFrame / 8
    return padEven(source.slice(frameIndex * bytesPerFrame, (frameIndex + 1) * bytesPerFrame))
  }

  const result = new Uint8Array(Math.ceil(bitsPerFrame / 8))
  const startBit = frameIndex * bitsPerFrame

  for (let bitIndex = 0; bitIndex < bitsPerFrame; bitIndex++) {
    const sourceBit = startBit + bitIndex
    if (source[sourceBit >> 3] & (1 << (sourceBit % 8))) {
      result[bitIndex >> 3] |= 1 << (bitIndex % 8)
    }
  }

  return padEven(result)
}

const applyFrameOverlays = (
  sourceDict: Record<string, any>,
  frameDict: Record<string, any>,
  frameNumber: number
) => {
  for (const group of getOverlayGroups(sourceDict)) {
    const rows = getNumberValue(sourceDict, overlayTag(group, '0010'))
    const columns = getNumberValue(sourceDict, overlayTag(group, '0011'))
    const frames = getNumberValue(sourceDict, overlayTag(group, '0015')) || 1
    const origin = getNumberValue(sourceDict, overlayTag(group, '0051')) || 1
    const overlayFrameNumber = frameNumber - origin + 1

    if (overlayFrameNumber < 1 || overlayFrameNumber > frames) {
      for (const tag of Object.keys(frameDict)) {
        if (tag.startsWith(group.toString(16).toUpperCase().padStart(4, '0'))) {
          delete frameDict[tag]
        }
      }
      continue
    }

    const dataTag = overlayTag(group, '3000')
    const sourceOverlayData = toArrayBuffer(getFirstValue(sourceDict, dataTag))
    frameDict[dataTag] = {
      vr: sourceDict[dataTag]?.vr ?? 'OW',
      Value: [sliceOverlayFrame(sourceOverlayData, rows, columns, overlayFrameNumber - 1)]
    }

    delete frameDict[overlayTag(group, '0015')]
    delete frameDict[overlayTag(group, '0051')]
  }
}

const createFrameFile = (
  sourceFile: DicomFile,
  context: ParsedSplitContext,
  frameIndex: number,
  derivedSeriesInstanceUID: string
): SplitFrame => {
  const frameNumber = frameIndex + 1
  const sopInstanceUID = deterministicUID(`${context.sourceSOPInstanceUID}:split-frame:${frameNumber}`)
  const frameDict = cloneDatasetWithoutBulkData(context.dict)
  const pixelStart = frameIndex * context.decision.bytesPerFrame
  const pixelFrame = new Uint8Array(
    context.pixelData.slice(pixelStart, pixelStart + context.decision.bytesPerFrame)
  )

  frameDict[TAGS.sopClassUID] = { vr: 'UI', Value: [SECONDARY_CAPTURE_IMAGE_STORAGE_UID] }
  frameDict[TAGS.sopInstanceUID] = { vr: 'UI', Value: [sopInstanceUID] }
  frameDict[TAGS.seriesInstanceUID] = { vr: 'UI', Value: [derivedSeriesInstanceUID] }
  frameDict[TAGS.instanceNumber] = { vr: 'IS', Value: [String(frameNumber)] }
  frameDict[TAGS.imagesInAcquisition] = { vr: 'IS', Value: [String(context.decision.frameCount)] }
  frameDict[TAGS.imageType] = { vr: 'CS', Value: ['DERIVED', 'SECONDARY'] }
  frameDict[TAGS.derivationDescription] = {
    vr: 'ST',
    Value: [
      `Split frame ${frameNumber} of ${context.decision.frameCount} from multi-frame source SOP ${context.sourceSOPInstanceUID}`
    ]
  }
  frameDict[TAGS.sourceImageSequence] = {
    vr: 'SQ',
    Value: [{
      [TAGS.referencedSOPClassUID]: { vr: 'UI', Value: [context.sourceSOPClassUID] },
      [TAGS.referencedSOPInstanceUID]: { vr: 'UI', Value: [context.sourceSOPInstanceUID] }
    }]
  }
  frameDict[TAGS.pixelData] = { vr: 'OB', Value: [pixelFrame] }
  applyFrameOverlays(context.dict, frameDict, frameNumber)

  const meta = cloneValue(context.dicomData.meta ?? {})
  meta[TAGS.mediaStorageSOPClassUID] = { vr: 'UI', Value: [SECONDARY_CAPTURE_IMAGE_STORAGE_UID] }
  meta[TAGS.mediaStorageSOPInstanceUID] = { vr: 'UI', Value: [sopInstanceUID] }
  meta[TAGS.transferSyntaxUID] = { vr: 'UI', Value: [context.transferSyntaxUID] }

  const dicomDict = new (dcmjs.data as any).DicomDict(meta)
  dicomDict.dict = frameDict
  const arrayBuffer = dicomDict.write({ allowInvalidVRLength: true }) as ArrayBuffer
  const fileName = `${sourceFile.fileName}.split/frame-${String(frameNumber).padStart(3, '0')}.dcm`

  return {
    file: {
      id: `${sourceFile.id}-split-${frameNumber}`,
      fileName,
      fileSize: arrayBuffer.byteLength,
      arrayBuffer,
      anonymized: true,
      parsed: true,
      metadata: {
        ...(sourceFile.metadata ?? {}),
        sopInstanceUID,
        seriesInstanceUID: derivedSeriesInstanceUID,
        instanceNumber: frameNumber,
        transferSyntaxUID: context.transferSyntaxUID
      }
    },
    frameNumber,
    totalFrames: context.decision.frameCount,
    derivedSeriesInstanceUID,
    sourceSOPInstanceUID: context.sourceSOPInstanceUID
  }
}

export const splitMultiframeDicom = <R, E>(
  file: DicomFile,
  onFrame: (frame: SplitFrame) => Effect.Effect<void, E, R>
): Effect.Effect<SplitSummary, DicomSplitError | E, R> =>
	  Effect.gen(function* () {
	    const context = parseSplitContext(file)
	    if (!('decision' in context)) {
	      const refusal = context as Extract<SplitDecision, { canSplit: false }>
	      return yield* Effect.fail(new DicomSplitError(refusal.reason, refusal.message))
	    }

    const derivedSeriesInstanceUID = deterministicUID(`${context.sourceSOPInstanceUID}:split-series`)

    for (let frameIndex = 0; frameIndex < context.decision.frameCount; frameIndex++) {
      const frame = yield* Effect.try({
        try: () => createFrameFile(file, context, frameIndex, derivedSeriesInstanceUID),
        catch: (error) => new DicomSplitError(
          'parse-error',
          `Failed to create split frame ${frameIndex + 1}: ${error instanceof Error ? error.message : String(error)}`
        )
      })
      yield* onFrame(frame)
    }

    return {
      frameCount: context.decision.frameCount,
      derivedSeriesInstanceUID,
      sourceSOPInstanceUID: context.sourceSOPInstanceUID
    }
  })
