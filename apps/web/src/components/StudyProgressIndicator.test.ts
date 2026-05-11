import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { mount } from '@vue/test-utils'
import StudyProgressIndicator from './StudyProgressIndicator.vue'
import { useSendingProgress } from '@/composables/useSendingProgress'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'

const mockLogs = ref<Record<string, Array<{ ts: number; level: 'info' | 'warn' | 'error'; message: string; details?: unknown }>>>({})

vi.mock('@/composables/useStudyLogs', () => ({
  useStudyLogs: () => ({
    getLogs: vi.fn().mockResolvedValue([]),
    logsFor: (studyId: string) => computed(() => mockLogs.value[studyId] ?? [])
  })
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: {
    template: '<div><slot /></div>'
  },
  TooltipTrigger: {
    template: '<div><slot /></div>'
  },
  TooltipContent: {
    template: '<div><slot /></div>'
  }
}))

const { setStudySendingProgress, clearAllSendingProgress } = useSendingProgress()
const { setStudyProgress, clearAllProgress } = useAnonymizationProgress()

afterEach(() => {
  clearAllSendingProgress()
  clearAllProgress()
  mockLogs.value = {}
})

describe('StudyProgressIndicator', () => {
  it('shows compact sending progress without file-level detail in the table', () => {
    setStudySendingProgress('study-1', {
      isProcessing: true,
      progress: 45,
      totalFiles: 10,
      sentCount: 4,
      failedCount: 1,
      currentFile: 'slice-0042.dcm',
      retryingFile: 'report.sr',
      retryAttempt: 1,
      statusText: 'Retry 1/2 for report.sr'
    })

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-1',
        totalFiles: 10,
        sentFiles: 4,
        showOnly: 'sending'
      }
    })

    expect(wrapper.text()).toContain('Sending...')
    expect(wrapper.text()).toContain('45%')
    expect(wrapper.text()).not.toContain('5/10')
    expect(wrapper.text()).not.toContain('Retry 1/2 for report.sr')
    expect(wrapper.text()).not.toContain('report.sr')
  })

  it('shows compact anonymization progress without the current filename', () => {
    setStudyProgress('study-2', {
      isProcessing: true,
      progress: 27,
      totalFiles: 100,
      currentFile: 'nested/very/long/path/image-0001.dcm'
    })

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-2',
        totalFiles: 100,
        anonymizedFiles: 0,
        showOnly: 'anonymization'
      }
    })

    expect(wrapper.text()).toContain('Processing...')
    expect(wrapper.text()).toContain('27%')
    expect(wrapper.text()).not.toContain('nested/very/long/path/image-0001.dcm')
  })

  it('does not show a failure indicator in the anonymization cell', () => {
    mockLogs.value = {
      'study-2a': [
        {
          ts: Date.now(),
          level: 'error',
          message: 'File send failed',
          details: { fileName: 'late-report.sr' }
        }
      ]
    }

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-2a',
        totalFiles: 100,
        anonymizedFiles: 100,
        showOnly: 'anonymization'
      }
    })

    expect(wrapper.find('[aria-label="Show failure details"]').exists()).toBe(false)
  })

  it('shows anonymization failures in the anonymization cell', () => {
    mockLogs.value = {
      'study-2b': [
        {
          ts: Date.now(),
          level: 'error',
          message: 'Anonymization error',
          details: { message: 'Cannot anonymize file image.dcm: Array buffer allocation failed' }
        }
      ]
    }

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-2b',
        totalFiles: 100,
        anonymizedFiles: 42,
        showOnly: 'anonymization'
      }
    })

    const indicator = wrapper.get('[aria-label="Show failure details"]')
    expect(indicator.attributes('title')).toContain('1 failure')
    expect(indicator.attributes('title')).toContain('Array buffer allocation failed')
    expect(wrapper.text()).toContain('Partial')
  })

  it('shows a failure indicator with hover text for real failures', () => {
    mockLogs.value = {
      'study-3': [
        {
          ts: Date.now(),
          level: 'error',
          message: 'File send failed',
          details: { fileName: 'late-report.sr' }
        }
      ]
    }

    setStudySendingProgress('study-3', {
      isProcessing: false,
      progress: 100,
      totalFiles: 12,
      sentCount: 10,
      failedCount: 2,
      statusText: 'Partial: 10 sent, 2 failed',
      lastFailureKind: 'server-reported',
      lastFailedFile: 'late-report.sr'
    })

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-3',
        totalFiles: 12,
        sentFiles: 10,
        showOnly: 'sending'
      }
    })

    const indicator = wrapper.get('[aria-label="Show failure details"]')
    expect(indicator.attributes('title')).toContain('2 failures')
    expect(indicator.attributes('title')).toContain('Send failed: late-report.sr')
    expect(indicator.attributes('title')).toContain('More info is available in the logs.')
    expect(wrapper.text()).toContain('Partial')
  })

  it('shows a stop button while sending and calls the cancel action', async () => {
    const cancelStudySend = vi.fn()

    setStudySendingProgress('study-5', {
      isProcessing: true,
      progress: 25,
      totalFiles: 20,
      sentCount: 5,
      failedCount: 0,
      statusText: 'Sending study'
    })

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-5',
        totalFiles: 20,
        sentFiles: 0,
        showOnly: 'sending'
      },
      global: {
        provide: {
          studyActions: {
            cancelStudySend
          }
        }
      }
    })

    await wrapper.get('[aria-label="Stop sending"]').trigger('click')
    expect(cancelStudySend).toHaveBeenCalledWith('study-5')
  })

  it('shows cancelled after sending is stopped', () => {
    setStudySendingProgress('study-6', {
      isProcessing: false,
      progress: 25,
      totalFiles: 20,
      sentCount: 5,
      failedCount: 0,
      statusText: 'Send cancelled'
    })

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-6',
        totalFiles: 20,
        sentFiles: 0,
        showOnly: 'sending'
      }
    })

    expect(wrapper.text()).toContain('Cancelled')
    expect(wrapper.text()).not.toContain('Processing...')
  })

  it('shows sent when all files were sent successfully', () => {
    setStudySendingProgress('study-7', {
      isProcessing: false,
      progress: 100,
      totalFiles: 34,
      sentCount: 34,
      failedCount: 0,
      statusText: 'Sent 34/34 file(s)'
    })

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-7',
        totalFiles: 34,
        sentFiles: 34,
        showOnly: 'sending'
      }
    })

    expect(wrapper.text()).toContain('Sent')
    expect(wrapper.text()).not.toContain('Partial')
  })

  it('does not show the failure indicator for warnings only', () => {
    mockLogs.value = {
      'study-4': [
        {
          ts: Date.now(),
          level: 'warn',
          message: 'Server warning for sent file',
          details: { fileName: 'late-report.sr' }
        }
      ]
    }

    const wrapper = mount(StudyProgressIndicator, {
      props: {
        studyId: 'study-4',
        totalFiles: 12,
        sentFiles: 12,
        showOnly: 'sending'
      }
    })

    expect(wrapper.find('[aria-label="Show failure details"]').exists()).toBe(false)
  })
})
