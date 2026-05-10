import * as dcmjs from 'dcmjs'
import type { DicomMetadata } from '@/types/dicom'

/**
 * Utility for building DICOM files from metadata and pixel data
 * Uses pure dcmjs approach for creating DICOM Secondary Capture objects
 */
export class DicomDatasetBuilder {

  /* Create a DICOM ArrayBuffer from metadata and pixel data */
  static async createDicomBuffer(
    width: number,
    height: number,
    pixelData: Uint8Array,
    metadata: DicomMetadata,
    imageFormat: {
      samplesPerPixel: number
      photometricInterpretation: string
      bitsAllocated: number
      bitsStored: number
      highBit: number
      pixelRepresentation: number
      planarConfiguration: number
    }
  ): Promise<ArrayBuffer> {
    // Generate UIDs if not provided
    const studyInstanceUID = metadata.studyInstanceUID || this.generateUID()
    const seriesInstanceUID = metadata.seriesInstanceUID || this.generateUID()
    const sopInstanceUID = metadata.sopInstanceUID || this.generateUID()
    const transferSyntaxUID = metadata.transferSyntaxUID || '1.2.840.10008.1.2' // Implicit VR Little Endian

    // Build meta information separately
    const metaHeader = {
      '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1])] }, // FileMetaInformationVersion
      '00020002': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] }, // MediaStorageSOPClassUID - Secondary Capture
      '00020003': { vr: 'UI', Value: [sopInstanceUID] }, // MediaStorageSOPInstanceUID
      '00020010': { vr: 'UI', Value: [transferSyntaxUID] }, // TransferSyntaxUID
      '00020012': { vr: 'UI', Value: ['1.2.276.0.7230010.3.0.3.6.7'] }, // ImplementationClassUID
      '00020013': { vr: 'SH', Value: ['dcmjs-0.29.0'] } // ImplementationVersionName
    }

    // Build main dataset
    const dataset = this.buildDataset(metadata, studyInstanceUID, seriesInstanceUID, sopInstanceUID, width, height, pixelData, imageFormat)

    try {
      // Use DicomDict to write the dataset to DICOM buffer
      const dicomDict = new (dcmjs.data as any).DicomDict(metaHeader)
      dicomDict.dict = dataset
      const part10Buffer = dicomDict.write()

      return part10Buffer
    } catch (error) {
      throw new Error(`Failed to create DICOM buffer using dcmjs: ${error}`)
    }
  }

  /* Build complete DICOM dataset */
  private static buildDataset(
    metadata: DicomMetadata,
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
    width: number,
    height: number,
    pixelData: Uint8Array,
    imageFormat: any
  ): any {
    const dataset: any = {
      // SOP Common Module
      '00080005': { vr: 'CS', Value: ['ISO_IR 100'] }, // SpecificCharacterSet
      '00080016': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] }, // SOPClassUID - Secondary Capture
      '00080018': { vr: 'UI', Value: [sopInstanceUID] }, // SOPInstanceUID
      '00080012': { vr: 'DA', Value: [this.getCurrentDate()] }, // InstanceCreationDate
      '00080013': { vr: 'TM', Value: [this.getCurrentTime()] }, // InstanceCreationTime

      // Secondary Capture Image Module
      '00080064': { vr: 'CS', Value: ['WSD'] }, // ConversionType (Web Scanned Document)
      '00180060': { vr: 'CS', Value: ['WSD'] }, // ConversionType

      // Patient Module
      '00100010': { vr: 'PN', Value: [metadata.patientName || 'ANONYMOUS'] }, // PatientName
      '00100020': { vr: 'LO', Value: [metadata.patientId || 'ANON001'] }, // PatientID
      '00100030': { vr: 'DA', Value: [metadata.patientBirthDate || ''] }, // PatientBirthDate
      '00100040': { vr: 'CS', Value: [metadata.patientSex || 'O'] }, // PatientSex
      '00101010': { vr: 'AS', Value: [metadata.patientAge || ''] }, // PatientAge

      // Study Module
      '0020000D': { vr: 'UI', Value: [studyInstanceUID] }, // StudyInstanceUID
      '00080020': { vr: 'DA', Value: [metadata.studyDate || this.getCurrentDate()] }, // StudyDate
      '00080030': { vr: 'TM', Value: [this.getCurrentTime()] }, // StudyTime
      '00080050': { vr: 'SH', Value: [metadata.accessionNumber || ''] }, // AccessionNumber
      '00080090': { vr: 'PN', Value: [''] }, // ReferringPhysicianName
      '00081030': { vr: 'LO', Value: [metadata.studyDescription || 'Converted Secondary Capture'] }, // StudyDescription
      '00200010': { vr: 'SH', Value: ['001'] }, // StudyID

      // Series Module
      '0020000E': { vr: 'UI', Value: [seriesInstanceUID] }, // SeriesInstanceUID
      '00080060': { vr: 'CS', Value: [metadata.modality || 'SC'] }, // Modality
      '00200011': { vr: 'IS', Value: [metadata.instanceNumber?.toString() || '1'] }, // SeriesNumber
      '0008103E': { vr: 'LO', Value: [metadata.seriesDescription || 'Secondary Capture Series'] }, // SeriesDescription

      // Instance Module
      '00200013': { vr: 'IS', Value: [metadata.instanceNumber?.toString() || '1'] }, // InstanceNumber

      // Image Module
      '00280002': { vr: 'US', Value: [imageFormat.samplesPerPixel] }, // SamplesPerPixel
      '00280004': { vr: 'CS', Value: [imageFormat.photometricInterpretation] }, // PhotometricInterpretation
      '00280010': { vr: 'US', Value: [height] }, // Rows
      '00280011': { vr: 'US', Value: [width] }, // Columns
      '00280100': { vr: 'US', Value: [imageFormat.bitsAllocated] }, // BitsAllocated
      '00280101': { vr: 'US', Value: [imageFormat.bitsStored] }, // BitsStored
      '00280102': { vr: 'US', Value: [imageFormat.highBit] }, // HighBit
      '00280103': { vr: 'US', Value: [imageFormat.pixelRepresentation] }, // PixelRepresentation

      // Pixel Data
      '7FE00010': { vr: 'OB', Value: [pixelData] } // PixelData
    }

    // Add planar configuration for color images
    if (imageFormat.samplesPerPixel > 1) {
      dataset['00280006'] = { vr: 'US', Value: [imageFormat.planarConfiguration] } // PlanarConfiguration
    }

    return dataset
  }

  /* Generate a DICOM UID */
  private static generateUID(): string {
    const timestamp = Date.now().toString()
    const random = Math.floor(Math.random() * 1000000).toString()
    // Create a DICOM-compliant UID (max 64 chars)
    return `1.2.826.0.1.3680043.9.7.1.${timestamp}.${random}`
  }

  /* Get current date in DICOM format (YYYYMMDD) */
  private static getCurrentDate(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    const day = now.getDate().toString().padStart(2, '0')
    return `${year}${month}${day}`
  }

  /* Get current time in DICOM format (HHMMSS.FFFFFF) */
  private static getCurrentTime(): string {
    const now = new Date()
    const hours = now.getHours().toString().padStart(2, '0')
    const minutes = now.getMinutes().toString().padStart(2, '0')
    const seconds = now.getSeconds().toString().padStart(2, '0')
    const milliseconds = now.getMilliseconds().toString().padStart(3, '0')
    return `${hours}${minutes}${seconds}.${milliseconds}000`
  }
}
