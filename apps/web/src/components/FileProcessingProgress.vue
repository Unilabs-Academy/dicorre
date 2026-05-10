<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Props {
  fileName: string
  currentStep: string
  progress: number
  totalFiles?: number
  currentFileIndex?: number
  error?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
}>()

const progressText = computed(() => {
  if (props.error) {
    return 'Failed'
  }
  if (props.totalFiles && props.currentFileIndex !== undefined) {
    return `${props.currentFileIndex + 1} of ${props.totalFiles} files`
  }
  return `${Math.round(props.progress)}%`
})

const cardClass = computed(() => {
  if (props.error) {
    return 'mb-1 border-destructive/20 bg-destructive/5'
  }
  return 'mb-2 border-primary/15 bg-primary/5'
})
</script>

<template>
  <Card
    :class="cardClass"
    data-testid="file-processing-progress-card"
    class="px-0 py-4 bg-white"
  >
    <CardContent>
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <div
              v-if="!error"
              class="animate-spin h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full"
            ></div>
            <div
              v-else
              class="h-3.5 w-3.5 rounded-full bg-destructive flex items-center justify-center"
            >
              <span class="text-xs text-destructive-foreground">✕</span>
            </div>
            <span class="font-medium text-xs">
              {{ `Processing ${fileName}` }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{{ progressText }}</span>
            </div>
            <button
              v-if="error"
              @click="emit('close')"
              class="ml-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close error"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <Progress
          :model-value="progress"
          class="h-1"
        />

        <div class="text-[11px] text-muted-foreground">
          {{ currentStep }}
        </div>

        <Alert
          v-if="error"
          class="mt-2 py-2"
        >
          <AlertDescription
            class="text-xs"
            data-testid="file-processing-progress-error"
          >
            {{ error }}
          </AlertDescription>
        </Alert>
      </div>
    </CardContent>
  </Card>
</template>
