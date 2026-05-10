import { Effect } from "effect"
import type { FileFormatPlugin, ConversionOptions } from '@/types/plugins'
import type { DicomFile, DicomMetadata } from '@/types/dicom'
import { PluginError } from '@/types/effects'
import { DicomDatasetBuilder } from '@/utils/dicomDatasetBuilder'

/**
 * Image to DICOM Secondary Capture Converter Plugin
 * Converts common image formats (JPG, PNG, BMP) to DICOM Secondary Capture objects
 */
export class ImageConverterPlugin implements FileFormatPlugin {
  id = 'image-converter'
  name = 'Image to DICOM Converter'
  version = '1.0.0'
  description = 'Converts JPG, PNG, and BMP images to DICOM Secondary Capture format'
  type = 'file-format' as const
  enabled = true

  supportedExtensions = ['.jpg', '.jpeg', '.png', '.bmp']
  supportedMimeTypes = ['image/jpeg', 'image/png', 'image/bmp']

  /* Check if the plugin can process given file */
  canProcess = (file: File): Effect.Effect<boolean, PluginError> =>
    Effect.sync(() => {
      // Check file extension
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
      if (this.supportedExtensions.includes(fileExtension)) {
        return true
      }

      // Check MIME type
      if (file.type && this.supportedMimeTypes.includes(file.type)) {
        return true
      }

      return false
    })

  /* Validate that the file is a valid image */
  validateFile = (file: File): Effect.Effect<boolean, PluginError> => {
    const pluginId = this.id
    return Effect.gen(function* () {
      // Basic validation - check file size
      if (file.size === 0) {
        return yield* Effect.fail(new PluginError({
          message: `File ${file.name} is empty`,
          pluginId
        }))
      }

      // Check if it's actually an image by trying to load it
      return yield* Effect.tryPromise({
        try: async () => {
          return new Promise<boolean>((resolve) => {
            const img = new Image()
            img.onload = () => resolve(true)
            img.onerror = () => resolve(false)
            img.src = URL.createObjectURL(file)
          })
        },
        catch: (error) => new PluginError({
          message: `Failed to validate image file: ${file.name}`,
          pluginId,
          cause: error
        })
      })
    })
  }

  /* Convert image to DICOM Secondary Capture */
  convertToDicom = (file: File, metadata: DicomMetadata, _options?: ConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id

    return Effect.gen(function* () {
      console.log(`Converting image ${file.name} to DICOM using ImageConverterPlugin`)

      // Load image data
      const imageDataUrl = yield* Effect.tryPromise({
        try: () => ImageConverterPlugin.readFileAsDataURL(file),
        catch: (error) => new PluginError({
          message: `Failed to read image file: ${file.name}`,
          pluginId,
          cause: error
        })
      })

      // Load image to get dimensions
      const imageInfo = yield* Effect.tryPromise({
        try: () => ImageConverterPlugin.loadImage(imageDataUrl),
        catch: (error) => new PluginError({
          message: `Failed to load image: ${file.name}`,
          pluginId,
          cause: error
        })
      }) as Effect.Effect<{ img: HTMLImageElement; width: number; height: number }, PluginError>

      // Convert image to pixel data
      const pixelData = yield* Effect.tryPromise({
        try: () => ImageConverterPlugin.getPixelData(imageInfo.img, imageInfo.width, imageInfo.height),
        catch: (error) => new PluginError({
          message: `Failed to extract pixel data from image: ${file.name}`,
          pluginId,
          cause: error
        })
      })

      // Create DICOM buffer using the utility (template-based approach)
      const dicomBuffer = yield* Effect.tryPromise({
        try: () => DicomDatasetBuilder.createDicomBuffer(
          imageInfo.width,
          imageInfo.height,
          pixelData,
          metadata,
          {
            samplesPerPixel: 3, // RGB
            photometricInterpretation: 'RGB',
            bitsAllocated: 8,
            bitsStored: 8,
            highBit: 7,
            pixelRepresentation: 0, // unsigned
            planarConfiguration: 0 // color-by-pixel
          }
        ),
        catch: (error) => new PluginError({
          message: `Failed to create DICOM buffer for ${file.name}: ${error}`,
          pluginId,
          cause: error
        })
      })

      // Generate file ID
      const fileId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      // Create DicomFile object
      const dicomFile: DicomFile = {
        id: fileId,
        fileName: file.name.replace(/\.(jpg|jpeg|png|bmp)$/i, '.dcm'),
        fileSize: dicomBuffer.byteLength,
        arrayBuffer: dicomBuffer,
        anonymized: false
      }

      console.log(`Successfully converted ${file.name} to DICOM (${dicomBuffer.byteLength} bytes)`)

      return [dicomFile]
    })
  }

  /* Read file as data URL */
  private static readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  /* Load image and get dimensions */
  private static loadImage(dataUrl: string): Promise<{ img: HTMLImageElement; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        resolve({
          img,
          width: img.width,
          height: img.height
        })
      }
      img.onerror = reject
      img.src = dataUrl
    })
  }

  /* Extract pixel data from image */
  private static getPixelData(img: HTMLImageElement, width: number, height: number): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!

      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, width, height)

      // Convert RGBA to RGB
      const rgbData = new Uint8Array(width * height * 3)
      let rgbIndex = 0

      for (let i = 0; i < imageData.data.length; i += 4) {
        rgbData[rgbIndex++] = imageData.data[i]     // R
        rgbData[rgbIndex++] = imageData.data[i + 1] // G
        rgbData[rgbIndex++] = imageData.data[i + 2] // B
        // Skip alpha channel
      }

      resolve(rgbData)
    })
  }

}

// Export singleton instance
export const imageConverterPlugin = new ImageConverterPlugin()
