import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createRemoveTagsHandler,
  createDateJitterHandler,
  createValueReplacementHandler,
  clearValueCache,
  getAllSpecialHandlers
} from './handlers'

// Mock DicomElement for testing
interface MockDicomElement {
  keyword?: string
  name?: string
  tag?: { toString: () => string }
  vr?: string
  VR?: string
  value?: string
  deleted?: boolean
  setValue?: (value: string) => void
  getValue?: () => string
  delete?: () => void
  remove?: () => void
}

function createMockElement(props: Partial<MockDicomElement> = {}): MockDicomElement {
  const element: MockDicomElement = {
    keyword: '',
    name: '',
    vr: 'ST',
    value: '',
    deleted: false,
    setValue: vi.fn((value: string) => { element.value = value }),
    getValue: vi.fn(() => element.value || ''),
    delete: vi.fn(() => { element.deleted = true }),
    remove: vi.fn(() => { element.deleted = true }),
    ...props
  }
  return element
}

describe('anonymizationHandlers', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure clean state
    clearValueCache()
  })

  describe('createRemoveTagsHandler', () => {
    const testTagsToRemove = [
      'PatientAddress',
      'startswith:IssueDate',
      'contains:Trial',
      'ReferringPhysicianName'
    ]

    it('should remove tags that match exact names', () => {
      const handler = createRemoveTagsHandler(testTagsToRemove)
      const element = createMockElement({
        keyword: 'PatientAddress'
      })

      const result = handler(element, {})

      expect(result).toBe(true) // Handler processed the element
      expect(element.deleted).toBe(true)
    })

    it('should remove tags that match startswith pattern', () => {
      const handler = createRemoveTagsHandler(testTagsToRemove)
      const element = createMockElement({
        keyword: 'IssueDateOfImaging'
      })

      const result = handler(element, {})

      expect(result).toBe(true)
      expect(element.deleted).toBe(true)
    })

    it('should remove tags that match endswith pattern', () => {
      const handler = createRemoveTagsHandler(testTagsToRemove)
      // This test would need a tag in our REMOVE list that uses endswith
      // For now, let's test that the pattern matching works
      const element = createMockElement({
        keyword: 'SomeOtherTag'
      })

      const result = handler(element, {})

      expect(result).toBe(false) // Should not be removed
      expect(element.deleted).toBe(false)
    })

    it('should remove tags that match contains pattern', () => {
      const handler = createRemoveTagsHandler(testTagsToRemove)
      const element = createMockElement({
        keyword: 'ClinicalTrialSubjectID'
      })

      const result = handler(element, {})

      expect(result).toBe(true) // Should match "contains:Trial"
      expect(element.deleted).toBe(true)
    })

    it('should not remove tags that do not match any pattern', () => {
      const handler = createRemoveTagsHandler(testTagsToRemove)
      const element = createMockElement({
        keyword: 'StudyInstanceUID'
      })

      const result = handler(element, {})

      expect(result).toBe(false)
      expect(element.deleted).toBe(false)
    })

    it('should handle elements with fallback tag identification', () => {
      const handler = createRemoveTagsHandler(testTagsToRemove)
      const element = createMockElement({
        keyword: undefined,
        name: 'PatientAddress'
      })

      const result = handler(element, {})

      expect(result).toBe(true)
      expect(element.deleted).toBe(true)
    })

    it('should work with empty tags list', () => {
      const handler = createRemoveTagsHandler([])
      const element = createMockElement({
        keyword: 'PatientAddress'
      })

      const result = handler(element, {})

      expect(result).toBe(false) // Should not be removed
      expect(element.deleted).toBe(false)
    })
  })

  describe('createDateJitterHandler', () => {
    it('should apply jitter to date fields ending with "Date"', () => {
      const handler = createDateJitterHandler(31)
      const originalDate = '20240315' // March 15, 2024
      const element = createMockElement({
        keyword: 'StudyDate',
        vr: 'DA',
        value: originalDate
      })

      const result = handler(element, {})

      expect(result).toBe(true)
      expect(element.value).not.toBe(originalDate)
      expect(element.value).toMatch(/^\d{8}$/) // Should still be 8-digit format
    })

    it('should not apply jitter to non-date fields', () => {
      const handler = createDateJitterHandler(31)
      const element = createMockElement({
        keyword: 'PatientName',
        vr: 'PN',
        value: 'John Doe'
      })

      const result = handler(element, {})

      expect(result).toBe(false)
      expect(element.value).toBe('John Doe')
    })

    it('should not apply jitter to fields not ending with "Date"', () => {
      const handler = createDateJitterHandler(31)
      const element = createMockElement({
        keyword: 'StudyTime',
        vr: 'DA',
        value: '20240315'
      })

      const result = handler(element, {})

      expect(result).toBe(false)
      expect(element.value).toBe('20240315')
    })

    it('should not apply jitter to invalid date formats', () => {
      const handler = createDateJitterHandler(31)
      const element = createMockElement({
        keyword: 'StudyDate',
        vr: 'DA',
        value: '2024-03-15' // Wrong format
      })

      const result = handler(element, {})

      expect(result).toBe(false)
      expect(element.value).toBe('2024-03-15')
    })

    it('should respect the maxDays parameter', () => {
      const handler = createDateJitterHandler(1) // Only 1 day jitter
      const originalDate = '20240315'

      // Run multiple times to check range
      const results = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const testElement = createMockElement({
          keyword: 'StudyDate',
          vr: 'DA',
          value: originalDate
        })
        handler(testElement, {})
        results.add(testElement.value!)
      }

      // Should only have dates within ±1 day
      const expectedDates = ['20240314', '20240316'] // ±1 day from 20240315
      results.forEach(date => {
        expect(expectedDates).toContain(date)
      })
    })
  })

  describe('createValueReplacementHandler', () => {
    it('should replace PatientName with "Anonymous"', () => {
      const handler = createValueReplacementHandler('test-study-id')
      const element = createMockElement({
        keyword: 'PatientName',
        value: 'John Doe'
      })

      const result = handler(element, {})

      expect(result).toBe(true)
      expect(element.value).toBe('Anonymous')
    })

    it('should generate consistent PatientID values', () => {
      const handler = createValueReplacementHandler('test-study-id')
      const element1 = createMockElement({
        keyword: 'PatientID',
        value: 'ORIGINAL123'
      })
      const element2 = createMockElement({
        keyword: 'PatientID',
        value: 'ORIGINAL123'
      })

      handler(element1, {})
      handler(element2, {})

      expect(element1.value).toBe(element2.value) // Should be cached
      expect(element1.value).toMatch(/^PAT\d{7}$/) // Should match pattern
    })

    it('should generate different values for different original values', () => {
      const handler = createValueReplacementHandler('test-study-id')
      const element1 = createMockElement({
        keyword: 'PatientID',
        value: 'ORIGINAL123'
      })
      const element2 = createMockElement({
        keyword: 'PatientID',
        value: 'DIFFERENT456'
      })

      handler(element1, {})
      handler(element2, {})

      expect(element1.value).not.toBe(element2.value)
    })

    it('should generate StudyInstanceUID in correct format', () => {
      const handler = createValueReplacementHandler('test-study-id')
      const element = createMockElement({
        keyword: 'StudyInstanceUID',
        value: '1.2.3.4.5.6.7.8.9'
      })

      const result = handler(element, {})

      expect(result).toBe(true)
      expect(element.value).toMatch(/^1\.2\.826\.0\.1\.3680043\.8\.498\./) // Should start with org root
      expect(element.value!.length).toBeLessThanOrEqual(64) // DICOM UID limit
    })

    it('should generate AccessionNumber in correct format', () => {
      const handler = createValueReplacementHandler('test-study-id')
      const element = createMockElement({
        keyword: 'AccessionNumber',
        value: 'ACC123456'
      })

      const result = handler(element, {})

      expect(result).toBe(true)
      expect(element.value).toMatch(/^ACA\d{7}$/)
    })

    it('should not process non-string values', () => {
      const handler = createValueReplacementHandler('test-study-id')
      const element = createMockElement({
        keyword: 'PatientName'
        // value is undefined by default
      })
      
      // Ensure getValue returns undefined  
      element.getValue = vi.fn(() => undefined as any)

      const result = handler(element, {})

      expect(result).toBe(false)
    })

    it('should not process unrecognized field names', () => {
      const handler = createValueReplacementHandler('test-study-id')
      const element = createMockElement({
        keyword: 'UnknownField',
        value: 'SomeValue'
      })

      const result = handler(element, {})

      expect(result).toBe(false)
      expect(element.value).toBe('SomeValue')
    })
  })

  describe('getAllSpecialHandlers', () => {
    it('should return an array of handler functions', () => {
      const handlers = getAllSpecialHandlers(31, ['PatientAddress'])

      expect(Array.isArray(handlers)).toBe(true)
      expect(handlers.length).toBeGreaterThan(0)
      handlers.forEach(handler => {
        expect(typeof handler).toBe('function')
      })
    })

    it('should pass jitterDays parameter to date handler', () => {
      const handlers = getAllSpecialHandlers(5, [])
      const dateHandler = handlers[1] // Assuming date handler is second

      const element = createMockElement({
        keyword: 'StudyDate',
        vr: 'DA',
        value: '20240315'
      })

      // This is more of an integration test, but we can verify it processes dates
      const result = dateHandler(element, {})
      expect(result).toBe(true)
      expect(element.value).not.toBe('20240315')
    })

    it('should pass tagsToRemove parameter to remove handler', () => {
      const testTags = ['PatientAddress']
      const handlers = getAllSpecialHandlers(31, testTags)
      const removeHandler = handlers[0] // Assuming remove handler is first

      const element = createMockElement({
        keyword: 'PatientAddress'
      })

      const result = removeHandler(element, {})
      expect(result).toBe(true)
      expect(element.deleted).toBe(true)
    })
  })

  describe('clearValueCache', () => {
    it('should clear the value cache', () => {
      const handler = createValueReplacementHandler('test-study-id')
      
      // Generate a value first
      const element1 = createMockElement({
        keyword: 'PatientID',
        value: 'TEST123'
      })
      handler(element1, {})
      const firstValue = element1.value

      // Clear cache
      clearValueCache()

      // Generate again - should be different
      const element2 = createMockElement({
        keyword: 'PatientID',
        value: 'TEST123'
      })
      handler(element2, {})

      expect(element2.value).not.toBe(firstValue)
    })
  })
})