import { Buffer } from 'node:buffer'
import { Effect } from 'effect'
import sharp from 'sharp'
import type { FileFormatPlugin, ConversionOptions } from '@dicorre/shared/types/plugins'
import type { DicomFile, DicomMetadata } from '@dicorre/shared/types/dicom'
import { PluginError } from '@dicorre/shared/types/effects'
import { DicomDatasetBuilder } from '@dicorre/shared/utils/dicomDatasetBuilder'
import { fileId } from '../common/metadata'

export class NodeImageConverterPlugin implements FileFormatPlugin {
  id = 'image-converter'
  name = 'Image to DICOM Converter'
  version = '1.0.0'
  description = 'Converts JPG, PNG, and BMP images to DICOM Secondary Capture format'
  type = 'file-format' as const
  enabled = true
  supportedExtensions = ['.jpg', '.jpeg', '.png', '.bmp']
  supportedMimeTypes = ['image/jpeg', 'image/png', 'image/bmp']
  cli = {
    summary: 'Uses sharp to decode image pixels and writes real Secondary Capture DICOM instances.',
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
        if (file.size === 0) return false
        const image = sharp(Buffer.from(await file.arrayBuffer()))
        const metadata = await image.metadata()
        return !!metadata.width && !!metadata.height
      },
      catch: (error) => new PluginError({ message: `Failed to validate image file: ${file.name}`, pluginId, cause: error }),
    })
  }

  convertToDicom = (file: File, metadata: DicomMetadata, _options?: ConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id
    return Effect.gen(function* () {
      const converted = yield* Effect.tryPromise({
        try: async () => {
          const { data, info } = await sharp(Buffer.from(await file.arrayBuffer()))
            .rotate()
            .removeAlpha()
            .toColorspace('srgb')
            .raw()
            .toBuffer({ resolveWithObject: true })
          return { data, width: info.width, height: info.height }
        },
        catch: (error) => new PluginError({ message: `Failed to decode image file: ${file.name}`, pluginId, cause: error }),
      })

      const dicomBuffer = yield* Effect.tryPromise({
        try: () => DicomDatasetBuilder.createDicomBuffer(converted.width, converted.height, new Uint8Array(converted.data), metadata, {
          samplesPerPixel: 3,
          photometricInterpretation: 'RGB',
          bitsAllocated: 8,
          bitsStored: 8,
          highBit: 7,
          pixelRepresentation: 0,
          planarConfiguration: 0,
        }),
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
}

export const nodeImageConverterPlugin = new NodeImageConverterPlugin()
