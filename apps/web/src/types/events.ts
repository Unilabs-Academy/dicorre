import type { DicomFile, DicomStudy } from './dicom'

// Anonymization Events
export type AnonymizationEvent = 
  | { readonly _tag: "AnonymizationStarted"; readonly studyId: string; readonly totalFiles: number }
  | { readonly _tag: "AnonymizationProgress"; readonly studyId: string; readonly completed: number; readonly total: number; readonly currentFile?: string }
  | { readonly _tag: "FileAnonymized"; readonly studyId: string; readonly file: DicomFile }
  | { readonly _tag: "StudyAnonymized"; readonly studyId: string; readonly files: DicomFile[] }
  | { readonly _tag: "AnonymizationError"; readonly studyId: string; readonly error: Error }

// Sending Events  
export type SendingEvent =
  | { readonly _tag: "SendingStarted"; readonly studyId: string; readonly totalFiles: number }
  | { readonly _tag: "SendingProgress"; readonly studyId: string; readonly completed: number; readonly total: number; readonly currentFile?: string }
  | { readonly _tag: "FileSent"; readonly studyId: string; readonly file: DicomFile }
  | { readonly _tag: "StudySent"; readonly studyId: string; readonly files: DicomFile[] }
  | { readonly _tag: "SendingError"; readonly studyId: string; readonly error: Error }

// File Processing Events
export type FileProcessingEvent =
  | { readonly _tag: "ProcessingStarted"; readonly totalFiles: number }
  | { readonly _tag: "ProcessingProgress"; readonly completed: number; readonly total: number; readonly currentFile: string }
  | { readonly _tag: "FileProcessed"; readonly file: DicomFile }
  | { readonly _tag: "StudiesUpdated"; readonly studies: DicomStudy[] }
  | { readonly _tag: "ProcessingCompleted"; readonly files: DicomFile[]; readonly studies: DicomStudy[] }
  | { readonly _tag: "ProcessingError"; readonly error: Error }

// Union of all event types
export type AppEvent = AnonymizationEvent | SendingEvent | FileProcessingEvent