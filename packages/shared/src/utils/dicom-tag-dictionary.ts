/**
 * DICOM Tag Dictionary
 * Generated from DICOM deidentification reference data
 * Maps between tag hex values and official DICOM tag names
 */

import { dicomTagsReference } from './deidentify-reference'
import * as dcmjs from 'dcmjs'

// Create dictionaries from reference data
function createDictionaries() {
  const tagToName: Record<string, string> = {}
  const nameToTag: Record<string, string> = {}

  dicomTagsReference.forEach(item => {
    const hexTag = item.Tag.replace(/[(),,]/g, '').replace(/,/g, '')
    const tagName = item["Attribute Name"]

    // Create mappings
    tagToName[hexTag] = tagName
    nameToTag[tagName] = hexTag

    // Also create mapping with normalized name for easier lookup
    const normalizedName = tagName
      .replace(/'/g, '')
      .replace(/\s+/g, '')
      .replace(/[-()]/g, '')
      .replace(/\//g, 'Or')

    if (normalizedName !== tagName) {
      nameToTag[normalizedName] = hexTag
    }
  })

  // Merge dcmjs DicomMetaDictionary dictionary for comprehensive coverage
  try {
    const meta: any = (dcmjs as any)?.data?.DicomMetaDictionary
    const dict: Record<string, any> | undefined = meta?.dictionary
    if (dict && typeof dict === 'object') {
      for (const [key, entry] of Object.entries(dict)) {
        const cleanHex = key.replace(/^x/i, '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
        const entryName = (entry as any)?.name ?? (typeof entry === 'string' ? entry : undefined)
        if (!entryName) continue
        if (!tagToName[cleanHex]) tagToName[cleanHex] = entryName
        if (!nameToTag[entryName]) nameToTag[entryName] = cleanHex
        const normalizedName = entryName
          .replace(/'/g, '')
          .replace(/\s+/g, '')
          .replace(/[-()]/g, '')
          .replace(/\//g, 'Or')
        if (!nameToTag[normalizedName]) nameToTag[normalizedName] = cleanHex
      }
    }
  } catch {
    // ignore if dcmjs dictionary shape changes
  }

  return { tagToName, nameToTag }
}

const { tagToName, nameToTag } = createDictionaries()

// Add commonly used DICOM tags that might not be in the reference
const commonMissingTags: Record<string, string> = {
  '00200013': 'Instance Number',
  '00080060': 'Modality',
  '00080070': 'Manufacturer',
  '00020010': 'Transfer Syntax UID',
  '00020002': 'Media Storage SOP Class UID',
  '00080016': 'SOP Class UID',
  '00200011': 'Series Number',
  '00280002': 'Samples per Pixel',
  '00280004': 'Photometric Interpretation',
  '00280010': 'Rows',
  '00280011': 'Columns',
  '00280100': 'Bits Allocated',
  '00280101': 'Bits Stored',
  '00280102': 'High Bit',
  '00280103': 'Pixel Representation',
  '00280006': 'Planar Configuration',
  '7FE00010': 'Pixel Data',
  '00180060': 'KVP'
}

// Merge with existing dictionaries
for (const [hex, name] of Object.entries(commonMissingTags)) {
  if (!tagToName[hex]) {
    tagToName[hex] = name
    nameToTag[name] = hex
  }
}

// Export the dictionaries
export const DICOM_TAG_TO_NAME: Record<string, string> = tagToName
export const DICOM_NAME_TO_TAG: Record<string, string> = nameToTag

/**
 * Get DICOM tag name from hex value
 */
export function getTagName(hexTag: string): string {
  let cleanTag = hexTag.replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
  if (cleanTag.length === 6) {
    cleanTag = cleanTag.padStart(8, '0')
  }
  if (cleanTag.length !== 8) {
    return cleanTag
  }
  const name = DICOM_TAG_TO_NAME[cleanTag]
  if (name) return name
  // Fallback: attempt dcmjs dictionary again if present (defensive)
  try {
    const meta: any = (dcmjs as any)?.data?.DicomMetaDictionary
    if (meta?.nameForTag && typeof meta.nameForTag === 'function') {
      const alt = meta.nameForTag(`x${cleanTag.toLowerCase()}`)
      if (alt) return alt
    }
    const dict: Record<string, any> | undefined = meta?.dictionary
    if (dict) {
      const entry = dict[`x${cleanTag.toLowerCase()}`]
      const alt2 = entry?.name ?? (typeof entry === 'string' ? entry : undefined)
      if (alt2) return alt2
    }
  } catch { }
  // As a last resort, return the hex itself to never fail
  return cleanTag
}

/**
 * Get DICOM tag hex from name
 */
export function getTagHex(tagName: string): string | null {
  const direct = DICOM_NAME_TO_TAG[tagName]
  if (direct) return direct
  const normalizedName = tagName
    .replace(/'/g, '')
    .replace(/\s+/g, '')
    .replace(/[-()]/g, '')
    .replace(/\//g, 'Or')
  return DICOM_NAME_TO_TAG[normalizedName] || null
}

/**
 * Get DICOM tag hex from name, throw if not found
 */
export function getTagHexStrict(tagName: string): string {
  const hex = DICOM_NAME_TO_TAG[tagName]
  if (!hex) {
    throw new Error(`Unknown DICOM tag name: ${tagName}`)
  }
  return hex
}

/**
 * Convert tag name to config-friendly format (hex)
 */
export function tagNameToHex(tagName: string): string | null {
  return getTagHex(tagName)
}

/**
 * Convert hex tag to human-readable name
 */
export function tagHexToName(hexTag: string): string {
  return getTagName(hexTag)
}

/**
 * Validate if a tag name exists in the dictionary
 */
export function isValidTagName(tagName: string): boolean {
  if (tagName in DICOM_NAME_TO_TAG) return true
  const normalizedName = tagName
    .replace(/'/g, '')
    .replace(/\s+/g, '')
    .replace(/[-()]/g, '')
    .replace(/\//g, 'Or')
  return normalizedName in DICOM_NAME_TO_TAG
}

/**
 * Validate if a tag hex exists in the dictionary
 */
export function isValidTagHex(hexTag: string): boolean {
  const cleanTag = hexTag.replace(/[(),,]/g, '').replace(/,/g, '')
  return cleanTag in DICOM_TAG_TO_NAME
}

/**
 * Get all available tag names
 */
export function getAllTagNames(): string[] {
  // Only include names from the de-identification reference plus known common additions
  const referenceNames = dicomTagsReference.map(ref => ref["Attribute Name"]).filter(Boolean) as string[]
  const manualNames = Object.values(commonMissingTags)
  return Array.from(new Set([...referenceNames, ...manualNames]))
}

/**
 * Get all available tag hex values
 */
export function getAllTagHex(): string[] {
  return Object.keys(DICOM_TAG_TO_NAME)
}

/**
 * Try to find tag name with fuzzy matching
 */
export function findTagName(searchTerm: string): string[] {
  const term = searchTerm.toLowerCase()
  return getAllTagNames().filter(name =>
    name.toLowerCase().includes(term)
  )
}

/**
 * Get tag info including name and hex
 */
export function getTagInfo(identifier: string): { hex: string; name: string } | null {
  // Check if it's a hex tag
  if (/^[0-9A-Fa-f]{8}$/.test(identifier)) {
    try {
      return {
        hex: identifier,
        name: getTagName(identifier)
      }
    } catch {
      return null
    }
  }

  // Assume it's a tag name
  const hex = getTagHex(identifier)
  if (!hex) return null

  return {
    hex,
    name: identifier
  }
}

// Common tags for easy access (only include tags that exist in reference)
export const COMMON_TAGS = Object.fromEntries(
  Object.entries({
    // Patient Information
    PATIENT_NAME: "Patient's Name",
    PATIENT_ID: "Patient ID",
    PATIENT_BIRTH_DATE: "Patient's Birth Date",
    PATIENT_SEX: "Patient's Sex",

    // Study Information
    STUDY_DATE: "Study Date",
    STUDY_TIME: "Study Time",
    STUDY_INSTANCE_UID: "Study Instance UID",
    STUDY_DESCRIPTION: "Study Description",

    // Series Information
    SERIES_INSTANCE_UID: "Series Instance UID",
    SERIES_DESCRIPTION: "Series Description",
    MODALITY: "Modality",

    // Instance Information
    SOP_CLASS_UID: "SOP Class UID",
    SOP_INSTANCE_UID: "SOP Instance UID",
    INSTANCE_NUMBER: "Instance Number",

    // Technical Information
    MANUFACTURER: "Manufacturer",
    REFERRING_PHYSICIAN_NAME: "Referring Physician's Name",
    PROTOCOL_NAME: "Protocol Name",
    STATION_NAME: "Station Name",
    INSTITUTION_NAME: "Institution Name",
  }).filter(([_, tagName]) => getTagHex(tagName) !== null)
    .map(([key, tagName]) => [key, getTagHex(tagName)!])
) as Record<string, string>

/**
 * Get hex value for a tag name, with a safe fallback
 * This is the single source of truth for tag name to hex conversion
 */
export function tag(tagName: string): string {
  const hex = getTagHex(tagName)
  if (!hex) {
    console.warn(`Unknown DICOM tag name: ${tagName}, using as-is`)
    return tagName // Return as-is if not found (might be a hex value already)
  }
  return hex
}
