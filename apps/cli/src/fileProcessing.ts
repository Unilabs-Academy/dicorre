import { File as NodeFile } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Effect } from 'effect'
import JSZip from 'jszip'
import { createDefaultConversionMetadata } from '@dicorre/plugins/common/metadata'
import { PluginRegistry } from '@dicorre/shared/services/pluginRegistry'
import type { FileHeader, UnrarError } from 'node-unrar-js'
import type { DicomFile } from '@dicorre/shared/types/dicom'
import { FileHandlerError, type FileHandlerErrorType } from '@dicorre/shared/types/effects'

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

const mimeTypeForExtension = (ext: string): string => {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.bmp':
      return 'image/bmp'
    case '.pdf':
      return 'application/pdf'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.ogv':
      return 'video/ogg'
    default:
      return ''
  }
}

const convertWithPlugin = (filePath: string): Effect.Effect<DicomFile[], FileHandlerErrorType, PluginRegistry> =>
  Effect.gen(function* () {
    const registry = yield* PluginRegistry
    const bytes = yield* Effect.tryPromise({
      try: () => readFile(filePath),
      catch: (error) => new FileHandlerError({ message: `Failed to read file: ${filePath}`, fileName: filePath, cause: error }),
    })
    const fileName = path.basename(filePath)
    const nodeFile = new NodeFile([bytes], fileName, { type: mimeTypeForExtension(extensionOf(filePath)) }) as unknown as File
    const plugin = yield* registry
      .getPluginForFile(nodeFile)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)))

    if (!plugin) return []

    const pluginSettings = yield* registry
      .getPluginSettings(plugin.id)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    const settings = pluginSettings as Record<string, unknown> | undefined
    const metadata = createDefaultConversionMetadata(fileName, {
      modality: typeof settings?.defaultModality === 'string' ? settings.defaultModality : undefined,
      seriesDescription:
        typeof settings?.seriesDescription === 'string'
          ? settings.seriesDescription
          : typeof settings?.defaultSeriesDescription === 'string'
            ? settings.defaultSeriesDescription
            : undefined,
    })

    return yield* plugin.convertToDicom(nodeFile, metadata, pluginSettings).pipe(
      Effect.mapError((error) => new FileHandlerError({
        message: `Plugin ${plugin.id} failed to convert ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        fileName: filePath,
        cause: error,
      })),
    )
  })

const readPathFile = (filePath: string, options: ProcessPathOptions): Effect.Effect<DicomFile[], FileHandlerErrorType, PluginRegistry> =>
  Effect.gen(function* () {
    const ext = extensionOf(filePath)
    if (ext === '.zip') return yield* extractZip(filePath, options)
    if (ext === '.rar') return yield* extractRar(filePath, options)

    if (!options.includeConverted) {
      return !looksLikeDicomName(filePath) || isSystemFile(filePath) ? [] : yield* readDicomPathFile(filePath)
    }

    const converted = yield* convertWithPlugin(filePath)
    if (converted.length > 0) return converted

    if (!looksLikeDicomName(filePath) || isSystemFile(filePath)) return []
    return yield* readDicomPathFile(filePath)
  })

const readDicomPathFile = (filePath: string): Effect.Effect<DicomFile[], FileHandlerErrorType> =>
  Effect.gen(function* () {
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
): Effect.Effect<DicomFile[], FileHandlerErrorType, PluginRegistry> =>
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
