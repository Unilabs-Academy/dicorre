import { Effect } from "effect"
import type { FileFormatPlugin, ConversionOptions } from '@/types/plugins'
import type { DicomFile, DicomMetadata } from '@/types/dicom'
import { PluginError } from '@/types/effects'
import { DicomDatasetBuilder } from '@/utils/dicomDatasetBuilder'
import * as pdfjs from 'pdfjs-dist'
import "pdfjs-dist/build/pdf.worker.min.mjs"

// Helper function to ensure PDF.js is properly loaded
async function loadPdfJs() {
  return pdfjs
}

// UID generation function (from anonymizer handlers)
function generateUID(): string {
  // Generate a compliant DICOM UID using crypto.randomUUID()
  // Convert UUID to a numeric string and truncate to valid length
  const uuid = crypto.randomUUID().replace(/-/g, '')
  const bigintUid = parseInt(uuid.substring(0, 16), 16).toString()
  return `1.2.826.0.1.3680043.9.7.1.${bigintUid}`
}

/**
 * PDF to DICOM Secondary Capture Converter Plugin
 * Converts PDF files to DICOM Secondary Capture objects, with each page as a separate DICOM instance in a series
 */
export class PdfConverterPlugin implements FileFormatPlugin {
  id = 'pdf-converter'
  name = 'PDF to DICOM Converter'
  version = '1.0.0'
  description = 'Converts PDF pages to DICOM Secondary Capture format as a series'
  type = 'file-format' as const
  enabled = true

  supportedExtensions = ['.pdf']
  supportedMimeTypes = ['application/pdf']

  /* Check if this plugin can process the given file */
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

  /* Validate that the file is a valid PDF */
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

      // In browser environment, try to validate PDF
      return yield* Effect.tryPromise({
        try: async () => {
          const pdfLib = await loadPdfJs()
          const arrayBuffer = await file.arrayBuffer()
          const pdf = await pdfLib.getDocument({ data: arrayBuffer }).promise
          return pdf.numPages > 0
        },
        catch: (error) => new PluginError({
          message: `Failed to validate PDF file: ${file.name}`,
          pluginId,
          cause: error
        })
      })
    })
  }

  /* Convert PDF pages to DICOM Secondary Capture series */
  convertToDicom = (file: File, metadata: DicomMetadata, options?: ConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id

    return Effect.gen(function* () {

      const pdf = yield* Effect.tryPromise({
        try: async () => {
          const arrayBuffer = await file.arrayBuffer()
          return pdfjs.getDocument({ data: arrayBuffer }).promise
        },
        catch: (error) => new PluginError({
          message: `Failed to load PDF file: ${file.name}`,
          pluginId,
          cause: error
        })
      })

      console.log(`Converting PDF ${file.name} to DICOM series using PdfConverterPlugin`)

      // Generate series instance UID for all pages
      const seriesInstanceUID = generateUID()
      const studyInstanceUID = metadata.studyInstanceUID || generateUID()

      // Convert each page to DICOM
      const dicomFiles: DicomFile[] = []

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        console.log(`Processing page ${pageNum}/${pdf.numPages}`)

        // Get the PDF page
        const page = yield* Effect.tryPromise({
          try: () => pdf.getPage(pageNum),
          catch: (error) => new PluginError({
            message: `Failed to get page ${pageNum} from PDF: ${file.name}`,
            pluginId,
            cause: error
          })
        })

        // Create viewport with configurable scale (default 1.5 for good quality)
        const scale = options?.scale || 1.5
        const viewport = page.getViewport({ scale })

        // Create canvas with proper dimensions from PDF page
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const context = canvas.getContext('2d')!

        // Render PDF page to canvas using PDF.js
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          canvas: canvas
        }

        yield* Effect.tryPromise({
          try: () => page.render(renderContext).promise,
          catch: (error) => new PluginError({
            message: `Failed to render page ${pageNum} from PDF: ${file.name}`,
            pluginId,
            cause: error
          })
        })

        // Extract pixel data from rendered canvas
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
        const pixelData = PdfConverterPlugin.convertImageDataToRGB(imageData)

        // Create page-specific metadata
        const pageMetadata: DicomMetadata = {
          ...metadata,
          studyInstanceUID,
          seriesInstanceUID,
          instanceNumber: pageNum,
          sopInstanceUID: generateUID(),
          seriesDescription: `${metadata.seriesDescription || 'PDF Conversion'} - Page ${pageNum}`
        }

        console.log(`Creating DICOM buffer for page ${pageNum}...`)

        // Create DICOM buffer
        const dicomBuffer = yield* Effect.tryPromise({
          try: () => {
            console.log('Calling DicomDatasetBuilder.createDicomBuffer...')
            return DicomDatasetBuilder.createDicomBuffer(
              canvas.width,
              canvas.height,
              pixelData,
              pageMetadata,
              {
                samplesPerPixel: 3, // RGB
                photometricInterpretation: 'RGB',
                bitsAllocated: 8,
                bitsStored: 8,
                highBit: 7,
                pixelRepresentation: 0, // unsigned
                planarConfiguration: 0 // color-by-pixel
              }
            )
          },
          catch: (error) => {
            console.error(`DICOM buffer creation failed for page ${pageNum}:`, error)
            return new PluginError({
              message: `Failed to create DICOM buffer for page ${pageNum} of ${file.name}: ${error}`,
              pluginId,
              cause: error
            })
          }
        })

        console.log(`DICOM buffer created successfully for page ${pageNum}, size: ${dicomBuffer.byteLength}`)

        // Generate file ID
        const fileId = `pdf-${Date.now()}-${pageNum}-${Math.random().toString(36).substr(2, 9)}`

        // Create DicomFile object
        const dicomFile: DicomFile = {
          id: fileId,
          fileName: file.name.replace(/\.pdf$/i, `_page${pageNum.toString().padStart(3, '0')}.dcm`),
          fileSize: dicomBuffer.byteLength,
          arrayBuffer: dicomBuffer,
          anonymized: false
        }

        dicomFiles.push(dicomFile)
        console.log(`Successfully converted page ${pageNum} to DICOM (${dicomBuffer.byteLength} bytes)`)
      }

      console.log(`Successfully converted PDF ${file.name} to ${dicomFiles.length} DICOM files`)
      console.log('Returning DICOM files:', dicomFiles.map(f => f.fileName))
      return dicomFiles
    })
  }

  /**
   * Convert ImageData to RGB pixel data
   */
  private static convertImageDataToRGB(imageData: ImageData): Uint8Array {
    const rgbData = new Uint8Array(imageData.width * imageData.height * 3)
    let rgbIndex = 0

    for (let i = 0; i < imageData.data.length; i += 4) {
      rgbData[rgbIndex++] = imageData.data[i]     // R
      rgbData[rgbIndex++] = imageData.data[i + 1] // G
      rgbData[rgbIndex++] = imageData.data[i + 2] // B
      // Skip alpha channel
    }

    return rgbData
  }
}

// Export singleton instance
export const pdfConverterPlugin = new PdfConverterPlugin()
