import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Effect } from 'effect'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import sharp from 'sharp'
import type { FileFormatPlugin, ConversionOptions } from '@dicorre/shared/types/plugins'
import type { DicomFile, DicomMetadata } from '@dicorre/shared/types/dicom'
import { PluginError } from '@dicorre/shared/types/effects'
import { DicomDatasetBuilder } from '@dicorre/shared/utils/dicomDatasetBuilder'
import { fileId, generateDicomUid } from '../common/metadata'
import { computeTargetSize, dHash64FromGrayscale9x8, hammingDistance64 } from '../common/pixels'

type VideoConversionOptions = ConversionOptions & {
  samplingStrategy?: 'interval' | 'unique'
  intervalMs?: number
  uniqueHammingThreshold?: number
  maxFrames?: number
  outputMaxWidth?: number
  outputMaxHeight?: number
  seriesDescription?: string
}

const execFileAsync = promisify(execFile)

const extensionForMime = (file: File): string => {
  const ext = path.extname(file.name).toLowerCase()
  if (ext) return ext
  if (file.type === 'video/webm') return '.webm'
  if (file.type === 'video/ogg') return '.ogv'
  return '.mp4'
}

const extractFrames = async (
  file: File,
  options: VideoConversionOptions | undefined,
  pluginId: string,
): Promise<{ dir: string; frames: string[] }> => {
  const ffmpegPath = ffmpegInstaller.path
  if (!ffmpegPath) {
    throw new PluginError({ message: '@ffmpeg-installer/ffmpeg did not provide an ffmpeg binary path', pluginId })
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dicorre-video-'))
  const input = path.join(dir, `input${extensionForMime(file)}`)
  await writeFile(input, Buffer.from(await file.arrayBuffer()))

  const intervalMs = options?.intervalMs ?? 1000
  const stepSec = Math.max(intervalMs / 1000, 0.001)
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-vf',
    `fps=1/${stepSec}`,
  ]
  if (options?.maxFrames !== undefined && options.maxFrames > 0) {
    args.push('-frames:v', String(options.maxFrames))
  }
  args.push(path.join(dir, 'frame-%04d.png'))

  await execFileAsync(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 })
  let frames = (await readdir(dir))
    .filter((name) => /^frame-\d+\.png$/u.test(name))
    .sort()
    .map((name) => path.join(dir, name))

  if (frames.length === 0) {
    await execFileAsync(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-frames:v',
      '1',
      path.join(dir, 'frame-0001.png'),
    ], { maxBuffer: 10 * 1024 * 1024 })
    frames = [path.join(dir, 'frame-0001.png')]
  }

  return { dir, frames }
}

const frameToRgb = async (
  framePath: string,
  options?: VideoConversionOptions,
): Promise<{ data: Uint8Array; width: number; height: number }> => {
  const image = sharp(await readFile(framePath)).rotate().removeAlpha().toColorspace('srgb')
  const metadata = await image.metadata()
  const width = metadata.width || 1
  const height = metadata.height || 1
  const [targetWidth, targetHeight] = computeTargetSize(width, height, options?.outputMaxWidth, options?.outputMaxHeight)
  const pipeline = targetWidth === width && targetHeight === height
    ? image
    : image.resize(targetWidth, targetHeight, { fit: 'inside' })
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), width: info.width, height: info.height }
}

const frameHash = async (framePath: string): Promise<bigint> => {
  const { data } = await sharp(await readFile(framePath))
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return dHash64FromGrayscale9x8(new Uint8Array(data))
}

export class NodeVideoConverterPlugin implements FileFormatPlugin {
  id = 'video-converter'
  name = 'Video to DICOM Converter'
  version = '1.0.0'
  description = 'Converts video frames to DICOM Secondary Capture series'
  type = 'file-format' as const
  enabled = true
  supportedExtensions = ['.mp4', '.webm', '.ogv']
  supportedMimeTypes = ['video/mp4', 'video/webm', 'video/ogg']
  cli = {
    summary: 'Uses ffmpeg to sample video frames and writes real Secondary Capture DICOM instances.',
    docs: 'docs/cli.md#plugins',
    notes: ['The ffmpeg binary is provided by @ffmpeg-installer/ffmpeg.'],
  }

  canProcess = (file: File): Effect.Effect<boolean, PluginError> =>
    Effect.sync(() => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
      return this.supportedExtensions.includes(ext) || (!!file.type && this.supportedMimeTypes.includes(file.type))
    })

  validateFile = (file: File): Effect.Effect<boolean, PluginError> => {
    const pluginId = this.id
    return Effect.tryPromise({
      try: async () => {
        const { dir, frames } = await extractFrames(file, { maxFrames: 1, intervalMs: 1000 }, pluginId)
        await rm(dir, { recursive: true, force: true })
        return frames.length > 0
      },
      catch: (error) => new PluginError({ message: `Failed to validate video file: ${file.name}`, pluginId, cause: error }),
    })
  }

  convertToDicom = (file: File, metadata: DicomMetadata, options?: VideoConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id
    return Effect.gen(function* () {
      const extracted = yield* Effect.tryPromise({
        try: () => extractFrames(file, options, pluginId),
        catch: (error) => error instanceof PluginError ? error : new PluginError({ message: `Failed to extract frames from ${file.name}`, pluginId, cause: error }),
      })

      try {
        const studyInstanceUID = metadata.studyInstanceUID || generateDicomUid()
        const seriesInstanceUID = metadata.seriesInstanceUID || generateDicomUid()
        const seriesDescription = options?.seriesDescription || metadata.seriesDescription || 'Video Conversion'
        const dicomFiles: DicomFile[] = []
        let lastHash: bigint | undefined

        for (const frame of extracted.frames) {
          if (options?.samplingStrategy === 'unique') {
            const hash = yield* Effect.tryPromise({
              try: () => frameHash(frame),
              catch: (error) => new PluginError({ message: `Failed to hash video frame ${frame}`, pluginId, cause: error }),
            })
            if (lastHash !== undefined && hammingDistance64(hash, lastHash) < (options.uniqueHammingThreshold ?? 10)) {
              continue
            }
            lastHash = hash
          }

          const index = dicomFiles.length + 1
          const rgb = yield* Effect.tryPromise({
            try: () => frameToRgb(frame, options),
            catch: (error) => new PluginError({ message: `Failed to decode video frame ${frame}`, pluginId, cause: error }),
          })
          const dicomBuffer = yield* Effect.tryPromise({
            try: () => DicomDatasetBuilder.createDicomBuffer(rgb.width, rgb.height, rgb.data, {
              ...metadata,
              studyInstanceUID,
              seriesInstanceUID,
              instanceNumber: index,
              sopInstanceUID: generateDicomUid(),
              seriesDescription,
            }, {
              samplesPerPixel: 3,
              photometricInterpretation: 'RGB',
              bitsAllocated: 8,
              bitsStored: 8,
              highBit: 7,
              pixelRepresentation: 0,
              planarConfiguration: 0,
            }),
            catch: (error) => new PluginError({ message: `Failed to create DICOM buffer for frame ${index} (${file.name})`, pluginId, cause: error }),
          })
          dicomFiles.push({
            id: fileId('vid', index),
            fileName: file.name.replace(/\.(mp4|webm|ogv)$/i, '') + `_frame${index.toString().padStart(4, '0')}.dcm`,
            fileSize: dicomBuffer.byteLength,
            arrayBuffer: dicomBuffer,
            anonymized: false,
          })
        }

        return dicomFiles
      } finally {
        yield* Effect.promise(() => rm(extracted.dir, { recursive: true, force: true }))
      }
    })
  }
}

export const nodeVideoConverterPlugin = new NodeVideoConverterPlugin()
