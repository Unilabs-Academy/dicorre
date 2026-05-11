<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Clock, Loader2, Minus, TriangleAlert, XCircle } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useReceiptVerification } from '@/composables/useReceiptVerification'

const props = defineProps<{
  studyId: string
  sentFiles: number
  totalFiles: number
}>()

const { recordFor } = useReceiptVerification()
const record = recordFor(props.studyId)

const state = computed(() => {
  if (props.totalFiles === 0 || props.sentFiles < props.totalFiles) return 'not_sent'
  return record.value?.state ?? 'not_started'
})

const descriptor = computed(() => {
  switch (state.value) {
    case 'waiting':
      return { text: 'Checking', variant: 'secondary' as const, icon: Loader2, spin: true }
    case 'verified':
      return { text: 'Received', variant: 'default' as const, icon: CheckCircle2 }
    case 'mismatch':
      return { text: 'Mismatch', variant: 'secondary' as const, icon: TriangleAlert }
    case 'count_mismatch':
      return { text: 'Count', variant: 'secondary' as const, icon: TriangleAlert }
    case 'not_found':
      return { text: 'Not found', variant: 'destructive' as const, icon: XCircle }
    case 'timeout':
      return { text: 'Timeout', variant: 'destructive' as const, icon: Clock }
    case 'error':
      return { text: 'Error', variant: 'destructive' as const, icon: XCircle }
    case 'not_sent':
    case 'not_started':
    default:
      return { text: '-', variant: 'outline' as const, icon: Minus }
  }
})

const tooltipText = computed(() => {
  if (!record.value) {
    return state.value === 'not_sent'
      ? 'Receipt verification starts after all files in the study are sent.'
      : 'Receipt verification has not started.'
  }

  const lines = [
    record.value.message,
    `Attempts: ${record.value.attempts}`,
    record.value.checkedAt ? `Last checked: ${new Date(record.value.checkedAt).toLocaleString()}` : undefined,
    record.value.deadlineAt ? `Cutoff: ${new Date(record.value.deadlineAt).toLocaleString()}` : undefined,
    record.value.backend?.numberImages !== undefined ? `Received images: ${record.value.backend.numberImages}` : undefined,
    record.value.nextCommand ? `CLI: ${record.value.nextCommand}` : undefined,
  ]
  return lines.filter(Boolean).join('\n')
})
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Badge
        :variant="descriptor.variant"
        class="inline-flex min-w-[96px] items-center justify-center gap-1.5 whitespace-nowrap"
        data-testid="cell-received"
      >
        <component
          :is="descriptor.icon"
          :class="['h-3.5 w-3.5', descriptor.spin ? 'animate-spin' : '']"
        />
        <span>{{ descriptor.text }}</span>
      </Badge>
    </TooltipTrigger>
    <TooltipContent>
      <div class="max-w-xs whitespace-pre-line text-xs">{{ tooltipText }}</div>
    </TooltipContent>
  </Tooltip>
</template>
