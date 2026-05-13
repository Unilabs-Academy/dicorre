export function formatStudyUidDisplay(uid: string): string {
  if (!uid) return ''

  const parts = uid.split('.')
  if (parts.length >= 4) {
    const prefix = parts.slice(0, Math.min(5, parts.length - 1)).join('.')
    const suffix = parts[parts.length - 1]
    const formatted = `${prefix}...${suffix}`

    if (formatted.length < uid.length) {
      return formatted
    }
  }

  const prefixLength = 14
  const suffixLength = 18
  if (uid.length <= prefixLength + suffixLength + 3) {
    return uid
  }

  const prefix = uid.slice(0, prefixLength).replace(/\.$/, '')
  const suffix = uid.slice(-suffixLength).replace(/^\./, '')
  return `${prefix}...${suffix}`
}
