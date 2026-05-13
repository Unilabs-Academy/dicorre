import { describe, expect, it } from 'vitest'
import { formatStudyUidDisplay } from './uidDisplay'

describe('formatStudyUidDisplay', () => {
  it('shows the start and final UID component for long dotted UIDs', () => {
    expect(
      formatStudyUidDisplay('1.2.826.0.1.3680043.8.498.4939676319174051000'),
    ).toBe('1.2.826.0.1...4939676319174051000')
  })

  it('keeps short UIDs unchanged', () => {
    expect(formatStudyUidDisplay('1.2.3.4.5')).toBe('1.2.3.4.5')
  })
})
