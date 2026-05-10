/**
 * DICOM Value Representation (VR) validators
 *
 * VR is DICOM's type system for data elements. Key VRs referenced here:
 * - AS (Age String): "nnnU" where nnn is 000–999 and U is one of D/W/M/Y.
 *   Examples: 032Y, 010D. Represents patient age with a unit.
 * - DA (Date): "YYYYMMDD" with no separators. "00000000" is permitted (unknown).
 * - TM (Time): "HHMMSS" optionally with fractional seconds ".ffffff".
 * - CS (Code String): Uppercase A–Z, digits, space, underscore. Max length 16.
 * - PN (Person Name): Person name in DICOM format. Length constrained; basic check here.
 *
 * This module derives VR per tag via the local reference (`dicomTagsReference`), then
 * applies format checks. Some elements also have enumerations beyond VR (e.g., Patient's Sex),
 * which are validated explicitly in `validateDicomField`.
 */
import { getTagHex } from '@/utils/dicom-tag-dictionary'
import * as dcmjs from 'dcmjs'

const vrByHex: Record<string, string> = Object.create(null)

try {
  const meta: any = (dcmjs as any)?.data?.DicomMetaDictionary
  const dictionary: Record<string, any> | undefined = meta?.dictionary
  if (dictionary) {
    for (const [key, entry] of Object.entries(dictionary)) {
      const hex = key.replace(/^x/i, '').toUpperCase()
      const vr: string | undefined = Array.isArray((entry as any)?.vr)
        ? (entry as any).vr[0]
        : (entry as any)?.vr || (entry as any)?.VR
      if (hex && vr) {
        vrByHex[hex] = vr
      }
    }
  }
} catch {
  // ignore if dcmjs dictionary not available
}

// Manual fallbacks for common fields if reference lacks VR
const manualVRByHex: Record<string, string> = {
  // Patient's Age
  '00101010': 'AS',
  // Study Date
  '00080020': 'DA',
}

for (const [hex, vr] of Object.entries(manualVRByHex)) {
  if (!vrByHex[hex]) vrByHex[hex] = vr
}

function getVR(tagName: string): string | null {
  const hex = getTagHex(tagName)
  if (!hex) return null
  return vrByHex[hex] ?? null
}

export function validateByVR(vr: string, value: string): string | null {
  if (value === '') return null
  switch (vr) {
    case 'AS': {
      return /^\d{3}[DWMY]$/.test(value)
        ? null
        : "Age as 3 digits + unit D/W/M/Y. Examples: 005D, 010W, 015M, 032Y"
    }
    case 'DA': {
      if (!/^\d{8}$/.test(value)) return 'Format: YYYYMMDD'
      if (value === '00000000') return null
      const year = Number(value.slice(0, 4))
      const month = Number(value.slice(4, 6))
      const day = Number(value.slice(6, 8))
      if (month < 1 || month > 12) return 'Month must be 01-12'
      const lastDay = new Date(year, month, 0).getDate()
      return day >= 1 && day <= lastDay ? null : 'Invalid day for month'
    }
    case 'TM': {
      return /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d(?:\.\d{1,6})?$/.test(value)
        ? null
        : 'Format: HHMMSS[.ffffff]'
    }
    case 'CS': {
      return /^[A-Z0-9 _]{1,16}$/.test(value) ? null : 'Max 16 chars A-Z0-9 _'
    }
    case 'PN': {
      return value.length <= 320 ? null : 'Max length 320'
    }
    default:
      return null
  }
}

export function validateDicomField(tagName: string, value: string): string | null {
  if (tagName === "Patient's Sex") {
    if (value === '') return null
    const v = value.toUpperCase()
    return /^(M|F|O|U)$/.test(v) ? null : 'Allowed: M, F, O, U'
  }
  const vr = getVR(tagName)
  return vr ? validateByVR(vr, value) : null
}


