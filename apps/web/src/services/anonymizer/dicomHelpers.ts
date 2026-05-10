/**
 * DICOM Helper Functions for Anonymization
 * 
 * These functions are needed by the @umessen/dicom-deidentifier library
 * to handle missing or malformed date/time fields in DICOM files.
 * 
 * The library requires these functions because DICOM files in the wild
 * often have missing or inconsistent date/time information, and the
 * anonymization process needs reference dates for proper anonymization.
 */

import { tag } from '@/utils/dicom-tag-dictionary'

/**
 * Get a reference date from DICOM dictionary for anonymization purposes.
 * 
 * The deidentifier library uses this to establish a baseline date when
 * PatientBirthDate is missing or needs to be anonymized relative to other dates.
 * 
 * Priority order:
 * 1. PatientBirthDate (if available)
 * 2. StudyDate 
 * 3. AcquisitionDate
 * 4. ContentDate
 * 5. Default fallback (1970-01-01)
 */
export function getDicomReferenceDate(dictionary: any): Date {
  const studyDate = dictionary[tag('Study Date')]?.Value?.[0]
  const acquisitionDate = dictionary[tag('Acquisition Date')]?.Value?.[0]
  const contentDate = dictionary[tag('Content Date')]?.Value?.[0]
  const patientBirthDate = dictionary[tag("Patient's Birth Date")]?.Value?.[0]

  if (patientBirthDate) {
    // Parse DICOM date format YYYYMMDD
    const year = parseInt(patientBirthDate.substring(0, 4))
    const month = parseInt(patientBirthDate.substring(4, 6)) - 1 // JS months are 0-based
    const day = parseInt(patientBirthDate.substring(6, 8))
    return new Date(year, month, day)
  } else if (studyDate) {
    const year = parseInt(studyDate.substring(0, 4))
    const month = parseInt(studyDate.substring(4, 6)) - 1
    const day = parseInt(studyDate.substring(6, 8))
    return new Date(year, month, day)
  } else if (acquisitionDate) {
    const year = parseInt(acquisitionDate.substring(0, 4))
    const month = parseInt(acquisitionDate.substring(4, 6)) - 1
    const day = parseInt(acquisitionDate.substring(6, 8))
    return new Date(year, month, day)
  } else if (contentDate) {
    const year = parseInt(contentDate.substring(0, 4))
    const month = parseInt(contentDate.substring(4, 6)) - 1
    const day = parseInt(contentDate.substring(6, 8))
    return new Date(year, month, day)
  } else {
    // Fallback to epoch start
    return new Date('1970-01-01')
  }
}

/**
 * Get a reference time from DICOM dictionary for anonymization purposes.
 * 
 * The deidentifier library uses this to establish a baseline time when
 * StudyTime or other time fields are missing or need consistent anonymization.
 * 
 * Priority order:
 * 1. StudyTime
 * 2. SeriesTime
 * 3. AcquisitionTime
 * 4. Default fallback (noon)
 */
export function getDicomReferenceTime(dictionary: any): Date {
  const studyTime = dictionary[tag('Study Time')]?.Value?.[0]
  const seriesTime = dictionary[tag('Series Time')]?.Value?.[0]
  const acquisitionTime = dictionary[tag('Acquisition Time')]?.Value?.[0]

  if (studyTime) {
    // Parse DICOM time format HHMMSS.FFFFFF
    const timeStr = studyTime.padEnd(6, '0') // Ensure at least HHMMSS
    const hours = parseInt(timeStr.substring(0, 2))
    const minutes = parseInt(timeStr.substring(2, 4))
    const seconds = parseInt(timeStr.substring(4, 6))
    return new Date(1970, 0, 1, hours, minutes, seconds)
  } else if (seriesTime) {
    const timeStr = seriesTime.padEnd(6, '0')
    const hours = parseInt(timeStr.substring(0, 2))
    const minutes = parseInt(timeStr.substring(2, 4))
    const seconds = parseInt(timeStr.substring(4, 6))
    return new Date(1970, 0, 1, hours, minutes, seconds)
  } else if (acquisitionTime) {
    const timeStr = acquisitionTime.padEnd(6, '0')
    const hours = parseInt(timeStr.substring(0, 2))
    const minutes = parseInt(timeStr.substring(2, 4))
    const seconds = parseInt(timeStr.substring(4, 6))
    return new Date(1970, 0, 1, hours, minutes, seconds)
  } else {
    // Fallback to noon
    return new Date(1970, 0, 1, 12, 0, 0)
  }
}