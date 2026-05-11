<script lang="ts" setup>
import { Download, Loader2, X, CheckCircle2 } from 'lucide-vue-next'

export interface DownloadFile {
  blob: Blob
  filename: string
}

const props = defineProps<{
  status: 'preparing' | 'ready' | 'error'
  files: DownloadFile[]
  studyCount: number
  errorMessage?: string
}>()

const emit = defineEmits<{
  closeToast: []
}>()

function triggerDownload(file: DownloadFile) {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div
    class="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-4 w-[356px]"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <!-- Preparing state -->
        <template v-if="props.status === 'preparing'">
          <div class="flex items-center gap-2">
            <Loader2 class="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
            <span class="text-sm font-medium">Preparing download...</span>
          </div>
          <p class="text-xs text-muted-foreground mt-1">
            Packaging {{ props.studyCount }} study(ies) into ZIP
          </p>
        </template>

        <!-- Ready state -->
        <template v-else-if="props.status === 'ready'">
          <div class="flex items-center gap-2 mb-2">
            <CheckCircle2 class="h-4 w-4 text-green-500 shrink-0" />
            <span class="text-sm font-medium">
              Download ready
              <span v-if="props.files.length > 1" class="text-muted-foreground font-normal">
                ({{ props.files.length }} parts)
              </span>
            </span>
          </div>
          <div class="flex flex-col gap-1.5">
            <button
              v-for="(file, index) in props.files"
              :key="index"
              class="flex items-center gap-2 text-xs text-primary hover:underline cursor-pointer text-left"
              @click="triggerDownload(file)"
            >
              <Download class="h-3.5 w-3.5 shrink-0" />
              <span class="truncate">{{ file.filename }}</span>
            </button>
          </div>
        </template>

        <!-- Error state -->
        <template v-else-if="props.status === 'error'">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-destructive">Download failed</span>
          </div>
          <p class="text-xs text-muted-foreground mt-1">
            {{ props.errorMessage || 'Unknown error' }}
          </p>
        </template>
      </div>

      <!-- Close button -->
      <button
        class="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Close"
        @click="emit('closeToast')"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
