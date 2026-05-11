import { describe, it, expect } from 'vitest'
import type { DicomFile } from '@/types/dicom'

// Helper to group DICOM files by patient/study/series
function groupDicomFiles(files: DicomFile[]) {
  const patients = new Map()
  
  for (const file of files) {
    if (!file.metadata) continue
    
    const patientId = file.metadata.patientId
    const studyInstanceUID = file.metadata.studyInstanceUID
    const seriesInstanceUID = file.metadata.seriesInstanceUID
    
    if (!patients.has(patientId)) {
      patients.set(patientId, {
        patientId,
        patientName: file.metadata.patientName,
        studies: new Map()
      })
    }
    
    const patient = patients.get(patientId)
    
    if (!patient.studies.has(studyInstanceUID)) {
      patient.studies.set(studyInstanceUID, {
        studyInstanceUID,
        studyDate: file.metadata.studyDate,
        studyDescription: file.metadata.studyDescription,
        series: new Map()
      })
    }
    
    const study = patient.studies.get(studyInstanceUID)
    
    if (!study.series.has(seriesInstanceUID)) {
      study.series.set(seriesInstanceUID, {
        seriesInstanceUID,
        seriesDescription: file.metadata.seriesDescription,
        modality: file.metadata.modality,
        files: []
      })
    }
    
    const series = study.series.get(seriesInstanceUID)
    series.files.push(file)
  }
  
  return patients
}

describe('DICOM File Grouping', () => {
  it('should correctly group mock files by patient/study/series', () => {
    // Create mock DICOM files with metadata that mimics the expected structure
    const mockFiles: DicomFile[] = [
      // Patient 1, Study 1, Series 1 (2 files)
      {
        id: 'file1',
        fileName: 'file1.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: false,
        metadata: {
          patientId: 'PATIENT001',
          patientName: { Alphabetic: 'Patient One' } as any,
          studyInstanceUID: 'STUDY001',
          studyDescription: 'CT Chest',
          seriesInstanceUID: 'SERIES001',
          seriesDescription: 'Axial CT',
          modality: 'CT',
          studyDate: '20240101',
          patientBirthDate: '19800101',
          patientSex: 'M',
          patientWeight: 70,
          patientHeight: 175,
          accessionNumber: 'ACC001',
          sopInstanceUID: 'SOP001',
          instanceNumber: 1,
          transferSyntaxUID: '1.2.840.10008.1.2'
        }
      },
      {
        id: 'file2',
        fileName: 'file2.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: false,
        metadata: {
          patientId: 'PATIENT001',
          patientName: { Alphabetic: 'Patient One' } as any,
          studyInstanceUID: 'STUDY001',
          studyDescription: 'CT Chest',
          seriesInstanceUID: 'SERIES001',
          seriesDescription: 'Axial CT',
          modality: 'CT',
          studyDate: '20240101',
          patientBirthDate: '19800101',
          patientSex: 'M',
          patientWeight: 70,
          patientHeight: 175,
          accessionNumber: 'ACC001',
          sopInstanceUID: 'SOP002',
          instanceNumber: 2,
          transferSyntaxUID: '1.2.840.10008.1.2'
        }
      },
      // Patient 1, Study 1, Series 2 (2 files)
      {
        id: 'file3',
        fileName: 'file3.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: false,
        metadata: {
          patientId: 'PATIENT001',
          patientName: { Alphabetic: 'Patient One' } as any,
          studyInstanceUID: 'STUDY001',
          studyDescription: 'CT Chest',
          seriesInstanceUID: 'SERIES002',
          seriesDescription: 'Coronal CT',
          modality: 'CT',
          studyDate: '20240101',
          patientBirthDate: '19800101',
          patientSex: 'M',
          patientWeight: 70,
          patientHeight: 175,
          accessionNumber: 'ACC001',
          sopInstanceUID: 'SOP003',
          instanceNumber: 1,
          transferSyntaxUID: '1.2.840.10008.1.2'
        }
      },
      {
        id: 'file4',
        fileName: 'file4.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: false,
        metadata: {
          patientId: 'PATIENT001',
          patientName: { Alphabetic: 'Patient One' } as any,
          studyInstanceUID: 'STUDY001',
          studyDescription: 'CT Chest',
          seriesInstanceUID: 'SERIES002',
          seriesDescription: 'Coronal CT',
          modality: 'CT',
          studyDate: '20240101',
          patientBirthDate: '19800101',
          patientSex: 'M',
          patientWeight: 70,
          patientHeight: 175,
          accessionNumber: 'ACC001',
          sopInstanceUID: 'SOP004',
          instanceNumber: 2,
          transferSyntaxUID: '1.2.840.10008.1.2'
        }
      },
      // Patient 2, Study 1, Series 1 (1 file)
      {
        id: 'file5',
        fileName: 'file5.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: false,
        metadata: {
          patientId: 'PATIENT002',
          patientName: { Alphabetic: 'Patient Two' } as any,
          studyInstanceUID: 'STUDY002',
          studyDescription: 'MRI Brain',
          seriesInstanceUID: 'SERIES003',
          seriesDescription: 'T1 Sagittal',
          modality: 'MR',
          studyDate: '20240102',
          patientBirthDate: '19750101',
          patientSex: 'F',
          patientWeight: 60,
          patientHeight: 165,
          accessionNumber: 'ACC002',
          sopInstanceUID: 'SOP005',
          instanceNumber: 1,
          transferSyntaxUID: '1.2.840.10008.1.2'
        }
      }
    ]

    // Group files by patient/study/series
    const patients = groupDicomFiles(mockFiles)
    
    // Should have 2 patients
    expect(patients.size).toBe(2)
    
    // Check Patient 1
    const patient1 = patients.get('PATIENT001')
    expect(patient1).toBeDefined()
    expect(patient1.patientName).toEqual({ Alphabetic: 'Patient One' })
    expect(patient1.studies.size).toBe(1)
    
    const study1 = patient1.studies.get('STUDY001')
    expect(study1).toBeDefined()
    expect(study1.studyDescription).toBe('CT Chest')
    expect(study1.series.size).toBe(2)
    
    const series1 = study1.series.get('SERIES001')
    expect(series1).toBeDefined()
    expect(series1.seriesDescription).toBe('Axial CT')
    expect(series1.files.length).toBe(2)
    
    const series2 = study1.series.get('SERIES002')
    expect(series2).toBeDefined()
    expect(series2.seriesDescription).toBe('Coronal CT')
    expect(series2.files.length).toBe(2)
    
    // Check Patient 2
    const patient2 = patients.get('PATIENT002')
    expect(patient2).toBeDefined()
    expect(patient2.patientName).toEqual({ Alphabetic: 'Patient Two' })
    expect(patient2.studies.size).toBe(1)
    
    const study2 = patient2.studies.get('STUDY002')
    expect(study2).toBeDefined()
    expect(study2.studyDescription).toBe('MRI Brain')
    expect(study2.series.size).toBe(1)
    
    const series3 = study2.series.get('SERIES003')
    expect(series3).toBeDefined()
    expect(series3.seriesDescription).toBe('T1 Sagittal')
    expect(series3.files.length).toBe(1)
  })

  it('should handle files with missing metadata gracefully', () => {
    const mockFiles: DicomFile[] = [
      {
        id: 'file1',
        fileName: 'file1.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: false,
        metadata: {
          patientId: 'PATIENT001',
          patientName: { Alphabetic: 'Patient One' } as any,
          studyInstanceUID: 'STUDY001',
          studyDescription: 'CT Chest',
          seriesInstanceUID: 'SERIES001',
          seriesDescription: 'Axial CT',
          modality: 'CT',
          studyDate: '20240101',
          patientBirthDate: '19800101',
          patientSex: 'M',
          patientWeight: 70,
          patientHeight: 175,
          accessionNumber: 'ACC001',
          sopInstanceUID: 'SOP001',
          instanceNumber: 1,
          transferSyntaxUID: '1.2.840.10008.1.2'
        }
      },
      {
        id: 'file2',
        fileName: 'file2.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: false
        // metadata missing
      }
    ]

    const patients = groupDicomFiles(mockFiles)
    
    // Should only group the file with metadata
    expect(patients.size).toBe(1)
    
    const patient1 = patients.get('PATIENT001')
    expect(patient1).toBeDefined()
    expect(patient1.studies.size).toBe(1)
    expect(patient1.studies.get('STUDY001')?.series.get('SERIES001')?.files.length).toBe(1)
  })
})