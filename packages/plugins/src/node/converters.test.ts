import { File as NodeFile } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createDefaultConversionMetadata } from '../common/metadata'
import { nodeImageConverterPlugin } from './imageConverter'
import { nodePdfConverterPlugin } from './pdfConverter'
import { nodeVideoConverterPlugin } from './videoConverter'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const webFixture = (...parts: string[]) => path.join(repoRoot, 'apps', 'web', ...parts)

const makeFile = async (filePath: string, type: string): Promise<File> =>
  new NodeFile([await readFile(filePath)], path.basename(filePath), { type }) as unknown as File

const expectDicomPreamble = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  expect(String.fromCharCode(...bytes.slice(128, 132))).toBe('DICM')
}

describe('node converter plugins', () => {
  it('creates real DICOM files from image, PDF, and video fixtures', async () => {
    const image = await makeFile(webFixture('src/plugins/imageConverter/test-data/red-square.jpg'), 'image/jpeg')
    const pdf = await makeFile(webFixture('src/plugins/pdfConverter/test-data/test-document.pdf'), 'application/pdf')
    const video = await makeFile(webFixture('src/plugins/videoConverter/test-data/test-video.mp4'), 'video/mp4')

    const imageFiles = await Effect.runPromise(
      nodeImageConverterPlugin.convertToDicom(image, createDefaultConversionMetadata(image.name)),
    )
    const pdfFiles = await Effect.runPromise(
      nodePdfConverterPlugin.convertToDicom(pdf, createDefaultConversionMetadata(pdf.name)),
    )
    const videoFiles = await Effect.runPromise(
      nodeVideoConverterPlugin.convertToDicom(video, createDefaultConversionMetadata(video.name), { maxFrames: 2 }),
    )

    expect(imageFiles).toHaveLength(1)
    expect(pdfFiles).toHaveLength(3)
    expect(videoFiles).toHaveLength(2)

    for (const file of [...imageFiles, ...pdfFiles, ...videoFiles]) {
      expect(file.fileName).toMatch(/\.dcm$/)
      expect(file.fileSize).toBeGreaterThan(132)
      expectDicomPreamble(file.arrayBuffer)
    }
  }, 15000)
})
