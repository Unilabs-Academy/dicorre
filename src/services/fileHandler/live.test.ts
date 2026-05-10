// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import JSZip from 'jszip'
import { File as NodeFile } from 'node:buffer'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FileHandler, FileHandlerLive } from './index'
import { PluginRegistryLive } from '../pluginRegistry'

const fixturePath = join(process.cwd(), 'test-data', 'CASES', 'mixed_sip_minimal.zip')
const rarFixturePath = join(process.cwd(), 'test-data', 'CASES', 'mixed_sip_minimal.rar')
const invalidRarFixturePath = join(process.cwd(), 'test-data', 'CASES', 'mixed_sip_no_valid.rar')
const liveLayer = FileHandlerLive.pipe(Layer.provide(PluginRegistryLive))

const runTest = <A, E>(effect: Effect.Effect<A, E, FileHandler>) =>
  Effect.runPromise(effect.pipe(Effect.provide(liveLayer)))

function createBlobBackedFile(bytes: BlobPart, fileName: string, type: string): File {
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes as Uint8Array))

  return new NodeFile([buffer], fileName, { type, lastModified: Date.now() }) as unknown as File
}

function loadFixtureZipFile(fileName = 'mixed_sip_minimal.zip'): File {
  const buffer = readFileSync(fixturePath)
  return createBlobBackedFile(buffer, fileName, 'application/zip')
}

function loadFixtureRarFile(fileName = 'mixed_sip_minimal.rar'): File {
  const buffer = readFileSync(rarFixturePath)
  return createBlobBackedFile(buffer, fileName, 'application/vnd.rar')
}

function loadInvalidRarFile(fileName = 'mixed_sip_no_valid.rar'): File {
  const buffer = readFileSync(invalidRarFixturePath)
  return createBlobBackedFile(buffer, fileName, 'application/vnd.rar')
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

  it('keeps only the real DICOM entries from the mixed SIP RAR fixture', async () => {
    const result = await runTest(Effect.gen(function* () {
      const fileHandler = yield* FileHandler
      return yield* fileHandler.extractRarFile(loadFixtureRarFile())
    }))

    expect(result).toHaveLength(2)
    expect(result.map((file) => file.fileName).sort()).toEqual([
      'CMR/DICOM/00003418/AA362216/AA51F9CF/00001DA7/EE131708',
      'CMR/Viewer/scanograms/00003418/AA362216/AA51F9CF/00001DA7/DD9ABF15',
    ])
  })

  it('routes .rar uploads through processFile', async () => {
    const result = await runTest(Effect.gen(function* () {
      const fileHandler = yield* FileHandler
      return yield* fileHandler.processFile(loadFixtureRarFile())
    }))

    expect(result).toHaveLength(2)
  })

  it('fails only when no valid DICOM entries survive RAR filtering', async () => {
    await expect(
      runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.extractRarFile(loadInvalidRarFile())
      })),
    ).rejects.toThrow('No valid DICOM files found in RAR: mixed_sip_no_valid.rar')
  })

  it('rejects corrupt RAR uploads clearly', async () => {
    const corruptRar = createBlobBackedFile(new Uint8Array([1, 2, 3, 4]), 'corrupt.rar', 'application/vnd.rar')

    await expect(
      runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.extractRarFile(corruptRar)
      })),
    ).rejects.toThrow('Failed to read RAR file: corrupt.rar')
  })

  it('rejects multi-part RAR names clearly', async () => {
    await expect(
      runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.extractRarFile(loadFixtureRarFile('study.part1.rar'))
      })),
    ).rejects.toThrow('Multi-part RAR archives are not supported: study.part1.rar')
  })
})
