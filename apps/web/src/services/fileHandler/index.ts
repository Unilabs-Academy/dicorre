import { Effect, Context, Layer } from 'effect'
import { BlobReader, ZipReader } from '@zip.js/zip.js/index-native.js'
import { createExtractorFromData, type FileHeader, type UnrarError } from 'node-unrar-js/esm/index.esm.js'
import unrarWasmUrl from 'node-unrar-js/esm/js/unrar.wasm?url'
import * as dcmjs from 'dcmjs'
import type { DicomFile, DicomMetadata } from '@/types/dicom'
import { FileHandlerError, ValidationError, type FileHandlerErrorType } from '@/types/effects'
import { PluginRegistry } from '@/services/pluginRegistry'

export class FileHandler extends Context.Tag('FileHandler')<
  FileHandler,
  {
    readonly extractZipFile: (
      file: File,
      options?: { onProgress?: (completed: number, total: number, currentFile?: string) => void },
    ) => Effect.Effect<DicomFile[], FileHandlerErrorType>
    readonly extractRarFile: (
      file: File,
      options?: { onProgress?: (completed: number, total: number, currentFile?: string) => void },
    ) => Effect.Effect<DicomFile[], FileHandlerErrorType>
    readonly readSingleDicomFile: (file: File) => Effect.Effect<DicomFile, FileHandlerErrorType>
    readonly validateDicomFile: (
      arrayBuffer: ArrayBuffer,
      fileName: string,
    ) => Effect.Effect<boolean, ValidationError>
    readonly processFile: (file: File) => Effect.Effect<DicomFile[], FileHandlerErrorType>
  }
>() {}

/**
 * Live implementation layer
 */
export const FileHandlerLive = Layer.effect(
  FileHandler,
  Effect.gen(function* () {
    const registry = yield* PluginRegistry
    const ZIP_ENTRY_SKIP_EXTENSIONS = new Set([
      '.7z',
      '.bat',
      '.bmp',
      '.cfg',
      '.chk',
      '.chm',
      '.cmd',
      '.com',
      '.css',
      '.csv',
      '.def',
      '.dll',
      '.doc',
      '.docx',
      '.exe',
      '.gif',
      '.htm',
      '.html',
      '.inf',
      '.ini',
      '.jpeg',
      '.jpg',
      '.js',
      '.json',
      '.log',
      '.md',
      '.msg',
      '.msi',
      '.pdf',
      '.png',
      '.ppt',
      '.pptx',
      '.r00',
      '.rar',
      '.rtf',
      '.sh',
      '.svg',
      '.tar',
      '.tif',
      '.tiff',
      '.tmp',
      '.txt',
      '.xls',
      '.xlsx',
      '.xml',
      '.zip',
    ])
    const SYSTEM_FILE_PATTERNS = ['.ds_store', 'thumbs.db', 'desktop.ini', '.git', '.svn']
    const REQUIRED_DICOM_IDENTITY_TAGS = ['0020000D', '0020000E', '00080018'] as const

    type DicomDictEntry = { Value?: unknown[] }
    type DicomDict = Record<string, DicomDictEntry>

    const generateFileId = (): string => {
      return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }

    const truncateToDICOMLO = (value: string): string => {
      return value.length <= 64 ? value : value.slice(0, 64)
    }

    const createDefaultConversionMetadata = (file: File): DicomMetadata => {
      return {
        patientName: 'Converted^File',
        patientId: `CONV-${Date.now()}`,
        studyInstanceUID: `2.25.${Math.floor(Math.random() * 1e15)}`,
        seriesInstanceUID: `2.25.${Math.floor(Math.random() * 1e15)}`,
        sopInstanceUID: `2.25.${Math.floor(Math.random() * 1e15)}`,
        studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        modality: 'SC',
        studyDescription: truncateToDICOMLO(file.name),
        seriesDescription: 'File Conversion',
        instanceNumber: 1,
        transferSyntaxUID: '1.2.840.10008.1.2.1',
      }
    }

    const getFileExtension = (fileName: string): string => {
      const normalized = fileName.split('/').pop() || fileName
      const index = normalized.lastIndexOf('.')
      return index >= 0 ? normalized.slice(index).toLowerCase() : ''
    }

    const isSystemFile = (fileName: string): boolean => {
      const lowerFileName = fileName.toLowerCase()
      return SYSTEM_FILE_PATTERNS.some((sysFile) => lowerFileName.includes(sysFile))
    }

    const hasPart10Header = (arrayBuffer: ArrayBuffer): boolean => {
      if (arrayBuffer.byteLength < 132) {
        return false
      }

      const view = new DataView(arrayBuffer)
      const magic = String.fromCharCode(
        view.getUint8(128),
        view.getUint8(129),
        view.getUint8(130),
        view.getUint8(131),
      )

      return magic === 'DICM'
    }

    const detectObviousNonDicomSignature = (arrayBuffer: ArrayBuffer): string | null => {
      if (arrayBuffer.byteLength < 4) {
        return null
      }

      const bytes = new Uint8Array(arrayBuffer)

      if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
        return 'ZIP archive'
      }

      if (
        bytes[0] === 0x52 &&
        bytes[1] === 0x61 &&
        bytes[2] === 0x72 &&
        bytes[3] === 0x21
      ) {
        return 'RAR archive'
      }

      if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
        return 'Windows executable'
      }

      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'GIF image'
      }

      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'PNG image'
      }

      if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        return 'JPEG image'
      }

      if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        return 'PDF document'
      }

      return null
    }

    const hasRequiredDicomIdentity = (dict: DicomDict): boolean =>
      REQUIRED_DICOM_IDENTITY_TAGS.every((tag) => {
        const value = dict[tag]?.Value?.[0]
        return typeof value === 'string' && value.trim().length > 0
      })

    const shouldSkipArchiveEntryByName = (fileName: string): string | null => {
      if (isSystemFile(fileName)) {
        return 'system file'
      }

      const extension = getFileExtension(fileName)
      if (extension && ZIP_ENTRY_SKIP_EXTENSIONS.has(extension)) {
        return `unsupported ${extension} archive entry`
      }

      return null
    }

    const validateDicomFile = (
      arrayBuffer: ArrayBuffer,
      fileName: string,
    ): Effect.Effect<boolean, ValidationError> =>
      Effect.gen(function* () {
        if (arrayBuffer.byteLength === 0) {
          return yield* Effect.fail(
            new ValidationError({
              message: `File ${fileName} is empty`,
              fileName,
            }),
          )
        }

        if (isSystemFile(fileName)) {
          return yield* Effect.fail(
            new ValidationError({
              message: `File ${fileName} is a system file, not a DICOM file`,
              fileName,
            }),
          )
        }

        if (!hasPart10Header(arrayBuffer)) {
          return yield* Effect.fail(
            new ValidationError({
              message: `File ${fileName} does not have a valid DICOM Part 10 header`,
              fileName,
            }),
          )
        }

        const dict = yield* Effect.try({
          try: () => dcmjs.data.DicomMessage.readFile(arrayBuffer).dict as DicomDict,
          catch: (error) =>
            new ValidationError({
              message: `File ${fileName} could not be parsed as DICOM: ${error}`,
              fileName,
            }),
        })

        if (!hasRequiredDicomIdentity(dict)) {
          return yield* Effect.fail(
            new ValidationError({
              message: `File ${fileName} is missing required DICOM identity tags`,
              fileName,
            }),
          )
        }

        return true
      })

    const readSingleDicomFile = (file: File): Effect.Effect<DicomFile, FileHandlerErrorType> =>
      Effect.gen(function* () {
        const arrayBuffer = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (error) =>
            new FileHandlerError({
              message: `Failed to read file: ${file.name}`,
              fileName: file.name,
              cause: error,
            }),
        })

        // Validate that it's a DICOM file
        yield* validateDicomFile(arrayBuffer, file.name)

        return {
          id: generateFileId(),
          fileName: file.name,
          fileSize: file.size,
          arrayBuffer,
          anonymized: false,
        }
      })

    const formatFileSize = (bytes: number): string => {
      if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${bytes} bytes`
    }

    const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

    const createDicomFileFromArchiveEntry = (
      fileName: string,
      fileBuffer: ArrayBuffer,
    ): DicomFile => ({
      id: generateFileId(),
      fileName,
      fileSize: fileBuffer.byteLength,
      arrayBuffer: fileBuffer,
      anonymized: false,
    })

    const processArchiveEntryBuffer = (
      archiveType: 'ZIP' | 'RAR',
      entryName: string,
      fileBuffer: ArrayBuffer,
      counters: { skippedObvious: number; skippedAmbiguous: number; skippedInvalid: number },
    ): Effect.Effect<DicomFile | undefined, never> =>
      Effect.gen(function* () {
        const signatureReason = detectObviousNonDicomSignature(fileBuffer)
        if (signatureReason) {
          counters.skippedObvious++
          return undefined
        }

        const isDicom = yield* validateDicomFile(fileBuffer, entryName).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              if (error.message.includes('missing required DICOM identity tags')) {
                counters.skippedAmbiguous++
              } else {
                counters.skippedInvalid++
              }
              return false
            }),
          ),
        )

        if (!isDicom) return undefined

        console.log(`Accepted DICOM file from ${archiveType}: ${entryName}`)
        return createDicomFileFromArchiveEntry(entryName, fileBuffer)
      })

    let cachedUnrarWasmBinary: ArrayBuffer | undefined
    const loadUnrarWasmBinary = (): Effect.Effect<ArrayBuffer, FileHandlerError> =>
      Effect.tryPromise({
        try: async () => {
          if (cachedUnrarWasmBinary) return cachedUnrarWasmBinary

          if (import.meta.env.MODE === 'test') {
            const [{ readFile }, path] = await Promise.all([
              import('node:fs/promises'),
              import('node:path'),
            ])
            const wasmPath = unrarWasmUrl.startsWith('/@fs/')
              ? unrarWasmUrl.slice('/@fs'.length)
              : unrarWasmUrl.startsWith('/node_modules/')
              ? path.join(process.cwd(), unrarWasmUrl.slice(1))
              : unrarWasmUrl
            const bytes = await readFile(wasmPath)
            cachedUnrarWasmBinary = toArrayBuffer(bytes)
            return cachedUnrarWasmBinary
          }

          const response = await fetch(unrarWasmUrl)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} loading ${unrarWasmUrl}`)
          }
          cachedUnrarWasmBinary = await response.arrayBuffer()
          return cachedUnrarWasmBinary
        },
        catch: (error) =>
          new FileHandlerError({
            message: `Failed to load RAR extractor runtime: ${error instanceof Error ? error.message : String(error)}`,
            cause: error,
          }),
      })

    const isMultipartRarName = (fileName: string): boolean =>
      /\.part\d+\.rar$/i.test(fileName) || /\.r\d{2,}$/i.test(fileName)

    const formatRarReadError = (file: File, error: unknown): FileHandlerError => {
      const reason = (error as Partial<UnrarError>)?.reason
      const detail = error instanceof Error ? error.message : String(error)

      if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD') {
        return new FileHandlerError({
          message: `Encrypted RAR archives are not supported: ${file.name}`,
          fileName: file.name,
          cause: error,
        })
      }

      if (reason === 'ERAR_BAD_ARCHIVE' || reason === 'ERAR_UNKNOWN_FORMAT' || reason === 'ERAR_BAD_DATA') {
        return new FileHandlerError({
          message: `Failed to read RAR file: ${file.name} (${formatFileSize(file.size)}). The archive is corrupt or not a RAR file.`,
          fileName: file.name,
          cause: error,
        })
      }

      return new FileHandlerError({
        message: `Failed to read RAR file: ${file.name} (${formatFileSize(file.size)}). ${detail}`,
        fileName: file.name,
        cause: error,
      })
    }

    const extractZipFile = (
      file: File,
      options?: { onProgress?: (completed: number, total: number, currentFile?: string) => void },
    ): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
      Effect.gen(function* () {
        // Use zip.js BlobReader to stream directly from the File (which is a Blob)
        // This avoids loading the entire ZIP into memory as an ArrayBuffer,
        // which would fail for files >2GB due to browser ArrayBuffer size limits.
        const zipReader = yield* Effect.tryPromise({
          try: () => {
            const reader = new ZipReader(new BlobReader(file))
            return reader.getEntries()
          },
          catch: (error) =>
            new FileHandlerError({
              message: `Failed to read ZIP file: ${file.name} (${formatFileSize(file.size)}). ${error instanceof Error ? error.message : String(error)}`,
              fileName: file.name,
              cause: error,
            }),
        })

        // Filter out directories - narrows type to FileEntry which has getData/arrayBuffer
        const entries = zipReader.filter(
          (entry): entry is import('@zip.js/zip.js').FileEntry => !entry.directory,
        )
        console.log(`Found ${entries.length} potential files in ZIP archive`)

        if (entries.length === 0) {
          return []
        }

        const dicomFiles: DicomFile[] = []
        let completed = 0
        const total = entries.length
        const counters = {
          skippedObvious: 0,
          skippedAmbiguous: 0,
          skippedInvalid: 0,
        }

        // Process each entry - zip.js extracts one file at a time without loading the whole ZIP
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]

          const skipReason = shouldSkipArchiveEntryByName(entry.filename)
          if (skipReason) {
            counters.skippedObvious++
            completed++
            options?.onProgress?.(completed, total, entry.filename)
            continue
          }

          const fileBuffer = yield* Effect.tryPromise({
            try: () => entry.arrayBuffer(),
            catch: (error) =>
              new FileHandlerError({
                message: `Failed to extract file from ZIP: ${entry.filename}. ${error instanceof Error ? error.message : String(error)}`,
                fileName: entry.filename,
                cause: error,
              }),
          })

          const dicomFile = yield* processArchiveEntryBuffer('ZIP', entry.filename, fileBuffer, counters)

          if (dicomFile) {
            dicomFiles.push(dicomFile)
          }

          completed++
          // Report actual extraction progress
          options?.onProgress?.(completed, total, entry.filename)
        }

        console.log(
          `Extracted ${dicomFiles.length} DICOM files from ${entries.length} total files ` +
            `(skipped obvious=${counters.skippedObvious}, ambiguous=${counters.skippedAmbiguous}, invalid=${counters.skippedInvalid})`,
        )

        if (dicomFiles.length === 0) {
          return yield* Effect.fail(
            new FileHandlerError({
              message: `No valid DICOM files found in ZIP: ${file.name}`,
              fileName: file.name,
            }),
          )
        }

        return dicomFiles
      })

    const extractRarFile = (
      file: File,
      options?: { onProgress?: (completed: number, total: number, currentFile?: string) => void },
    ): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
      Effect.gen(function* () {
        if (isMultipartRarName(file.name)) {
          return yield* Effect.fail(
            new FileHandlerError({
              message: `Multi-part RAR archives are not supported: ${file.name}`,
              fileName: file.name,
            }),
          )
        }

        const archiveBuffer = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (error) =>
            new FileHandlerError({
              message: `Failed to read RAR file: ${file.name}`,
              fileName: file.name,
              cause: error,
            }),
        })

        const wasmBinary = yield* loadUnrarWasmBinary()

        const extractor = yield* Effect.tryPromise({
          try: () => createExtractorFromData({ data: archiveBuffer, wasmBinary }),
          catch: (error) => formatRarReadError(file, error),
        })

        const fileList = yield* Effect.try({
          try: () => extractor.getFileList(),
          catch: (error) => formatRarReadError(file, error),
        })

        if (fileList.arcHeader.flags.volume) {
          return yield* Effect.fail(
            new FileHandlerError({
              message: `Multi-part RAR archives are not supported: ${file.name}`,
              fileName: file.name,
            }),
          )
        }

        if (fileList.arcHeader.flags.headerEncrypted) {
          return yield* Effect.fail(
            new FileHandlerError({
              message: `Encrypted RAR archives are not supported: ${file.name}`,
              fileName: file.name,
            }),
          )
        }

        const headers = yield* Effect.try({
          try: () => [...fileList.fileHeaders],
          catch: (error) => formatRarReadError(file, error),
        })
        const entries = headers.filter((header) => !header.flags.directory)
        console.log(`Found ${entries.length} potential files in RAR archive`)

        if (entries.some((header) => header.flags.encrypted)) {
          return yield* Effect.fail(
            new FileHandlerError({
              message: `Encrypted RAR archives are not supported: ${file.name}`,
              fileName: file.name,
            }),
          )
        }

        if (entries.length === 0) {
          return []
        }

        const dicomFiles: DicomFile[] = []
        let completed = 0
        const total = entries.length
        const counters = {
          skippedObvious: 0,
          skippedAmbiguous: 0,
          skippedInvalid: 0,
        }
        const candidateHeaders: FileHeader[] = []

        for (const header of entries) {
          const skipReason = shouldSkipArchiveEntryByName(header.name)
          if (skipReason) {
            counters.skippedObvious++
            completed++
            options?.onProgress?.(completed, total, header.name)
            continue
          }
          candidateHeaders.push(header)
        }

        if (candidateHeaders.length === 0) {
          console.log(
            `Extracted 0 DICOM files from ${entries.length} total files ` +
              `(skipped obvious=${counters.skippedObvious}, ambiguous=${counters.skippedAmbiguous}, invalid=${counters.skippedInvalid})`,
          )
          return yield* Effect.fail(
            new FileHandlerError({
              message: `No valid DICOM files found in RAR: ${file.name}`,
              fileName: file.name,
            }),
          )
        }

        const extractedFiles = yield* Effect.try({
          try: () => [...extractor.extract({ files: candidateHeaders.map((header) => header.name) }).files],
          catch: (error) => formatRarReadError(file, error),
        })

        for (const extractedFile of extractedFiles) {
          const entryName = extractedFile.fileHeader.name
          const extraction = extractedFile.extraction

          if (!extraction) {
            counters.skippedInvalid++
            completed++
            options?.onProgress?.(completed, total, entryName)
            continue
          }

          const fileBuffer = toArrayBuffer(extraction)
          const dicomFile = yield* processArchiveEntryBuffer('RAR', entryName, fileBuffer, counters)

          if (dicomFile) {
            dicomFiles.push(dicomFile)
          }

          completed++
          options?.onProgress?.(completed, total, entryName)
        }

        console.log(
          `Extracted ${dicomFiles.length} DICOM files from ${entries.length} total files ` +
            `(skipped obvious=${counters.skippedObvious}, ambiguous=${counters.skippedAmbiguous}, invalid=${counters.skippedInvalid})`,
        )

        if (dicomFiles.length === 0) {
          return yield* Effect.fail(
            new FileHandlerError({
              message: `No valid DICOM files found in RAR: ${file.name}`,
              fileName: file.name,
            }),
          )
        }

        return dicomFiles
      })

    const processFile = (file: File): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
      Effect.gen(function* () {
        // Check if it's a ZIP file
        if (file.name.toLowerCase().endsWith('.zip')) {
          return yield* extractZipFile(file)
        }

        if (file.name.toLowerCase().endsWith('.rar')) {
          return yield* extractRarFile(file)
        }

        // Check if it's a DICOM file
        const isDicomFile =
          file.name.toLowerCase().endsWith('.dcm') ||
          file.name.toLowerCase().endsWith('.dicom') ||
          !file.name.includes('.')

        if (isDicomFile) {
          // Try to read as DICOM first
          const arrayBuffer = yield* Effect.tryPromise({
            try: () => file.arrayBuffer(),
            catch: (error) =>
              new FileHandlerError({
                message: `Failed to read file: ${file.name}`,
                fileName: file.name,
                cause: error,
              }),
          })

          const isValidDicom = yield* validateDicomFile(arrayBuffer, file.name).pipe(
            Effect.catchAll(() => Effect.succeed(false)),
          )

          if (isValidDicom) {
            const dicomFile = yield* readSingleDicomFile(file)
            return [dicomFile]
          }
        }

        // Not a DICOM file - check if any plugin can handle it
        const plugin = yield* registry
          .getPluginForFile(file)
          .pipe(Effect.catchAll(() => Effect.succeed(undefined)))

        if (plugin) {
          console.log(`Using plugin ${plugin.id} to process ${file.name}`)

          // Create complete metadata for file conversion - all required fields
          const defaultMetadata = createDefaultConversionMetadata(file)

          // Fetch plugin-specific settings if available
          const pluginSettings = yield* registry
            .getPluginSettings(plugin.id)
            .pipe(Effect.catchAll(() => Effect.succeed(undefined)))

          return yield* plugin.convertToDicom(file, defaultMetadata, pluginSettings as any).pipe(
            Effect.mapError(
              (error) =>
                new FileHandlerError({
                  message: `Plugin ${plugin.id} failed to convert ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
                  fileName: file.name,
                  cause: error,
                }),
            ),
          )
        }

        // No plugin found and not a recognized format
        // Get supported extensions dynamically
        const supportedExtensions = yield* registry
          .getSupportedExtensions()
          .pipe(Effect.catchAll(() => Effect.succeed(['.zip', '.rar', '.dcm', '.dicom'])))

        const extensionsList = supportedExtensions.join(', ')
        return yield* Effect.fail(
          new FileHandlerError({
            message: `File ${file.name} has unsupported format. Only DICOM files (.dcm), ZIP/RAR archives, and supported formats (${extensionsList}) are accepted`,
            fileName: file.name,
          }),
        )
      })

    return {
      extractZipFile,
      extractRarFile,
      readSingleDicomFile,
      validateDicomFile,
      processFile,
    } as const
  }),
)
