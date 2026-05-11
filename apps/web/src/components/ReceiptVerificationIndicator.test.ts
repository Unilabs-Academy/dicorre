import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { mount } from '@vue/test-utils'
import ReceiptVerificationIndicator from './ReceiptVerificationIndicator.vue'
import type { ReceiptVerificationRecord } from '@/services/receiptVerification'

const records = ref<Record<string, ReceiptVerificationRecord | undefined>>({})

vi.mock('@/composables/useReceiptVerification', () => ({
  useReceiptVerification: () => ({
    recordFor: (studyId: string) => computed(() => records.value[studyId])
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

const makeRecord = (state: ReceiptVerificationRecord['state']): ReceiptVerificationRecord => ({
  studyInstanceUID: 'study-1',
  accessionNumber: 'ACC-1',
  patientId: 'PAT-1',
  expectedInstanceCount: 2,
  state,
  provider: 'dicomweb-qido',
  attempts: 1,
  checkedAt: '2026-05-11T10:00:00.000Z',
  deadlineAt: '2026-05-11T10:01:00.000Z',
  message: `State is ${state}`,
})

afterEach(() => {
  records.value = {}
})

describe('ReceiptVerificationIndicator', () => {
  it('shows a dash before all files in the study are sent', () => {
    const wrapper = mount(ReceiptVerificationIndicator, {
      props: {
        studyId: 'study-1',
        sentFiles: 1,
        totalFiles: 2,
      },
    })

    expect(wrapper.get('[data-testid="cell-received"]').text()).toBe('-')
  })

  it('shows waiting state while verification is polling', () => {
    records.value = { 'study-1': makeRecord('waiting') }

    const wrapper = mount(ReceiptVerificationIndicator, {
      props: {
        studyId: 'study-1',
        sentFiles: 2,
        totalFiles: 2,
      },
    })

    expect(wrapper.text()).toContain('Checking')
    expect(wrapper.text()).toContain('Attempts: 1')
  })

  it('shows received for verified studies', () => {
    records.value = { 'study-1': makeRecord('verified') }

    const wrapper = mount(ReceiptVerificationIndicator, {
      props: {
        studyId: 'study-1',
        sentFiles: 2,
        totalFiles: 2,
      },
    })

    expect(wrapper.get('[data-testid="cell-received"]').text()).toContain('Received')
  })

  it('shows terminal failure states', () => {
    records.value = { 'study-1': makeRecord('timeout') }

    const wrapper = mount(ReceiptVerificationIndicator, {
      props: {
        studyId: 'study-1',
        sentFiles: 2,
        totalFiles: 2,
      },
    })

    expect(wrapper.get('[data-testid="cell-received"]').text()).toContain('Timeout')
    expect(wrapper.text()).toContain('State is timeout')
  })
})
