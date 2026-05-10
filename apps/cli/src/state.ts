import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DicomFile, DicomFileMetadata, DicomStudy } from '@dicorre/shared/types/dicom'

export interface CliState {
  readonly version: 1
  readonly files: DicomFileMetadata[]
  readonly studies: DicomStudy[]
}

export const emptyState = (): CliState => ({
  version: 1,
  files: [],
  studies: [],
})

const stripFileData = (file: DicomFile): DicomFileMetadata => ({
  id: file.id,
  fileName: file.fileName,
  fileSize: file.fileSize,
  metadata: file.metadata,
  anonymized: file.anonymized,
  sent: file.sent,
  opfsFileId: file.opfsFileId || file.id,
})

const stripStudyData = (study: DicomStudy): DicomStudy => ({
  ...study,
  series: study.series.map((series) => ({
    ...series,
    files: series.files.map((file) => ({
      ...file,
      arrayBuffer: new ArrayBuffer(0),
      opfsFileId: file.opfsFileId || file.id,
    })),
  })),
})

export const createState = (files: DicomFile[], studies: DicomStudy[]): CliState => ({
  version: 1,
  files: files.map(stripFileData),
  studies: studies.map(stripStudyData),
})

export const loadState = async (statePath: string): Promise<CliState> => {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as CliState
    return {
      version: 1,
      files: parsed.files ?? [],
      studies: parsed.studies ?? [],
    }
  } catch {
    return emptyState()
  }
}

export const saveState = async (statePath: string, state: CliState): Promise<void> => {
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

export const flattenStudyFiles = (studies: DicomStudy[]): DicomFile[] =>
  studies.flatMap((study) => study.series.flatMap((series) => series.files))

export const selectStudies = (studies: DicomStudy[], studyIds: string[]): DicomStudy[] => {
  if (studyIds.length === 0 || studyIds.includes('all')) return studies
  return studies.filter((study) => studyIds.includes(study.studyInstanceUID) || studyIds.includes(study.id))
}

export const mergeUpdatedFiles = (state: CliState, updatedFiles: DicomFile[]): CliState => {
  const byId = new Map(updatedFiles.map((file) => [file.id, file]))
  const files = state.files.map((file) => stripFileData(byId.get(file.id) ?? ({ ...file, arrayBuffer: new ArrayBuffer(0) } as DicomFile)))
  for (const file of updatedFiles) {
    if (!files.some((existing) => existing.id === file.id)) files.push(stripFileData(file))
  }

  const studies = state.studies.map((study) => ({
    ...study,
    series: study.series.map((series) => ({
      ...series,
      files: series.files.map((file) => {
        const updated = byId.get(file.id)
        return updated ? { ...updated, arrayBuffer: new ArrayBuffer(0), opfsFileId: updated.opfsFileId || updated.id } : file
      }),
    })),
  }))

  return { version: 1, files, studies }
}

export const markFilesSent = (state: CliState, sentIds: Set<string>): CliState => ({
  version: 1,
  files: state.files.map((file) => sentIds.has(file.id) ? { ...file, sent: true } : file),
  studies: state.studies.map((study) => ({
    ...study,
    series: study.series.map((series) => ({
      ...series,
      files: series.files.map((file) => sentIds.has(file.id) ? { ...file, sent: true } : file),
    })),
  })),
})
