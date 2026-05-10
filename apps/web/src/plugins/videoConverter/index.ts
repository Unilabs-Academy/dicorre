import { Effect } from "effect"
import type { FileFormatPlugin, ConversionOptions } from '@/types/plugins'
import type { DicomFile, DicomMetadata } from '@/types/dicom'
import { PluginError } from '@/types/effects'
import { DicomDatasetBuilder } from '@/utils/dicomDatasetBuilder'

type VideoConversionOptions = ConversionOptions & {
  samplingStrategy?: 'interval' | 'unique'
  intervalMs?: number
  uniqueHammingThreshold?: number
  maxFrames?: number
  outputMaxWidth?: number
  outputMaxHeight?: number
  seriesDescription?: string
}

function generateUID(): string {
  const uuid = crypto.randomUUID().replace(/-/g, '')
  const bigintUid = parseInt(uuid.substring(0, 16), 16).toString()
  return `1.2.826.0.1.3680043.9.7.1.${bigintUid}`
}

function imageDataToRGB(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData
  const rgb = new Uint8Array(width * height * 3)
  let j = 0
  for (let i = 0; i < data.length; i += 4) {
    rgb[j++] = data[i]
    rgb[j++] = data[i + 1]
    rgb[j++] = data[i + 2]
  }
  return rgb
}

function computeTargetSize(srcWidth: number, srcHeight: number, maxWidth?: number, maxHeight?: number): [number, number] {
  if (!maxWidth && !maxHeight) return [srcWidth, srcHeight]
  const aspect = srcWidth / srcHeight
  if (maxWidth && maxHeight) {
    // Fit within box
    let width = maxWidth
    let height = Math.round(width / aspect)
    if (height > maxHeight) {
      height = maxHeight
      width = Math.round(height * aspect)
    }
    return [width, height]
  }
  if (maxWidth) {
    const width = maxWidth
    const height = Math.round(width / aspect)
    return [width, height]
  }
  const height = maxHeight as number
  const width = Math.round(height * aspect)
  return [width, height]
}

function waitForLoadedMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isNaN(video.duration) && video.duration > 0) return resolve()
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
}

function seekTo(video: HTMLVideoElement, timeSec: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: number | undefined
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Video seek failed'))
    }
    const onTimeout = () => {
      cleanup()
      reject(new Error('Video seek timeout'))
    }
    const cleanup = () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    timeout = window.setTimeout(onTimeout, timeoutMs)
    const clamped = Math.min(Math.max(timeSec, 0), Math.max(video.duration - 1e-3, 0))
    video.currentTime = clamped
  })
}

function toGrayscale9x8FromCanvas(sourceCanvas: HTMLCanvasElement): Uint8Array {
  const tmp = document.createElement('canvas')
  tmp.width = 9
  tmp.height = 8
  const tctx = tmp.getContext('2d')!
  tctx.imageSmoothingEnabled = true
  tctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, 9, 8)
  const data = tctx.getImageData(0, 0, 9, 8).data
  const g = new Uint8Array(9 * 8)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    g[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  }
  return g
}

function computeDHash64(gray9x8: Uint8Array): bigint {
  let hash = 0n
  let bitIndex = 0n
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = gray9x8[row * 9 + col]
      const right = gray9x8[row * 9 + col + 1]
      if (left > right) hash |= (1n << bitIndex)
      bitIndex++
    }
  }
  return hash
}

function hammingDistance64(a: bigint, b: bigint): number {
  let x = a ^ b
  let count = 0
  while (x) {
    x &= (x - 1n)
    count++
  }
  return count
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

  canProcess = (file: File): Effect.Effect<boolean, PluginError> =>
    Effect.sync(() => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase()
      if (this.supportedExtensions.includes(ext)) return true
      if (file.type && this.supportedMimeTypes.includes(file.type)) return true
      return false
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
      catch: (error) => new PluginError({
        message: `Failed to validate video file: ${file.name}`,
        pluginId,
        cause: error
      })
    })
  }

  convertToDicom = (file: File, metadata: DicomMetadata, options?: VideoConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id
    const samplingStrategy = options?.samplingStrategy || 'interval'
    const intervalMs = options?.intervalMs ?? 1000
    const uniqueHammingThreshold = options?.uniqueHammingThreshold ?? 10
    const maxFrames = options?.maxFrames
    const outputMaxWidth = options?.outputMaxWidth
    const outputMaxHeight = options?.outputMaxHeight
    const seriesDescription = options?.seriesDescription || metadata.seriesDescription || 'Video Conversion'

    return Effect.gen(function* () {
      const objectUrl = yield* Effect.tryPromise({
        try: async () => URL.createObjectURL(file),
        catch: (error) => new PluginError({
          message: `Failed to create object URL for ${file.name}`,
          pluginId,
          cause: error
        })
      })

      try {
        const video = document.createElement('video')
        video.preload = 'auto'
        video.src = objectUrl
        video.muted = true

        yield* Effect.tryPromise({
          try: async () => waitForLoadedMetadata(video),
          catch: (error) => new PluginError({
            message: `Failed to load metadata for ${file.name}`,
            pluginId,
            cause: error
          })
        })

        const [targetWidth, targetHeight] = computeTargetSize(
          video.videoWidth,
          video.videoHeight,
          outputMaxWidth,
          outputMaxHeight
        )

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')!

        // Generate series and study UIDs if missing
        const studyInstanceUID = metadata.studyInstanceUID || generateUID()
        const seriesInstanceUID = metadata.seriesInstanceUID || generateUID()

        const dicomFiles: DicomFile[] = []
        let frameIndex = 0

        if (samplingStrategy === 'interval') {
          const duration = video.duration
          const stepSec = Math.max(intervalMs / 1000, 0.001)
          for (let t = 0; t <= duration + 1e-3; t += stepSec) {
            if (maxFrames !== undefined && frameIndex >= maxFrames) break
            yield* Effect.tryPromise({
              try: async () => seekTo(video, Math.min(t, duration)),
              catch: (error) => new PluginError({
                message: `Seek failed at t=${t.toFixed(3)}s for ${file.name}`,
                pluginId,
                cause: error
              })
            })

            ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight)
            const pixelData = imageDataToRGB(imageData)

            const dicomBuffer = yield* Effect.tryPromise({
              try: async () => DicomDatasetBuilder.createDicomBuffer(
                targetWidth,
                targetHeight,
                pixelData,
                {
                  ...metadata,
                  studyInstanceUID,
                  seriesInstanceUID,
                  instanceNumber: frameIndex + 1,
                  sopInstanceUID: generateUID(),
                  seriesDescription
                },
                {
                  samplesPerPixel: 3,
                  photometricInterpretation: 'RGB',
                  bitsAllocated: 8,
                  bitsStored: 8,
                  highBit: 7,
                  pixelRepresentation: 0,
                  planarConfiguration: 0
                }
              ),
              catch: (error) => new PluginError({
                message: `Failed to create DICOM buffer for frame ${frameIndex + 1} (${file.name})`,
                pluginId,
                cause: error
              })
            })

            const dicomFile: DicomFile = {
              id: `vid-${Date.now()}-${frameIndex + 1}-${Math.random().toString(36).substr(2, 9)}`,
              fileName: file.name.replace(/\.(mp4|webm|ogv)$/i, '') + `_frame${(frameIndex + 1).toString().padStart(4, '0')}.dcm`,
              fileSize: dicomBuffer.byteLength,
              arrayBuffer: dicomBuffer,
              anonymized: false
            }
            dicomFiles.push(dicomFile)
            frameIndex++
          }
        } else {
          const duration = video.duration
          const baseStepSec = Math.max((intervalMs ?? 500) / 1000, 0.001)
          let lastHash: bigint | undefined
          for (let t = 0; t <= duration + 1e-3; t += baseStepSec) {
            if (maxFrames !== undefined && frameIndex >= maxFrames) break
            yield* Effect.tryPromise({
              try: async () => seekTo(video, Math.min(t, duration)),
              catch: (error) => new PluginError({
                message: `Seek failed at t=${t.toFixed(3)}s for ${file.name}`,
                pluginId,
                cause: error
              })
            })

            ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
            const gray = toGrayscale9x8FromCanvas(canvas)
            const hash = computeDHash64(gray)

            let keep = false
            if (lastHash === undefined) keep = true
            else keep = hammingDistance64(hash, lastHash) >= uniqueHammingThreshold

            if (!keep) continue
            lastHash = hash

            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight)
            const pixelData = imageDataToRGB(imageData)

            const dicomBuffer = yield* Effect.tryPromise({
              try: async () => DicomDatasetBuilder.createDicomBuffer(
                targetWidth,
                targetHeight,
                pixelData,
                {
                  ...metadata,
                  studyInstanceUID,
                  seriesInstanceUID,
                  instanceNumber: frameIndex + 1,
                  sopInstanceUID: generateUID(),
                  seriesDescription
                },
                {
                  samplesPerPixel: 3,
                  photometricInterpretation: 'RGB',
                  bitsAllocated: 8,
                  bitsStored: 8,
                  highBit: 7,
                  pixelRepresentation: 0,
                  planarConfiguration: 0
                }
              ),
              catch: (error) => new PluginError({
                message: `Failed to create DICOM buffer for frame ${frameIndex + 1} (${file.name})`,
                pluginId,
                cause: error
              })
            })

            const dicomFile: DicomFile = {
              id: `vid-${Date.now()}-${frameIndex + 1}-${Math.random().toString(36).substr(2, 9)}`,
              fileName: file.name.replace(/\.(mp4|webm|ogv)$/i, '') + `_frame${(frameIndex + 1).toString().padStart(4, '0')}.dcm`,
              fileSize: dicomBuffer.byteLength,
              arrayBuffer: dicomBuffer,
              anonymized: false
            }
            dicomFiles.push(dicomFile)
            frameIndex++
          }
          // Ensure last frame is captured if loop missed end
          if (maxFrames === undefined || frameIndex < maxFrames) {
            yield* Effect.tryPromise({
              try: async () => seekTo(video, Math.max(0, video.duration - 1e-3)),
              catch: (error) => new PluginError({
                message: `Seek failed at end for ${file.name}`,
                pluginId,
                cause: error
              })
            })
            ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight)
            const pixelData = imageDataToRGB(imageData)
            const dicomBuffer = yield* Effect.tryPromise({
              try: async () => DicomDatasetBuilder.createDicomBuffer(
                targetWidth,
                targetHeight,
                pixelData,
                {
                  ...metadata,
                  studyInstanceUID,
                  seriesInstanceUID,
                  instanceNumber: frameIndex + 1,
                  sopInstanceUID: generateUID(),
                  seriesDescription
                },
                {
                  samplesPerPixel: 3,
                  photometricInterpretation: 'RGB',
                  bitsAllocated: 8,
                  bitsStored: 8,
                  highBit: 7,
                  pixelRepresentation: 0,
                  planarConfiguration: 0
                }
              ),
              catch: (error) => new PluginError({
                message: `Failed to create DICOM buffer for final frame (${file.name})`,
                pluginId,
                cause: error
              })
            })
            const dicomFile: DicomFile = {
              id: `vid-${Date.now()}-${frameIndex + 1}-${Math.random().toString(36).substr(2, 9)}`,
              fileName: file.name.replace(/\.(mp4|webm|ogv)$/i, '') + `_frame${(frameIndex + 1).toString().padStart(4, '0')}.dcm`,
              fileSize: dicomBuffer.byteLength,
              arrayBuffer: dicomBuffer,
              anonymized: false
            }
            dicomFiles.push(dicomFile)
            frameIndex++
          }
        }

        return dicomFiles
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    })
  }
}

export const videoConverterPlugin = new VideoConverterPlugin()


