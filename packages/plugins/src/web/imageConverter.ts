import { Effect } from 'effect'
import type { FileFormatPlugin, ConversionOptions } from '@dicorre/shared/types/plugins'
import type { DicomFile, DicomMetadata } from '@dicorre/shared/types/dicom'
import { PluginError } from '@dicorre/shared/types/effects'
import { DicomDatasetBuilder } from '@dicorre/shared/utils/dicomDatasetBuilder'
import { fileId } from '../common/metadata'

export class ImageConverterPlugin implements FileFormatPlugin {
  id = 'image-converter'
  name = 'Image to DICOM Converter'
  version = '1.0.0'
  description = 'Converts JPG, PNG, and BMP images to DICOM Secondary Capture format'
  type = 'file-format' as const
  enabled = true
  supportedExtensions = ['.jpg', '.jpeg', '.png', '.bmp']
  supportedMimeTypes = ['image/jpeg', 'image/png', 'image/bmp']
  cli = {
    summary: 'Converts image pixels into Secondary Capture DICOM instances.',
    docs: 'docs/cli.md#plugins',
  }

  canProcess = (file: File): Effect.Effect<boolean, PluginError> =>
    Effect.sync(() => {
      const fileExtension = `.${file.name.split('.').pop()?.toLowerCase()}`
      return this.supportedExtensions.includes(fileExtension) || (!!file.type && this.supportedMimeTypes.includes(file.type))
    })

  validateFile = (file: File): Effect.Effect<boolean, PluginError> => {
    const pluginId = this.id
    return Effect.gen(function* () {
      if (file.size === 0) {
        return yield* Effect.fail(new PluginError({ message: `File ${file.name} is empty`, pluginId }))
      }

      return yield* Effect.tryPromise({
        try: async () => new Promise<boolean>((resolve) => {
          const img = new Image()
          img.onload = () => resolve(true)
          img.onerror = () => resolve(false)
          img.src = URL.createObjectURL(file)
        }),
        catch: (error) => new PluginError({ message: `Failed to validate image file: ${file.name}`, pluginId, cause: error }),
      })
    })
  }

  convertToDicom = (file: File, metadata: DicomMetadata, _options?: ConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id

    return Effect.gen(function* () {
      const imageDataUrl = yield* Effect.tryPromise({
        try: () => ImageConverterPlugin.readFileAsDataURL(file),
        catch: (error) => new PluginError({ message: `Failed to read image file: ${file.name}`, pluginId, cause: error }),
      })

      const imageInfo = yield* Effect.tryPromise({
        try: () => ImageConverterPlugin.loadImage(imageDataUrl),
        catch: (error) => new PluginError({ message: `Failed to load image: ${file.name}`, pluginId, cause: error }),
      })

      const pixelData = yield* Effect.tryPromise({
        try: () => ImageConverterPlugin.getPixelData(imageInfo.img, imageInfo.width, imageInfo.height),
        catch: (error) => new PluginError({ message: `Failed to extract pixel data from image: ${file.name}`, pluginId, cause: error }),
      })

      const dicomBuffer = yield* Effect.tryPromise({
        try: () => DicomDatasetBuilder.createDicomBuffer(
          imageInfo.width,
          imageInfo.height,
          pixelData,
          metadata,
          {
            samplesPerPixel: 3,
            photometricInterpretation: 'RGB',
            bitsAllocated: 8,
            bitsStored: 8,
            highBit: 7,
            pixelRepresentation: 0,
            planarConfiguration: 0,
          },
        ),
        catch: (error) => new PluginError({ message: `Failed to create DICOM buffer for ${file.name}: ${error}`, pluginId, cause: error }),
      })

      return [{
        id: fileId('img'),
        fileName: file.name.replace(/\.(jpg|jpeg|png|bmp)$/i, '.dcm'),
        fileSize: dicomBuffer.byteLength,
        arrayBuffer: dicomBuffer,
        anonymized: false,
      }]
    })
  }

  private static readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => resolve(event.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  private static loadImage(dataUrl: string): Promise<{ img: HTMLImageElement; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ img, width: img.width, height: img.height })
      img.onerror = reject
      img.src = dataUrl
    })
  }

  private static getPixelData(img: HTMLImageElement, width: number, height: number): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, width, height)
      const rgbData = new Uint8Array(width * height * 3)
      let rgbIndex = 0
      for (let i = 0; i < imageData.data.length; i += 4) {
        rgbData[rgbIndex++] = imageData.data[i]
        rgbData[rgbIndex++] = imageData.data[i + 1]
        rgbData[rgbIndex++] = imageData.data[i + 2]
      }
      resolve(rgbData)
    })
  }
}

export const imageConverterPlugin = new ImageConverterPlugin()
