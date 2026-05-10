import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Effect } from 'effect'
import { OPFSStorage, OPFSStorageLive } from './index'

// Mock the File System Access API since it's not available in test environment
const mockFileSystemAccess = () => {
  const mockWritable = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  }

  const mockFileHandle = {
    getFile: vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100))
    }),
    createWritable: vi.fn().mockResolvedValue(mockWritable)
  }

  const mockDirectoryHandle = {
    getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
    removeEntry: vi.fn().mockResolvedValue(undefined),
    values: vi.fn().mockReturnValue([
      { kind: 'file', name: 'test1.dcm' },
      { kind: 'file', name: 'test2.dcm' }
    ][Symbol.iterator]())
  }

  const mockNavigatorStorage = {
    getDirectory: vi.fn().mockResolvedValue({
      getDirectoryHandle: vi.fn().mockResolvedValue(mockDirectoryHandle)
    }),
    estimate: vi.fn().mockResolvedValue({
      usage: 1000,
      quota: 10000
    })
  }

  // Mock navigator.storage
  Object.defineProperty(global.navigator, 'storage', {
    value: mockNavigatorStorage,
    writable: true
  })

  return {
    mockWritable,
    mockFileHandle,
    mockDirectoryHandle,
    mockNavigatorStorage
  }
}

describe('OPFSStorage Service (Effect Service Testing)', () => {
  // Test the service through Effect.provide pattern
  const runTest = <A, E>(effect: Effect.Effect<A, E, OPFSStorage>) =>
    Effect.runPromise(effect.pipe(Effect.provide(OPFSStorageLive)))
    
  let mocks: ReturnType<typeof mockFileSystemAccess>

  beforeEach(() => {
    mocks = mockFileSystemAccess()
  })

  describe('Storage information', () => {
    it('should get storage info', async () => {
      const info = await runTest(Effect.gen(function* () {
        const storage = yield* OPFSStorage
        return yield* storage.getStorageInfo
      }))
      
      expect(info).toBeDefined()
      expect(typeof info.used).toBe('number')
      expect(typeof info.quota).toBe('number')
    })
  })

  describe('File operations', () => {
    it('should save files', async () => {
      const fileId = 'test-file'
      const arrayBuffer = new ArrayBuffer(100)

      await expect(
        runTest(Effect.gen(function* () {
          const storage = yield* OPFSStorage
          return yield* storage.saveFile(fileId, arrayBuffer)
        }))
      ).resolves.not.toThrow()
      
      expect(mocks.mockFileHandle.createWritable).toHaveBeenCalled()
      expect(mocks.mockWritable.write).toHaveBeenCalledWith(arrayBuffer)
      expect(mocks.mockWritable.close).toHaveBeenCalled()
    })

    it('should reject empty file IDs', async () => {
      const arrayBuffer = new ArrayBuffer(100)

      await expect(
        runTest(Effect.gen(function* () {
          const storage = yield* OPFSStorage
          return yield* storage.saveFile('', arrayBuffer)
        }))
      ).rejects.toThrow()
    })

    it('should load files', async () => {
      const fileId = 'test-file'

      const result = await runTest(Effect.gen(function* () {
        const storage = yield* OPFSStorage
        return yield* storage.loadFile(fileId)
      }))
      
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(100)
    })

    it('should list files', async () => {
      const fileIds = await runTest(Effect.gen(function* () {
        const storage = yield* OPFSStorage
        return yield* storage.listFiles
      }))
      
      expect(fileIds).toEqual(['test1', 'test2'])
    })
  })
})