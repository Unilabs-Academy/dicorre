import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import * as dcmjs from 'dcmjs'
import type { DicomFile } from '@dicorre/shared/types/dicom'
import { inspectMultiframeSplit, splitMultiframeDicom } from './index'

const MULTIFRAME_TRUE_COLOR_SC_UID = '1.2.840.10008.5.1.4.1.1.7.4'
const ENHANCED_MR_IMAGE_STORAGE_UID = '1.2.840.10008.5.1.4.1.1.4.1'
const IMPLICIT_VR_LITTLE_ENDIAN_UID = '1.2.840.10008.1.2'

const createUID = () => (dcmjs.data as any).DicomMetaDictionary.uid()

const createSyntheticMultiframeFile = (): DicomFile => {
  const studyInstanceUID = createUID()
  const seriesInstanceUID = createUID()
  const sopInstanceUID = createUID()
  const pixelData = new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48
  ])

  const meta = {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1])] },
    '00020002': { vr: 'UI', Value: [MULTIFRAME_TRUE_COLOR_SC_UID] },
    '00020003': { vr: 'UI', Value: [sopInstanceUID] },
    '00020010': { vr: 'UI', Value: [IMPLICIT_VR_LITTLE_ENDIAN_UID] },
    '00020012': { vr: 'UI', Value: [createUID()] },
    '00020013': { vr: 'SH', Value: ['RATATOSKR'] }
  }
  const dict = {
    '00080016': { vr: 'UI', Value: [MULTIFRAME_TRUE_COLOR_SC_UID] },
    '00080018': { vr: 'UI', Value: [sopInstanceUID] },
    '00080060': { vr: 'CS', Value: ['OT'] },
    '00100010': { vr: 'PN', Value: ['REMOVED'] },
    '00100020': { vr: 'LO', Value: ['PATIENT'] },
    '0020000D': { vr: 'UI', Value: [studyInstanceUID] },
    '0020000E': { vr: 'UI', Value: [seriesInstanceUID] },
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
    '60000010': { vr: 'US', Value: [2] },
    '60000011': { vr: 'US', Value: [4] },
    '60000015': { vr: 'IS', Value: ['2'] },
    '60000040': { vr: 'CS', Value: ['G'] },
    '60000050': { vr: 'SS', Value: [1, 1] },
    '60000100': { vr: 'US', Value: [1] },
    '60000102': { vr: 'US', Value: [0] },
    '60003000': { vr: 'OW', Value: [new Uint8Array([0xaa, 0x55])] },
    '7FE00010': { vr: 'OB', Value: [pixelData] }
  }

  const dicomDict = new (dcmjs.data as any).DicomDict(meta)
  dicomDict.dict = dict
  const arrayBuffer = dicomDict.write() as ArrayBuffer

  return {
    id: 'synthetic-multiframe',
    fileName: 'synthetic.dcm',
    fileSize: arrayBuffer.byteLength,
    arrayBuffer,
    anonymized: true,
    metadata: {
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID,
      transferSyntaxUID: IMPLICIT_VR_LITTLE_ENDIAN_UID,
      modality: 'OT'
    }
  }
}

const createSyntheticEnhancedMrMultiframeFile = (): DicomFile => {
  const studyInstanceUID = createUID()
  const seriesInstanceUID = createUID()
  const sopInstanceUID = createUID()
  const pixelData = new Uint8Array([
    1, 0, 2, 0, 3, 0, 4, 0,
    5, 0, 6, 0, 7, 0, 8, 0
  ])

  const meta = {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1])] },
    '00020002': { vr: 'UI', Value: [ENHANCED_MR_IMAGE_STORAGE_UID] },
    '00020003': { vr: 'UI', Value: [sopInstanceUID] },
    '00020010': { vr: 'UI', Value: [IMPLICIT_VR_LITTLE_ENDIAN_UID] },
    '00020012': { vr: 'UI', Value: [createUID()] },
    '00020013': { vr: 'SH', Value: ['RATATOSKR'] }
  }
  const dict = {
    '00080016': { vr: 'UI', Value: [ENHANCED_MR_IMAGE_STORAGE_UID] },
    '00080018': { vr: 'UI', Value: [sopInstanceUID] },
    '00080060': { vr: 'CS', Value: ['MR'] },
    '00100010': { vr: 'PN', Value: ['REMOVED'] },
    '00100020': { vr: 'LO', Value: ['PATIENT'] },
    '0020000D': { vr: 'UI', Value: [studyInstanceUID] },
    '0020000E': { vr: 'UI', Value: [seriesInstanceUID] },
    '00200013': { vr: 'IS', Value: ['1'] },
    '00280002': { vr: 'US', Value: [1] },
    '00280004': { vr: 'CS', Value: ['MONOCHROME2'] },
    '00280008': { vr: 'IS', Value: ['2'] },
    '00280010': { vr: 'US', Value: [2] },
    '00280011': { vr: 'US', Value: [2] },
    '00280100': { vr: 'US', Value: [16] },
    '00280101': { vr: 'US', Value: [12] },
    '00280102': { vr: 'US', Value: [11] },
    '00280103': { vr: 'US', Value: [0] },
    '52009229': { vr: 'SQ', Value: [] },
    '52009230': { vr: 'SQ', Value: [] },
    '7FE00010': { vr: 'OW', Value: [pixelData] }
  }

  const dicomDict = new (dcmjs.data as any).DicomDict(meta)
  dicomDict.dict = dict
  const arrayBuffer = dicomDict.write() as ArrayBuffer

  return {
    id: 'synthetic-enhanced-mr-multiframe',
    fileName: 'synthetic-enhanced-mr.dcm',
    fileSize: arrayBuffer.byteLength,
    arrayBuffer,
    anonymized: true,
    metadata: {
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID,
      transferSyntaxUID: IMPLICIT_VR_LITTLE_ENDIAN_UID,
      modality: 'MR'
    }
  }
}

describe('dicomSplitter', () => {
  it('detects a supported multi-frame true-color secondary-capture file', () => {
    const decision = inspectMultiframeSplit(createSyntheticMultiframeFile())

    expect(decision).toMatchObject({
      canSplit: true,
      frameCount: 2,
      rows: 2,
      columns: 4,
      bytesPerFrame: 24
    })
  })

  it('detects a supported enhanced MR monochrome multi-frame file', () => {
    const decision = inspectMultiframeSplit(createSyntheticEnhancedMrMultiframeFile())

    expect(decision).toMatchObject({
      canSplit: true,
      frameCount: 2,
      rows: 2,
      columns: 2,
      bytesPerFrame: 8,
      pixelDataVR: 'OW'
    })
  })

  it('splits frames, generates derived identifiers, and slices overlays', async () => {
    const source = createSyntheticMultiframeFile()
    const frames: DicomFile[] = []

    const summary = await Effect.runPromise(
      splitMultiframeDicom(source, (frame) =>
        Effect.sync(() => {
          frames.push(frame.file)
        })
      )
    )

    expect(summary.frameCount).toBe(2)
    expect(frames).toHaveLength(2)

    const first = dcmjs.data.DicomMessage.readFile(frames[0]!.arrayBuffer) as any
    const second = dcmjs.data.DicomMessage.readFile(frames[1]!.arrayBuffer) as any

    expect(first.dict['00080016'].Value[0]).toBe('1.2.840.10008.5.1.4.1.1.7')
    expect(first.dict['00280008']).toBeUndefined()
    expect(first.dict['0020000E'].Value[0]).toBe(summary.derivedSeriesInstanceUID)
    expect(second.dict['0020000E'].Value[0]).toBe(summary.derivedSeriesInstanceUID)
    expect(first.dict['00080018'].Value[0]).not.toBe(second.dict['00080018'].Value[0])

    expect(Array.from(new Uint8Array(first.dict['7FE00010'].Value[0]))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24
    ])
    expect(Array.from(new Uint8Array(first.dict['60003000'].Value[0]))).toEqual([0xaa, 0])
    expect(Array.from(new Uint8Array(second.dict['60003000'].Value[0]))).toEqual([0x55, 0])
    expect(first.dict['60000015']).toBeUndefined()

    const retryFrames: DicomFile[] = []
    const retrySummary = await Effect.runPromise(
      splitMultiframeDicom(source, (frame) =>
        Effect.sync(() => {
          retryFrames.push(frame.file)
        })
      )
    )
    const retryFirst = dcmjs.data.DicomMessage.readFile(retryFrames[0]!.arrayBuffer) as any
    expect(retrySummary.derivedSeriesInstanceUID).toBe(summary.derivedSeriesInstanceUID)
    expect(retryFirst.dict['00080018'].Value[0]).toBe(first.dict['00080018'].Value[0])
  })

  it('splits enhanced MR monochrome frames into derived single-frame secondary capture instances', async () => {
    const source = createSyntheticEnhancedMrMultiframeFile()
    const frames: DicomFile[] = []

    const summary = await Effect.runPromise(
      splitMultiframeDicom(source, (frame) =>
        Effect.sync(() => {
          frames.push(frame.file)
        })
      )
    )

    expect(summary.frameCount).toBe(2)
    expect(frames).toHaveLength(2)

    const first = dcmjs.data.DicomMessage.readFile(frames[0]!.arrayBuffer) as any
    const second = dcmjs.data.DicomMessage.readFile(frames[1]!.arrayBuffer) as any

    expect(first.dict['00080016'].Value[0]).toBe('1.2.840.10008.5.1.4.1.1.7')
    expect(first.dict['00280008']).toBeUndefined()
    expect(first.dict['52009229']).toBeUndefined()
    expect(first.dict['52009230']).toBeUndefined()
    expect(first.dict['0020000D'].Value[0]).toBe(source.metadata?.studyInstanceUID)
    expect(first.dict['0020000E'].Value[0]).toBe(summary.derivedSeriesInstanceUID)
    expect(second.dict['0020000E'].Value[0]).toBe(summary.derivedSeriesInstanceUID)
    expect(first.dict['7FE00010'].vr).toBe('OW')
    expect(Array.from(new Uint8Array(first.dict['7FE00010'].Value[0]))).toEqual([1, 0, 2, 0, 3, 0, 4, 0])
    expect(Array.from(new Uint8Array(second.dict['7FE00010'].Value[0]))).toEqual([5, 0, 6, 0, 7, 0, 8, 0])
  })
})
