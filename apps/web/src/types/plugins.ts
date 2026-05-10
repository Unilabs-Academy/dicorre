import { Effect } from "effect"
import type { DicomFile, DicomStudy, DicomMetadata } from '@/types/dicom'
import type { PluginError } from '@/types/effects'

/**
 * Base plugin interface that all plugins must implement
 */
export interface Plugin {
  id: string
  name: string
  version: string
  description: string
  type: 'file-format' | 'hook'
  enabled?: boolean
}

/**
 * Options that can be passed to file format converters
 */
export interface ConversionOptions {
  patientName?: string
  patientId?: string
  studyDescription?: string
  seriesDescription?: string
  modality?: string
  accessionNumber?: string
  studyDate?: string
  [key: string]: any
}

/**
 * Plugin for converting various file formats to DICOM
 */
export interface FileFormatPlugin extends Plugin {
  type: 'file-format'

  /** File extensions this plugin can handle (e.g., ['.jpg', '.png']) */
  supportedExtensions: string[]

  /** MIME types this plugin can handle (e.g., ['image/jpeg', 'image/png']) */
  supportedMimeTypes?: string[]

  /** Check if this plugin can process a specific file */
  canProcess: (file: File) => Effect.Effect<boolean, PluginError>

  /** Convert the file to DICOM format */
  convertToDicom: (file: File, metadata: DicomMetadata, options?: ConversionOptions) => Effect.Effect<DicomFile[], PluginError>

  /** Validate that the file is valid for this converter */
  validateFile?: (file: File) => Effect.Effect<boolean, PluginError>
}

/**
 * Lifecycle hooks that plugins can implement
 */
export interface PluginHooks {
  /** Called before files are processed */
  beforeProcess?: (files: File[]) => Effect.Effect<void, PluginError, any>

  /** Called after files are processed */
  afterProcess?: (files: DicomFile[]) => Effect.Effect<void, PluginError, any>

  /** Called before anonymization */
  beforeAnonymize?: (files: DicomFile[]) => Effect.Effect<void, PluginError, any>

  /** Called after anonymization */
  afterAnonymize?: (files: DicomFile[]) => Effect.Effect<void, PluginError, any>

  /** Called before sending to DICOM server */
  beforeSend?: (study: DicomStudy) => Effect.Effect<void, PluginError, any>

  /** Called after successful send to DICOM server */
  afterSend?: (study: DicomStudy) => Effect.Effect<void, PluginError, any>

  /** Called if send fails */
  onSendError?: (study: DicomStudy, error: Error) => Effect.Effect<void, PluginError, any>
}

/**
 * Plugin that provides lifecycle hooks
 */
export interface HookPlugin extends Plugin {
  type: 'hook'
  hooks: PluginHooks
}

/**
 * Type guard for FileFormatPlugin
 */
export function isFileFormatPlugin(plugin: Plugin): plugin is FileFormatPlugin {
  return plugin.type === 'file-format'
}

/**
 * Type guard for HookPlugin
 */
export function isHookPlugin(plugin: Plugin): plugin is HookPlugin {
  return plugin.type === 'hook'
}

/**
 * Plugin manifest for registration
 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  type: 'file-format' | 'hook'
  main: string // Path to main plugin file
  config?: Record<string, any>
}

/**
 * Plugin configuration from app config
 */
export interface PluginConfig {
  enabled: string[]
  settings?: Record<string, any>
}
