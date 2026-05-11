import { Effect } from 'effect'
import * as pdfjs from 'pdfjs-dist'
import 'pdfjs-dist/build/pdf.worker.min.mjs'
import type { FileFormatPlugin, ConversionOptions } from '@dicorre/shared/types/plugins'
import type { DicomFile, DicomMetadata } from '@dicorre/shared/types/dicom'
import { PluginError } from '@dicorre/shared/types/effects'
import { DicomDatasetBuilder } from '@dicorre/shared/utils/dicomDatasetBuilder'
import { fileId, generateDicomUid } from '../common/metadata'
import { rgbaToRgb } from '../common/pixels'

export class PdfConverterPlugin implements FileFormatPlugin {
  id = 'pdf-converter'
  name = 'PDF to DICOM Converter'
  version = '1.0.0'
  description = 'Converts PDF pages to DICOM Secondary Capture format as a series'
  type = 'file-format' as const
  enabled = true
  supportedExtensions = ['.pdf']
  supportedMimeTypes = ['application/pdf']
  cli = {
    summary: 'Converts each rendered PDF page into one DICOM instance in a series.',
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
      if (file.size === 0) return yield* Effect.fail(new PluginError({ message: `File ${file.name} is empty`, pluginId }))
      return yield* Effect.tryPromise({
        try: async () => {
          const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
          return pdf.numPages > 0
        },
        catch: (error) => new PluginError({ message: `Failed to validate PDF file: ${file.name}`, pluginId, cause: error }),
      })
    })
  }

  convertToDicom = (file: File, metadata: DicomMetadata, options?: ConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id
    return Effect.gen(function* () {
      const pdf = yield* Effect.tryPromise({
        try: async () => pdfjs.getDocument({ data: await file.arrayBuffer() }).promise,
        catch: (error) => new PluginError({ message: `Failed to load PDF file: ${file.name}`, pluginId, cause: error }),
      })

      const seriesInstanceUID = generateDicomUid()
      const studyInstanceUID = metadata.studyInstanceUID || generateDicomUid()
      const dicomFiles: DicomFile[] = []

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = yield* Effect.tryPromise({
          try: () => pdf.getPage(pageNum),
          catch: (error) => new PluginError({ message: `Failed to get page ${pageNum} from PDF: ${file.name}`, pluginId, cause: error }),
        })
        const viewport = page.getViewport({ scale: options?.scale || 1.5 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const context = canvas.getContext('2d')!
        yield* Effect.tryPromise({
          try: () => page.render({ canvasContext: context, viewport, canvas }).promise,
          catch: (error) => new PluginError({ message: `Failed to render page ${pageNum} from PDF: ${file.name}`, pluginId, cause: error }),
        })

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
        const pageMetadata: DicomMetadata = {
          ...metadata,
          studyInstanceUID,
          seriesInstanceUID,
          instanceNumber: pageNum,
          sopInstanceUID: generateDicomUid(),
          seriesDescription: `${metadata.seriesDescription || 'PDF Conversion'} - Page ${pageNum}`,
        }
        const dicomBuffer = yield* Effect.tryPromise({
          try: () => DicomDatasetBuilder.createDicomBuffer(canvas.width, canvas.height, rgbaToRgb(imageData.data), pageMetadata, {
            samplesPerPixel: 3,
            photometricInterpretation: 'RGB',
            bitsAllocated: 8,
            bitsStored: 8,
            highBit: 7,
            pixelRepresentation: 0,
            planarConfiguration: 0,
          }),
          catch: (error) => new PluginError({ message: `Failed to create DICOM buffer for page ${pageNum} of ${file.name}: ${error}`, pluginId, cause: error }),
        })
        dicomFiles.push({
          id: fileId('pdf', pageNum),
          fileName: file.name.replace(/\.pdf$/i, `_page${pageNum.toString().padStart(3, '0')}.dcm`),
          fileSize: dicomBuffer.byteLength,
          arrayBuffer: dicomBuffer,
          anonymized: false,
        })
      }
      return dicomFiles
    })
  }
}

export const pdfConverterPlugin = new PdfConverterPlugin()
