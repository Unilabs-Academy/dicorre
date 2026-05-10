import { describe, it, expect, vi, afterEach } from 'vitest'
import { Effect } from 'effect'
import { PluginError } from '@/types/effects'
import { sendLoggerPlugin } from './index'
import type { DicomStudy } from '@/types/dicom'

describe('SendLogger Plugin', () => {
  // Mock console methods
  const consoleSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => { }),
    error: vi.spyOn(console, 'error').mockImplementation(() => { })
  }

  afterEach(() => {
    consoleSpy.log.mockClear()
    consoleSpy.error.mockClear()
  })

  describe('Plugin Properties', () => {
    it('should have correct plugin metadata', () => {
      expect(sendLoggerPlugin.id).toBe('send-logger')
      expect(sendLoggerPlugin.name).toBe('Send Logger')
      expect(sendLoggerPlugin.version).toBe('1.0.0')
      expect(sendLoggerPlugin.type).toBe('hook')
      expect(sendLoggerPlugin.enabled).toBe(true)
    })

    it('should have proper hook structure', () => {
      expect(sendLoggerPlugin.hooks.afterSend).toBeDefined()
      expect(sendLoggerPlugin.hooks.beforeSend).toBeDefined()
      expect(sendLoggerPlugin.hooks.onSendError).toBeDefined()
    })
  })

  describe('Hook Functionality', () => {
    const mockStudy: DicomStudy = {
      id: 'study-1',
      studyInstanceUID: '1.2.3.4.5',
      patientName: 'Test Patient',
      patientId: 'TEST123',
      accessionNumber: 'ACC123',
      studyDate: '20231201',
      studyDescription: 'Test Study',
      series: [
        {
          seriesInstanceUID: '1.2.3.4.5.1',
          seriesDescription: 'Test Series',
          modality: 'CT',
          files: [
            { id: 'file1', fileName: 'test1.dcm', fileSize: 1024, arrayBuffer: new ArrayBuffer(0) },
            { id: 'file2', fileName: 'test2.dcm', fileSize: 2048, arrayBuffer: new ArrayBuffer(0) }
          ]
        },
        {
          seriesInstanceUID: '1.2.3.4.5.2',
          seriesDescription: 'Test Series 2',
          modality: 'MR',
          files: [
            { id: 'file3', fileName: 'test3.dcm', fileSize: 3072, arrayBuffer: new ArrayBuffer(0) }
          ]
        }
      ]
    }

    it('should log before send', async () => {
      await Effect.runPromise(sendLoggerPlugin.hooks.beforeSend!(mockStudy) as Effect.Effect<void, PluginError, never>)

      expect(consoleSpy.log).toHaveBeenCalled()
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[SEND-LOGGER PLUGIN] Sending study')
      )
    })

    it('should log after successful send', async () => {
      await Effect.runPromise(sendLoggerPlugin.hooks.afterSend!(mockStudy) as Effect.Effect<void, PluginError, never>)

      expect(consoleSpy.log).toHaveBeenCalled()
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[SEND-LOGGER PLUGIN] Study sent')
      )
    })

    it.only('should log send errors', async () => {
      const error = new Error('Network connection failed')

      await Effect.runPromise(sendLoggerPlugin.hooks.onSendError!(mockStudy, error) as Effect.Effect<void, PluginError, never>)

      expect(consoleSpy.error).toHaveBeenCalled()
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[SEND-LOGGER PLUGIN] Send failed')
      )
    })
  })
})
