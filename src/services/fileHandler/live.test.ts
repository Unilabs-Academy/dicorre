// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import JSZip from 'jszip'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FileHandler, FileHandlerLive } from './index'
import { PluginRegistryLive } from '../pluginRegistry'

const fixturePath = join(process.cwd(), 'test-data', 'CASES', 'mixed_sip_minimal.zip')
const liveLayer = FileHandlerLive.pipe(Layer.provide(PluginRegistryLive))

const runTest = <A, E>(effect: Effect.Effect<A, E, FileHandler>) =>
  Effect.runPromise(effect.pipe(Effect.provide(liveLayer)))

function createBlobBackedFile(bytes: BlobPart, fileName: string, type: string): File {
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes as Uint8Array))

  const makePart = (part: Buffer): File =>
    ({
      name: fileName,
      type,
      size: part.byteLength,
      lastModified: Date.now(),
      webkitRelativePath: '',
      arrayBuffer: async () =>
        part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer,
      bytes: async () => new Uint8Array(part),
      text: async () => part.toString('utf-8'),
      slice: (start?: number, end?: number) => makePart(part.subarray(start ?? 0, end ?? part.byteLength)),
      stream: () => new Blob([part]).stream(),
    }) as unknown as File

  return makePart(buffer)
}

function loadFixtureZipFile(fileName = 'mixed_sip_minimal.zip'): File {
  const buffer = readFileSync(fixturePath)
  return createBlobBackedFile(buffer, fileName, 'application/zip')
}

async function loadFixtureArchive(): Promise<JSZip> {
  return JSZip.loadAsync(readFileSync(fixturePath))
}

describe('FileHandler live ZIP filtering', () => {
  it('keeps only the real DICOM entries from the mixed SIP fixture', async () => {
    const result = await runTest(Effect.gen(function* () {
      const fileHandler = yield* FileHandler
      return yield* fileHandler.extractZipFile(loadFixtureZipFile())
    }))

    expect(result).toHaveLength(2)
    expect(result.map((file) => file.fileName).sort()).toEqual([
      'CMR/DICOM/00003418/AA362216/AA51F9CF/00001DA7/EE131708',
      'CMR/Viewer/scanograms/00003418/AA362216/AA51F9CF/00001DA7/DD9ABF15',
    ])
  })

  it('rejects pseudo-DICOM thumbnail entries that lack required identity tags', async () => {
    const fixtureArchive = await loadFixtureArchive()
    const thumbnailBytes = await fixtureArchive.file('CMR/Viewer/thumbnails/00000E37')!.async('arraybuffer')

    await expect(
      runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.validateDicomFile(
          thumbnailBytes,
          'CMR/Viewer/thumbnails/00000E37',
        )
      })),
    ).rejects.toThrow('missing required DICOM identity tags')
  })

  it('fails only when no valid DICOM entries survive filtering', async () => {
    const fixtureArchive = await loadFixtureArchive()
    const thumbnailBytes = await fixtureArchive.file('CMR/Viewer/thumbnails/00000E37')!.async('uint8array')
    const htmlBytes = await fixtureArchive.file('CMR/INDEX.HTM')!.async('uint8array')
    const invalidArchive = new JSZip()
    invalidArchive.file('CMR/Viewer/thumbnails/00000E37', thumbnailBytes)
    invalidArchive.file('CMR/INDEX.HTM', htmlBytes)
    const invalidZipBytes = await invalidArchive.generateAsync({ type: 'uint8array' })
    const invalidZipFile = createBlobBackedFile(
      invalidZipBytes,
      'mixed_sip_no_valid.zip',
      'application/zip',
    )

    await expect(
      runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.extractZipFile(invalidZipFile)
      })),
    ).rejects.toThrow('No valid DICOM files found in ZIP: mixed_sip_no_valid.zip')
  })
})
