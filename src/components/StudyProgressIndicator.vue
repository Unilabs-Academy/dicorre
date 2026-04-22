<script setup lang="ts">
import { computed, inject, onMounted } from 'vue'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import { useStudyLogs } from '@/composables/useStudyLogs'
import type { StudyLogEntry } from '@/services/studyLogger'

interface Props {
  studyId: string
  totalFiles: number
  anonymizedFiles?: number
  sentFiles?: number
  showOnly?: 'anonymization' | 'sending'
}

interface IndicatorStatus {
  showProgress: boolean
  text?: string
  label?: string
  variant: 'default' | 'secondary' | 'destructive'
}

const props = defineProps<Props>()
const { getStudyProgress } = useAnonymizationProgress()
const { getStudySendingProgress } = useSendingProgress()
const { getLogs, logsFor } = useStudyLogs()
const studyActions = inject<{ cancelStudySend?: (studyId: string) => void }>('studyActions', {})

// Get real-time progress from global state
const progressInfo = getStudyProgress(props.studyId)
const sendingProgressInfo = getStudySendingProgress(props.studyId)
const logEntries = logsFor(props.studyId)

const REAL_FAILURE_MESSAGES = new Set([
  'Anonymization error',
  'File send failed',
  'Send error',
  'No anonymized files to send; aborted'
])

onMounted(() => {
  void getLogs(props.studyId)
})

const toDetailsRecord = (details: unknown): Record<string, unknown> | undefined =>
  details && typeof details === 'object' ? details as Record<string, unknown> : undefined

const summarizeFailure = (entry: StudyLogEntry): string => {
  const details = toDetailsRecord(entry.details)
  const fileName = typeof details?.fileName === 'string' ? details.fileName : undefined
  const message = typeof details?.message === 'string' ? details.message : undefined

  switch (entry.message) {
    case 'File send failed':
      return fileName ? `Send failed: ${fileName}` : 'Send failed'
    case 'Anonymization error':
      return message ? `Anonymization failed: ${message}` : 'Anonymization failed'
    case 'Send error':
      return message ? `Send error: ${message}` : 'Send error'
    default:
      return entry.message
  }
}

const failureEntries = computed(() =>
  logEntries.value.filter((entry) => entry.level === 'error' && REAL_FAILURE_MESSAGES.has(entry.message))
)

const failureSummaryLines = computed(() => failureEntries.value.slice(0, 5).map(summarizeFailure))
const failureCount = computed(() => Math.max(failureEntries.value.length, sendingProgressInfo.value?.failedCount || 0))

const failureTooltipText = computed(() => {
  if (failureCount.value === 0) return ''

  if (failureSummaryLines.value.length === 0) {
    return `${failureCount.value} failure${failureCount.value === 1 ? '' : 's'}\nMore info is available in the logs.`
  }

  const heading = `${failureCount.value} failure${failureCount.value === 1 ? '' : 's'}`
  const extraCount = failureCount.value - failureSummaryLines.value.length
  const extraLine = extraCount > 0 ? `+${extraCount} more` : undefined

  return [heading, ...failureSummaryLines.value, extraLine, 'More info is available in the logs.'].filter(Boolean).join('\n')
})

const showFailureIndicator = computed(() => props.showOnly === 'sending' && failureCount.value > 0)
const showStopButton = computed(() => props.showOnly === 'sending' && !!sendingProgressInfo.value?.isProcessing && !!studyActions.cancelStudySend)

const cancelSending = () => {
  studyActions.cancelStudySend?.(props.studyId)
}

const status = computed<IndicatorStatus>(() => {
  const sending = sendingProgressInfo.value

  // Handle showOnly logic
  if (props.showOnly === 'sending') {
    if (sending?.statusText === 'Send cancelled') {
      return {
        showProgress: false,
        text: 'Cancelled',
        variant: 'secondary' as const
      }
    }

    if (sending?.isProcessing) {
      return {
        showProgress: true,
        text: `${Math.round(sending.progress || 0)}%`,
        label: 'Sending...',
        variant: 'secondary' as const
      }
    }

    if ((sending?.failedCount || 0) > 0) {
      return {
        showProgress: false,
        text: (sending?.sentCount || 0) > 0 ? 'Partial' : 'Failed',
        variant: (sending?.sentCount || 0) > 0 ? 'secondary' as const : 'destructive' as const
      }
    }

    if ((sending?.sentCount || 0) === (sending?.totalFiles || 0) && (sending?.sentCount || 0) > 0) {
      return {
        showProgress: false,
        text: 'Sent',
        variant: 'default' as const
      }
    }

    if (props.sentFiles === props.totalFiles && props.sentFiles > 0) {
      return {
        showProgress: false,
        text: 'Sent',
        variant: 'default' as const
      }
    }

    if ((props.sentFiles || 0) > 0) {
      return {
        showProgress: false,
        text: 'Partial',
        variant: 'secondary' as const
      }
    }

    return {
      showProgress: false,
      text: 'Not Sent',
      variant: 'destructive' as const
    }
  }

  if (props.showOnly === 'anonymization') {
    // Anonymization-only column
    if (progressInfo.value?.isProcessing) {
      return {
        showProgress: true,
        text: `${Math.round(progressInfo.value.progress || 0)}%`,
        label: 'Processing...',
        variant: 'secondary' as const
      }
    }

    if (props.anonymizedFiles === props.totalFiles && props.anonymizedFiles > 0) {
      return {
        showProgress: false,
        text: 'Anonymized',
        variant: 'default' as const
      }
    }

    if ((props.anonymizedFiles || 0) > 0) {
      return {
        showProgress: false,
        text: 'Partial',
        variant: 'secondary' as const
      }
    }

    return {
      showProgress: false,
      text: 'Not Anonymized',
      variant: 'destructive' as const
    }
  }

  // Original combined logic (fallback)
  if (sending?.statusText === 'Send cancelled') {
    return {
      showProgress: false,
      text: 'Cancelled',
      variant: 'secondary' as const
    }
  }

  if (sending?.isProcessing) {
    return {
      showProgress: true,
      text: `${Math.round(sending.progress || 0)}%`,
      label: 'Sending...',
      variant: 'secondary' as const
    }
  }

  if (progressInfo.value?.isProcessing) {
    return {
      showProgress: true,
      text: `${Math.round(progressInfo.value.progress || 0)}%`,
      label: 'Processing...',
      variant: 'secondary' as const
    }
  }

  if ((sending?.failedCount || 0) > 0) {
    return {
      showProgress: false,
      text: (sending?.sentCount || 0) > 0 ? 'Partial' : 'Failed',
      variant: (sending?.sentCount || 0) > 0 ? 'secondary' as const : 'destructive' as const
    }
  }

  if ((sending?.sentCount || 0) === (sending?.totalFiles || 0) && (sending?.sentCount || 0) > 0) {
    return {
      showProgress: false,
      text: 'Sent',
      variant: 'default' as const
    }
  }

  if (props.sentFiles === props.totalFiles && props.sentFiles > 0) {
    return {
      showProgress: false,
      text: 'Sent',
      variant: 'default' as const
    }
  }

  if ((props.sentFiles || 0) > 0) {
    return {
      showProgress: false,
      text: 'Partial Sent',
      variant: 'secondary' as const
    }
  }

  if ((props.anonymizedFiles || 0) === props.totalFiles && (props.anonymizedFiles || 0) > 0) {
    return {
      showProgress: false,
      text: 'Anonymized',
      variant: 'default' as const
    }
  }

  if ((props.anonymizedFiles || 0) > 0) {
    return {
      showProgress: false,
      text: 'Partial',
      variant: 'secondary' as const
    }
  }

  return {
    showProgress: false,
    text: 'Not Processed',
    variant: 'destructive' as const
  }
})

const progressValue = computed(() => {
  if (props.showOnly === 'sending') {
    if (sendingProgressInfo.value?.isProcessing) {
      return sendingProgressInfo.value.progress || 0
    }
    return ((props.sentFiles || 0) / props.totalFiles) * 100
  }

  if (props.showOnly === 'anonymization') {
    if (progressInfo.value?.isProcessing) {
      return progressInfo.value.progress || 0
    }
    return ((props.anonymizedFiles || 0) / props.totalFiles) * 100
  }

  // Original combined logic
  if (sendingProgressInfo.value?.isProcessing) {
    return sendingProgressInfo.value.progress || 0
  }
  if (progressInfo.value?.isProcessing) {
    return progressInfo.value.progress || 0
  }
  return ((props.anonymizedFiles || 0) / props.totalFiles) * 100
})
</script>

<template>
  <div class="min-w-[120px]">
    <div
      v-if="status.showProgress"
      class="space-y-1"
    >
      <div class="flex items-center justify-between gap-2 text-xs">
        <span class="min-w-0 truncate text-muted-foreground">{{ status.label }}</span>
        <div class="flex items-center gap-2 shrink-0">
          <span
            v-if="status.text"
            class="font-medium"
          >
            {{ status.text }}
          </span>
          <button
            v-if="showStopButton"
            type="button"
            class="inline-flex size-4 items-center justify-center rounded-sm border border-muted-foreground/30 text-[10px] font-semibold leading-none text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
            title="Stop sending"
            aria-label="Stop sending"
            @click.stop="cancelSending"
          >
            ×
          </button>
          <Tooltip
            v-if="showFailureIndicator"
            :delay-duration="0"
          >
            <TooltipTrigger asChild>
              <span
                aria-label="Show failure details"
                class="inline-flex size-4 items-center justify-center rounded-full border border-destructive text-[10px] font-semibold leading-none text-destructive"
                :title="failureTooltipText"
              >
                !
              </span>
            </TooltipTrigger>
            <TooltipContent class="max-w-72 whitespace-pre-line">
              {{ failureTooltipText }}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <Progress
        :model-value="progressValue"
        class="h-1.5"
      />
    </div>

    <div
      v-else
      class="flex items-center gap-2"
    >
      <Badge
        :variant="status.variant"
        class="min-w-[80px] justify-center"
      >
        {{ status.text }}
      </Badge>
      <Tooltip
        v-if="showFailureIndicator"
        :delay-duration="0"
      >
        <TooltipTrigger asChild>
          <span
            aria-label="Show failure details"
            class="inline-flex size-4 items-center justify-center rounded-full border border-destructive text-[10px] font-semibold leading-none text-destructive"
            :title="failureTooltipText"
          >
            !
          </span>
        </TooltipTrigger>
        <TooltipContent class="max-w-72 whitespace-pre-line">
          {{ failureTooltipText }}
        </TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
