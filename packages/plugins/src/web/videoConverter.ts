import { Effect } from 'effect'
import type { FileFormatPlugin, ConversionOptions } from '@dicorre/shared/types/plugins'
import type { DicomFile, DicomMetadata } from '@dicorre/shared/types/dicom'
import { PluginError } from '@dicorre/shared/types/effects'
import { DicomDatasetBuilder } from '@dicorre/shared/utils/dicomDatasetBuilder'
import { fileId, generateDicomUid } from '../common/metadata'
import { computeTargetSize, dHash64FromGrayscale9x8, hammingDistance64, rgbaToRgb } from '../common/pixels'

type VideoConversionOptions = ConversionOptions & {
  samplingStrategy?: 'interval' | 'unique'
  intervalMs?: number
  uniqueHammingThreshold?: number
  maxFrames?: number
  outputMaxWidth?: number
  outputMaxHeight?: number
  seriesDescription?: string
}

const waitForLoadedMetadata = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!Number.isNaN(video.duration) && video.duration > 0) return resolve()
    const onLoaded = () => cleanup(resolve)
    const onError = () => cleanup(undefined, reject, new Error('Failed to load video metadata'))
    const cleanup = (res?: () => void, rej?: (reason?: unknown) => void, err?: unknown) => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
      if (err && rej) rej(err)
      else if (res) res()
    }
    video.addEventListener('loadedmetadata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
  })

const seekTo = (video: HTMLVideoElement, timeSec: number, timeoutMs = 5000): Promise<void> =>
  new Promise((resolve, reject) => {
    let timeout: number | undefined
    const cleanup = () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Video seek failed'))
    }
    timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Video seek timeout'))
    }, timeoutMs)
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.currentTime = Math.min(Math.max(timeSec, 0), Math.max(video.duration - 1e-3, 0))
  })

const grayscale9x8FromCanvas = (sourceCanvas: HTMLCanvasElement): Uint8Array => {
  const tmp = document.createElement('canvas')
  tmp.width = 9
  tmp.height = 8
  const ctx = tmp.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, 9, 8)
  const data = ctx.getImageData(0, 0, 9, 8).data
  const gray = new Uint8Array(9 * 8)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  }
  return gray
}

export class VideoConverterPlugin implements FileFormatPlugin {
  id = 'video-converter'
  name = 'Video to DICOM Converter'
  version = '1.0.0'
  description = 'Converts video frames to DICOM Secondary Capture series'
  type = 'file-format' as const
  enabled = true
  supportedExtensions = ['.mp4', '.webm', '.ogv']
  supportedMimeTypes = ['video/mp4', 'video/webm', 'video/ogg']
  cli = {
    summary: 'Samples video frames into DICOM Secondary Capture instances.',
    docs: 'docs/cli.md#plugins',
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
        const url = URL.createObjectURL(file)
        try {
          const video = document.createElement('video')
          video.preload = 'metadata'
          video.src = url
          await waitForLoadedMetadata(video)
          return video.duration > 0
        } finally {
          URL.revokeObjectURL(url)
        }
      },
      catch: (error) => new PluginError({ message: `Failed to validate video file: ${file.name}`, pluginId, cause: error }),
    })
  }

  convertToDicom = (file: File, metadata: DicomMetadata, options?: VideoConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id
    const samplingStrategy = options?.samplingStrategy || 'interval'
    const intervalMs = options?.intervalMs ?? 1000
    const uniqueHammingThreshold = options?.uniqueHammingThreshold ?? 10
    const maxFrames = options?.maxFrames
    const seriesDescription = options?.seriesDescription || metadata.seriesDescription || 'Video Conversion'

    return Effect.gen(function* () {
      const objectUrl = yield* Effect.tryPromise({
        try: async () => URL.createObjectURL(file),
        catch: (error) => new PluginError({ message: `Failed to create object URL for ${file.name}`, pluginId, cause: error }),
      })

      try {
        const video = document.createElement('video')
        video.preload = 'auto'
        video.src = objectUrl
        video.muted = true
        yield* Effect.tryPromise({
          try: () => waitForLoadedMetadata(video),
          catch: (error) => new PluginError({ message: `Failed to load metadata for ${file.name}`, pluginId, cause: error }),
        })

        const [targetWidth, targetHeight] = computeTargetSize(video.videoWidth, video.videoHeight, options?.outputMaxWidth, options?.outputMaxHeight)
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')!
        const studyInstanceUID = metadata.studyInstanceUID || generateDicomUid()
        const seriesInstanceUID = metadata.seriesInstanceUID || generateDicomUid()
        const dicomFiles: DicomFile[] = []
        let frameIndex = 0
        let lastHash: bigint | undefined
        const stepSec = Math.max(intervalMs / 1000, 0.001)

        const capture = (timeSec: number) =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () => seekTo(video, Math.min(timeSec, video.duration)),
              catch: (error) => new PluginError({ message: `Seek failed at t=${timeSec.toFixed(3)}s for ${file.name}`, pluginId, cause: error }),
            })
            ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
            if (samplingStrategy === 'unique') {
              const hash = dHash64FromGrayscale9x8(grayscale9x8FromCanvas(canvas))
              if (lastHash !== undefined && hammingDistance64(hash, lastHash) < uniqueHammingThreshold) return
              lastHash = hash
            }
            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight)
            const dicomBuffer = yield* Effect.tryPromise({
              try: () => DicomDatasetBuilder.createDicomBuffer(targetWidth, targetHeight, rgbaToRgb(imageData.data), {
                ...metadata,
                studyInstanceUID,
                seriesInstanceUID,
                instanceNumber: frameIndex + 1,
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
              catch: (error) => new PluginError({ message: `Failed to create DICOM buffer for frame ${frameIndex + 1} (${file.name})`, pluginId, cause: error }),
            })
            frameIndex++
            dicomFiles.push({
              id: fileId('vid', frameIndex),
              fileName: file.name.replace(/\.(mp4|webm|ogv)$/i, '') + `_frame${frameIndex.toString().padStart(4, '0')}.dcm`,
              fileSize: dicomBuffer.byteLength,
              arrayBuffer: dicomBuffer,
              anonymized: false,
            })
          })

        for (let t = 0; t <= video.duration + 1e-3; t += stepSec) {
          if (maxFrames !== undefined && frameIndex >= maxFrames) break
          yield* capture(t)
        }
        if (samplingStrategy === 'unique' && (maxFrames === undefined || frameIndex < maxFrames)) {
          yield* capture(Math.max(0, video.duration - 1e-3))
        }

        return dicomFiles
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    })
  }
}

export const videoConverterPlugin = new VideoConverterPlugin()
