import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Effect } from 'effect'
import JSZip from 'jszip'
import type { FileHeader, UnrarError } from 'node-unrar-js'
import type { DicomFile, DicomMetadata } from '@dicorre/shared/types/dicom'
import { FileHandlerError, type FileHandlerErrorType } from '@dicorre/shared/types/effects'
import { DicomDatasetBuilder } from '@dicorre/shared/utils/dicomDatasetBuilder'

export interface ProcessPathOptions {
  readonly includeConverted?: boolean
  readonly onProgress?: (message: string) => void
}

const require = createRequire(import.meta.url)
const { createExtractorFromData } = require('node-unrar-js') as typeof import('node-unrar-js')

const SKIP_EXTENSIONS = new Set([
  '.7z',
  '.bat',
  '.cfg',
  '.css',
  '.csv',
  '.dll',
  '.doc',
  '.docx',
  '.exe',
  '.gif',
  '.htm',
  '.html',
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

const CONVERTIBLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.pdf', '.mp4', '.webm', '.ogv'])
const SYSTEM_FILE_PATTERNS = ['.ds_store', 'thumbs.db', 'desktop.ini', '.git', '.svn']

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const hashId = (input: string): string =>
  `file-${createHash('sha1').update(input).digest('hex').slice(0, 16)}`

const extensionOf = (fileName: string): string => path.extname(fileName).toLowerCase()

const isSystemFile = (fileName: string): boolean => {
  const lower = fileName.toLowerCase()
  return SYSTEM_FILE_PATTERNS.some((pattern) => lower.includes(pattern))
}

const looksLikeDicomName = (fileName: string): boolean => {
  const ext = extensionOf(fileName)
  return ext === '.dcm' || ext === '.dicom' || ext === ''
}

const shouldSkipArchiveEntry = (fileName: string): boolean => {
  if (isSystemFile(fileName)) return true
  const ext = extensionOf(fileName)
  return ext.length > 0 && SKIP_EXTENSIONS.has(ext)
}

const defaultConversionMetadata = (fileName: string, kind: string): DicomMetadata => {
  const base = path.basename(fileName)
  const uidSuffix = randomUUID().replace(/-/g, '').slice(0, 24)
  return {
    patientName: 'Converted^File',
    patientId: `CONV-${Date.now()}`,
    studyInstanceUID: `2.25.${BigInt(`0x${uidSuffix}`).toString()}`,
    seriesInstanceUID: `2.25.${BigInt(`0x${uidSuffix.slice(0, 16)}`).toString()}`,
    sopInstanceUID: `2.25.${BigInt(`0x${uidSuffix.slice(8, 24)}`).toString()}`,
    studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    modality: 'SC',
    studyDescription: base.slice(0, 64),
    seriesDescription: `${kind} Conversion`,
    instanceNumber: 1,
    transferSyntaxUID: '1.2.840.10008.1.2.1',
  }
}

const createPlaceholderConvertedDicom = (
  fileName: string,
  sourceSize: number,
): Effect.Effect<DicomFile, FileHandlerErrorType> =>
  Effect.gen(function* () {
    const ext = extensionOf(fileName)
    const kind = ext === '.pdf' ? 'PDF' : ext === '.mp4' || ext === '.webm' || ext === '.ogv' ? 'Video' : 'Image'
    const width = 64
    const height = 64
    const pixelData = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 3
        pixelData[offset] = (x * 4) % 256
        pixelData[offset + 1] = (y * 4) % 256
        pixelData[offset + 2] = kind === 'PDF' ? 220 : kind === 'Video' ? 120 : 60
      }
    }

    const buffer = yield* Effect.tryPromise({
      try: () => DicomDatasetBuilder.createDicomBuffer(
        width,
        height,
        pixelData,
        defaultConversionMetadata(fileName, kind),
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
      catch: (error) => new FileHandlerError({
        message: `Failed to convert ${fileName} to DICOM: ${error instanceof Error ? error.message : String(error)}`,
        fileName,
        cause: error,
      }),
    })

    return {
      id: hashId(`${fileName}:${sourceSize}:${buffer.byteLength}`),
      fileName: path.basename(fileName).replace(/\.[^.]+$/u, '.dcm'),
      fileSize: buffer.byteLength,
      arrayBuffer: buffer,
      anonymized: false,
    }
  })

const dicomFileFromBuffer = (fileName: string, sourceKey: string, bytes: Uint8Array): DicomFile => {
  const arrayBuffer = toArrayBuffer(bytes)
  return {
    id: hashId(`${sourceKey}:${bytes.byteLength}`),
    fileName,
    fileSize: arrayBuffer.byteLength,
    arrayBuffer,
    anonymized: false,
  }
}

const readPathFile = (filePath: string, options: ProcessPathOptions): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
  Effect.gen(function* () {
    const ext = extensionOf(filePath)
    if (ext === '.zip') return yield* extractZip(filePath, options)
    if (ext === '.rar') return yield* extractRar(filePath, options)

    if (CONVERTIBLE_EXTENSIONS.has(ext)) {
      if (!options.includeConverted) return []
      const info = yield* Effect.tryPromise({
        try: () => stat(filePath),
        catch: (error) => new FileHandlerError({ message: `Failed to stat ${filePath}`, fileName: filePath, cause: error }),
      })
      return [yield* createPlaceholderConvertedDicom(filePath, info.size)]
    }

    if (!looksLikeDicomName(filePath) || isSystemFile(filePath)) return []

    const bytes = yield* Effect.tryPromise({
      try: () => readFile(filePath),
      catch: (error) => new FileHandlerError({ message: `Failed to read file: ${filePath}`, fileName: filePath, cause: error }),
    })
    return [dicomFileFromBuffer(path.basename(filePath), filePath, bytes)]
  })

const collectInputFiles = (inputPath: string): Effect.Effect<string[], FileHandlerErrorType> =>
  Effect.gen(function* () {
    const info = yield* Effect.tryPromise({
      try: () => stat(inputPath),
      catch: (error) => new FileHandlerError({ message: `Failed to access path: ${inputPath}`, fileName: inputPath, cause: error }),
    })

    if (info.isFile()) return [inputPath]
    if (!info.isDirectory()) return []

    const entries = yield* Effect.tryPromise({
      try: () => readdir(inputPath, { withFileTypes: true }),
      catch: (error) => new FileHandlerError({ message: `Failed to read directory: ${inputPath}`, fileName: inputPath, cause: error }),
    })

    const nested: string[] = []
    for (const entry of entries) {
      nested.push(...yield* collectInputFiles(path.join(inputPath, entry.name)))
    }
    return nested
  })

export const processInputPaths = (
  inputPaths: string[],
  options: ProcessPathOptions = {},
): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
  Effect.gen(function* () {
    const files: DicomFile[] = []
    for (const inputPath of inputPaths) {
      const paths = yield* collectInputFiles(path.resolve(inputPath))
      for (const filePath of paths) {
        options.onProgress?.(`Reading ${filePath}`)
        files.push(...yield* readPathFile(filePath, options))
      }
    }
    return files
  })

const extractZip = (zipPath: string, _options: ProcessPathOptions): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
  Effect.gen(function* () {
    const archiveBytes = yield* Effect.tryPromise({
      try: () => readFile(zipPath),
      catch: (error) => new FileHandlerError({ message: `Failed to read ZIP file: ${zipPath}`, fileName: zipPath, cause: error }),
    })
    const zip = yield* Effect.tryPromise({
      try: () => JSZip.loadAsync(archiveBytes),
      catch: (error) => new FileHandlerError({ message: `Failed to parse ZIP file: ${zipPath}`, fileName: zipPath, cause: error }),
    })

    const out: DicomFile[] = []
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || shouldSkipArchiveEntry(entry.name)) continue
      const data = yield* Effect.tryPromise({
        try: () => entry.async('uint8array'),
        catch: (error) => new FileHandlerError({ message: `Failed to extract ZIP entry: ${entry.name}`, fileName: entry.name, cause: error }),
      })
      out.push(dicomFileFromBuffer(entry.name, `${zipPath}:${entry.name}`, data))
    }
    return out
  })

let cachedUnrarWasmBinary: ArrayBuffer | undefined

const loadUnrarWasmBinary = (): Effect.Effect<ArrayBuffer, FileHandlerError> =>
  Effect.tryPromise({
    try: async () => {
      if (cachedUnrarWasmBinary) return cachedUnrarWasmBinary
      const wasmPath = require.resolve('node-unrar-js/esm/js/unrar.wasm')
      cachedUnrarWasmBinary = toArrayBuffer(await readFile(wasmPath))
      return cachedUnrarWasmBinary
    },
    catch: (error) => new FileHandlerError({
      message: `Failed to load RAR extractor runtime: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
    }),
  })

const formatRarReadError = (rarPath: string, error: unknown): FileHandlerError => {
  const reason = (error as Partial<UnrarError>)?.reason
  const detail = error instanceof Error ? error.message : String(error)
  if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD') {
    return new FileHandlerError({ message: `Encrypted RAR archives are not supported: ${rarPath}`, fileName: rarPath, cause: error })
  }
  return new FileHandlerError({ message: `Failed to read RAR file: ${rarPath}. ${detail}`, fileName: rarPath, cause: error })
}

const extractRar = (rarPath: string, _options: ProcessPathOptions): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
  Effect.gen(function* () {
    if (/\.part\d+\.rar$/i.test(rarPath) || /\.r\d{2,}$/i.test(rarPath)) {
      return yield* Effect.fail(new FileHandlerError({ message: `Multi-part RAR archives are not supported: ${rarPath}`, fileName: rarPath }))
    }

    const archiveBuffer = yield* Effect.tryPromise({
      try: async () => toArrayBuffer(await readFile(rarPath)),
      catch: (error) => new FileHandlerError({ message: `Failed to read RAR file: ${rarPath}`, fileName: rarPath, cause: error }),
    })
    const wasmBinary = yield* loadUnrarWasmBinary()
    const extractor = yield* Effect.tryPromise({
      try: () => createExtractorFromData({ data: archiveBuffer, wasmBinary }),
      catch: (error) => formatRarReadError(rarPath, error),
    })
    const fileList = yield* Effect.try({
      try: () => extractor.getFileList(),
      catch: (error) => formatRarReadError(rarPath, error),
    })
    if (fileList.arcHeader.flags.volume) {
      return yield* Effect.fail(new FileHandlerError({ message: `Multi-part RAR archives are not supported: ${rarPath}`, fileName: rarPath }))
    }
    if (fileList.arcHeader.flags.headerEncrypted) {
      return yield* Effect.fail(new FileHandlerError({ message: `Encrypted RAR archives are not supported: ${rarPath}`, fileName: rarPath }))
    }

    const headers = [...fileList.fileHeaders].filter((header) => !header.flags.directory && !shouldSkipArchiveEntry(header.name))
    if (headers.some((header) => header.flags.encrypted)) {
      return yield* Effect.fail(new FileHandlerError({ message: `Encrypted RAR archives are not supported: ${rarPath}`, fileName: rarPath }))
    }

    const extracted = yield* Effect.try({
      try: () => [...extractor.extract({ files: headers.map((header: FileHeader) => header.name) }).files],
      catch: (error) => formatRarReadError(rarPath, error),
    })

    return extracted.flatMap((file) => {
      if (!file.extraction) return []
      return [dicomFileFromBuffer(file.fileHeader.name, `${rarPath}:${file.fileHeader.name}`, file.extraction)]
    })
  })
