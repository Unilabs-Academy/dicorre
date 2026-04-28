/**
 * Test layers for isolated testing (without dependencies)
 */

import { Effect, Layer, Stream } from "effect"
import { ConfigService } from '../config'
import { FileHandler } from '../fileHandler'
import { OPFSStorage } from '../opfsStorage'
import { PluginRegistry } from '../pluginRegistry'
import { Anonymizer } from '../anonymizer'
import { FileHandlerError, ValidationError } from '@/types/effects'
import type { AppConfig } from '../config/schema'
import type { DicomFile } from '@/types/dicom'

export const TestConfigLayer = Layer.succeed(
  ConfigService,
  ConfigService.of({
    getServerConfig: Effect.succeed({
      url: 'http://localhost:8042',
      description: 'Test server'
    }),
    getAnonymizationConfig: Effect.succeed({
      profileOptions: ['BasicProfile'],
      removePrivateTags: true,
      useCustomHandlers: true,
      uidStrategy: 'perRun',
      dateJitterDays: 31,
      organizationRoot: '1.2.826.0.1.3680043.8.498',
      preserveTags: [
        'Instance Number',
        'Modality',
        'Manufacturer',
        'Protocol Name'
      ],
      tagsToRemove: [
        'startswith:IssueDate',
        'contains:Trial',
        'startswith:PatientTelephoneNumber'
      ],
      replacements: {
        'default': 'REMOVED',
        'Accession Number': 'ACA{random}',
        'Patient ID': 'PAT{random}'
      }
    }),
    validateConfig: (config: unknown) => Effect.succeed(config as AppConfig),
    loadConfig: (_configData: unknown) => Effect.succeed(undefined),
    getCurrentConfig: Effect.succeed({
      dicomServer: {
        url: 'http://localhost:8042',
        description: 'Test server'
      },
      anonymization: {
        profileOptions: ['BasicProfile'],
        removePrivateTags: true,
        useCustomHandlers: true,
        uidStrategy: 'perRun',
        dateJitterDays: 31,
        organizationRoot: '1.2.826.0.1.3680043.8.498',
        preserveTags: [
          'Instance Number',
          'Modality',
          'Manufacturer',
          'Protocol Name'
        ],
        tagsToRemove: [
          'startswith:IssueDate',
          'contains:Trial',
          'startswith:PatientTelephoneNumber'
        ],
        replacements: {
          'default': 'REMOVED',
          'Accession Number': 'ACA{random}',
          'Patient ID': 'PAT{random}'
        }
      }
    }),
    getCurrentProject: Effect.succeed(undefined),
    createProject: (name: string) => Effect.succeed({
      name,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    }),
    updateProject: (_project) => Effect.succeed(undefined),
    clearProject: Effect.succeed(undefined),
    configChanges: Stream.empty
  })
)

export const TestPluginRegistryLayer = Layer.succeed(
  PluginRegistry,
  PluginRegistry.of({
    registerPlugin: () => Effect.succeed(undefined),
    unregisterPlugin: () => Effect.succeed(undefined),
    getPlugin: () => Effect.succeed(undefined),
    getAllPlugins: () => Effect.succeed([]),
    getFileFormatPlugins: () => Effect.succeed([]),
    getHookPlugins: () => Effect.succeed([]),
    getPluginForFile: () => Effect.succeed(undefined),
    getSupportedExtensions: () => Effect.succeed(['.zip', '.rar', '.dcm', '.dicom']),
    getSupportedMimeTypes: () => Effect.succeed(['application/zip', 'application/vnd.rar', 'application/x-rar-compressed']),
    enablePlugin: () => Effect.succeed(undefined),
    disablePlugin: () => Effect.succeed(undefined),
    loadPluginConfig: () => Effect.succeed(undefined),
    getPluginSettings: () => Effect.succeed(undefined)
  })
)

export const TestFileHandlerLayer = Layer.succeed(
  FileHandler,
  FileHandler.of({
    extractZipFile: (_file: File) => Effect.succeed([]),
    extractRarFile: (_file: File) => Effect.succeed([]),
    readSingleDicomFile: (file: File) => Effect.tryPromise({
      try: async () => {
        const arrayBuffer = await file.arrayBuffer()
        return {
          id: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          fileName: file.name,
          fileSize: file.size,
          arrayBuffer,
          anonymized: false
        }
      },
      catch: (error) => new FileHandlerError({
        message: `Failed to read file: ${file.name}`,
        fileName: file.name,
        cause: error
      })
    }),
    validateDicomFile: (arrayBuffer: ArrayBuffer, fileName: string) =>
      Effect.sync(() => {
        if (arrayBuffer.byteLength === 0) {
          throw new ValidationError({
            message: `File ${fileName} is empty`,
            fileName
          })
        }

        const view = new DataView(arrayBuffer)

        // Method 1: Check for DICOM magic number "DICM" at position 128
        if (arrayBuffer.byteLength > 132) {
          try {
            const magic = String.fromCharCode(
              view.getUint8(128),
              view.getUint8(129),
              view.getUint8(130),
              view.getUint8(131)
            )

            if (magic === 'DICM') {
              return true
            }
          } catch (error) {
            throw new ValidationError({
              message: `Error reading DICOM magic number in ${fileName} - ${error}`,
              fileName,
            })
          }
        }

        // Method 2: Check for common DICOM file extensions
        const ext = fileName.split('.').pop()?.toLowerCase() || ''
        if (['dcm', 'dicom', 'dic'].includes(ext)) {
          return true
        }

        // Method 3: For files without extensions, be more permissive
        if (!fileName.includes('.') && arrayBuffer.byteLength > 1000) {
          try {
            // Look for DICOM group/element tags at the beginning
            const group1 = view.getUint16(0, true)

            // Common starting tags for DICOM files
            if (
              (group1 === 0x0008) || // Identifying Information
              (group1 === 0x0010) || // Patient Information
              (group1 === 0x0018) || // Acquisition Information
              (group1 === 0x0020) || // Relationship Information
              (group1 === 0x0002)    // File Meta Information
            ) {
              return true
            }

            // Also check a few bytes in for implicit VR files
            if (arrayBuffer.byteLength > 16) {
              const group2 = view.getUint16(8, true)

              if (
                (group2 === 0x0008) ||
                (group2 === 0x0010) ||
                (group2 === 0x0018) ||
                (group2 === 0x0020)
              ) {
                return true
              }
            }
          } catch (error) {
            throw new ValidationError({
              message: `Error checking DICOM patterns in ${fileName} - ${error}`,
              fileName,
            })
          }
        }

        return false
      }),
    processFile: (_file: File) => Effect.succeed([])
  })
)

export const TestOPFSStorageLayer = Layer.succeed(
  OPFSStorage,
  OPFSStorage.of({
    saveFile: (_fileId: string, _arrayBuffer: ArrayBuffer) => Effect.succeed(undefined),
    loadFile: (_fileId: string) => Effect.succeed(new ArrayBuffer(100)),
    fileExists: (_fileId: string) => Effect.succeed(true),
    deleteFile: (_fileId: string) => Effect.succeed(undefined),
    listFiles: Effect.succeed([]),
    clearAllFiles: Effect.succeed(undefined),
    getStorageInfo: Effect.succeed({ used: 0, quota: 1000 })
  })
)

/**
 * Mock Anonymizer for testing - no DicomProcessor dependency needed!
 * This demonstrates the benefit of removing requirement leakage:
 * we can easily create test implementations without internal dependencies.
 */
export const TestAnonymizerLayer = Layer.succeed(
  Anonymizer,
  {
    createStudyContext: (studyId, config, options = {}) => ({
      studyId,
      config,
      sharedRandom: 'TESTCTX',
      patientIdMap: options.patientIdMap,
      overrides: options.overrides,
    }),

    anonymizeFile: (file: DicomFile, _config) =>
      Effect.succeed({
        ...file,
        anonymized: true,
        metadata: file.metadata ? {
          ...file.metadata,
          patientName: 'TEST_ANONYMOUS',
          patientId: 'TEST_ID',
          accessionNumber: 'TEST_ACC'
        } : undefined
      } as DicomFile),

    anonymizeFileInStudyContext: (file: DicomFile) =>
      Effect.succeed({
        ...file,
        anonymized: true,
        metadata: file.metadata ? {
          ...file.metadata,
          patientName: 'TEST_ANONYMOUS',
          patientId: 'TEST_ID',
          accessionNumber: 'TEST_ACC'
        } : undefined
      } as DicomFile),

    anonymizeStudy: (studyId, files) =>
      Effect.succeed({
        studyId,
        anonymizedFiles: files.map(f => ({ ...f, anonymized: true })),
        totalFiles: files.length,
        completedFiles: files.length
      })
  } as const
)

/**
 * Combined test layers for convenience
 */
export const TestBaseLayer = Layer.mergeAll(
  TestConfigLayer,
  TestPluginRegistryLayer,
  TestOPFSStorageLayer,
  TestAnonymizerLayer
)

export const TestLayer = Layer.mergeAll(
  TestBaseLayer,
  TestFileHandlerLayer
)
