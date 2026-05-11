import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { FileHandler } from './index'
import { TestFileHandlerLayer } from '@/services/shared/test-layers'

describe('FileHandler Service (Effect Service Testing)', () => {
  // Test the service through Effect.provide pattern
  const runTest = <A, E>(effect: Effect.Effect<A, E, FileHandler>) =>
    Effect.runPromise(effect.pipe(
      Effect.provide(TestFileHandlerLayer)
    ))

  describe('DICOM file validation', () => {
    it('should validate DICOM files with DICM magic number', async () => {
      // Create a minimal DICOM-like buffer with DICM magic at position 128
      const buffer = new ArrayBuffer(200)
      const view = new DataView(buffer)
      
      // Set DICM magic number at position 128
      view.setUint8(128, 'D'.charCodeAt(0))
      view.setUint8(129, 'I'.charCodeAt(0))
      view.setUint8(130, 'C'.charCodeAt(0))
      view.setUint8(131, 'M'.charCodeAt(0))

      const result = await runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.validateDicomFile(buffer, 'test.dcm')
      }))
      
      expect(result).toBe(true)
    })

    it('should validate DICOM files by extension', async () => {
      const buffer = new ArrayBuffer(100)
      
      const result = await runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.validateDicomFile(buffer, 'test.dcm')
      }))
      
      expect(result).toBe(true)
    })

    it('should reject empty files', async () => {
      const buffer = new ArrayBuffer(0)
      
      await expect(
        runTest(Effect.gen(function* () {
          const fileHandler = yield* FileHandler
          return yield* fileHandler.validateDicomFile(buffer, 'empty.dcm')
        }))
      ).rejects.toThrow('File empty.dcm is empty')
    })

    it('should handle files without extensions by checking DICOM patterns', async () => {
      const buffer = new ArrayBuffer(2000)
      const view = new DataView(buffer)
      
      // Set DICOM group tag 0x0008 at beginning
      view.setUint16(0, 0x0008, true)
      view.setUint16(2, 0x0000, true)

      const result = await runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.validateDicomFile(buffer, 'noextension')
      }))
      
      expect(result).toBe(true)
    })
  })

  describe('File operations', () => {
    it('should handle single file reading', async () => {
      // Create a mock File object
      const mockArrayBuffer = new ArrayBuffer(1000)
      const mockFile = {
        name: 'test.dcm',
        size: 1000,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer)
      } as File

      const result = await runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.readSingleDicomFile(mockFile)
      }))
      
      expect(result).toBeDefined()
      expect(result.fileName).toBe('test.dcm')
      expect(result.fileSize).toBe(1000)
      expect(result.arrayBuffer).toEqual(mockArrayBuffer)
      expect(result.anonymized).toBe(false)
    })

    it('should handle file reading errors gracefully', async () => {
      const mockFile = {
        name: 'error.dcm',
        size: 1000,
        arrayBuffer: () => Promise.reject(new Error('Read failed'))
      } as File

      await expect(
        runTest(Effect.gen(function* () {
          const fileHandler = yield* FileHandler
          return yield* fileHandler.readSingleDicomFile(mockFile)
        }))
      ).rejects.toThrow('Failed to read file: error.dcm')
    })

    it('should handle ZIP extraction (simplified test)', async () => {
      // For this test, we'll create a simple mock file
      // In reality, ZIP extraction requires proper ZIP file structure
      const mockFile = {
        name: 'test.zip',
        size: 100,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
      } as File

      // Mock layer returns empty array for simplicity
      const result = await runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.extractZipFile(mockFile)
      }))
      
      expect(result).toEqual([]) // Mock layer returns empty array
    })
  })

  describe('Error handling', () => {
    it('should provide detailed error information for validation failures', async () => {
      const buffer = new ArrayBuffer(50) // Too small and no DICM magic
      
      const result = await runTest(Effect.gen(function* () {
        const fileHandler = yield* FileHandler
        return yield* fileHandler.validateDicomFile(buffer, 'invalid.txt') // Use non-DICOM extension
      }))
      
      expect(result).toBe(false) // Should return false for invalid files, not throw
    })

    it('should handle file reading errors with proper context', async () => {
      const mockFile = {
        name: 'failing-file.dcm',
        size: 1000,
        arrayBuffer: () => Promise.reject(new Error('Network error'))
      } as File

      try {
        await runTest(Effect.gen(function* () {
          const fileHandler = yield* FileHandler
          return yield* fileHandler.readSingleDicomFile(mockFile)
        }))
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).toContain('Failed to read file: failing-file.dcm')
      }
    })
  })
})