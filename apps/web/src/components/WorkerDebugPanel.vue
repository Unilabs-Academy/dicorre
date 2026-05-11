<template>
  <div class="fixed bottom-4 right-4 z-50">
    <!-- Toggle Button -->
    <button
      v-if="!isVisible"
      @click="isVisible = true"
      class="bg-blue-600 text-white p-2 rounded-full shadow-lg hover:bg-blue-700 transition-colors"
      title="Show Worker Debug Panel"
    >
      <Bug class="w-5 h-5" />
    </button>

    <!-- Debug Panel -->
    <div
      v-if="isVisible"
      class="bg-white border border-gray-200 rounded-lg shadow-xl w-96 max-h-96 overflow-hidden"
    >
      <!-- Header -->
      <div class="bg-primary-light-gray px-4 py-2 flex items-center justify-between border-b">
        <h3 class="font-medium text-sm">Worker Debug Panel</h3>
        <button
          @click="isVisible = false"
          class="text-gray-500 hover:text-gray-700"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Content -->
      <div class="p-4 space-y-4 overflow-y-auto max-h-80">
        <!-- Worker Pool Status -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-medium text-gray-700">Worker Pool Status</h4>
            <span 
              class="px-2 py-1 rounded text-xs font-medium"
              :class="workerStatus.totalWorkers > 0 
                ? 'bg-green-100 text-green-700' 
                : 'bg-red-100 text-red-700'"
            >
              {{ workerStatus.totalWorkers > 0 ? 'ENABLED' : 'DISABLED' }}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div class="bg-blue-50 p-2 rounded border">
              <div class="text-blue-700 font-medium">Total Workers</div>
              <div class="text-lg font-bold text-blue-900">{{ workerStatus.totalWorkers }}</div>
            </div>
            <div class="bg-green-50 p-2 rounded border">
              <div class="text-green-700 font-medium">Active Jobs</div>
              <div class="text-lg font-bold text-green-900">{{ workerStatus.activeJobs }}</div>
            </div>
            <div class="bg-yellow-50 p-2 rounded border">
              <div class="text-yellow-700 font-medium">Queued Jobs</div>
              <div class="text-lg font-bold text-yellow-900">{{ workerStatus.queuedJobs }}</div>
            </div>
          </div>
        </div>

        <!-- Individual Workers -->
        <div class="space-y-2" v-if="workerDetails.length > 0">
          <h4 class="text-sm font-medium text-gray-700">Individual Workers</h4>
          <div class="space-y-1">
            <div
              v-for="worker in workerDetails"
              :key="`${worker.type}-${worker.id}`"
              class="text-xs p-2 rounded border"
              :class="worker.isAvailable ? 'bg-gray-50 border-gray-200' : 'bg-green-50 border-green-200'"
            >
              <div class="flex items-center justify-between">
                <span class="font-mono">
                  <span 
                    class="inline-block px-1 py-0.5 rounded text-[10px] font-medium mr-1"
                    :class="worker.type === 'anonymization' 
                      ? 'bg-purple-100 text-purple-700' 
                      : 'bg-blue-100 text-blue-700'"
                  >
                    {{ worker.type === 'anonymization' ? 'ANON' : 'SEND' }}
                  </span>
                  Worker #{{ worker.id }}
                </span>
                <span
                  class="px-2 py-1 rounded text-xs font-medium"
                  :class="worker.isAvailable 
                    ? 'bg-gray-100 text-gray-700' 
                    : 'bg-green-100 text-green-700'"
                >
                  {{ worker.isAvailable ? 'Idle' : 'Busy' }}
                </span>
              </div>
              <div v-if="!worker.isAvailable && worker.currentJob" class="mt-1 text-gray-600">
                <div>Study: {{ worker.currentJob.studyId.slice(0, 12) }}...</div>
                <div>Files: {{ worker.currentJob.fileCount }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Messages -->
        <div class="space-y-2">
          <h4 class="text-sm font-medium text-gray-700">Recent Messages</h4>
          <div class="space-y-1 max-h-32 overflow-y-auto">
            <div
              v-for="message in recentMessages.slice(-5)"
              :key="message.id"
              class="text-xs p-2 rounded border bg-gray-50"
            >
              <div class="flex items-center justify-between">
                <span class="font-mono text-gray-600">{{ message.timestamp }}</span>
                <span
                  class="px-2 py-1 rounded text-xs font-medium"
                  :class="getMessageTypeClass(message.type)"
                >
                  {{ message.type }}
                </span>
              </div>
              <div class="mt-1 text-gray-700 break-all">{{ message.content }}</div>
            </div>
          </div>
        </div>

        <!-- Worker Manager Controls -->
        <div class="space-y-2">
          <h4 class="text-sm font-medium text-gray-700">Controls</h4>
          <div class="flex gap-2">
            <button
              @click="refreshStatus"
              class="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            >
              <RefreshCw class="w-3 h-3 inline mr-1" />
              Refresh
            </button>
            <button
              @click="clearMessages"
              class="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
            >
              Clear Messages
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Bug, X, RefreshCw } from 'lucide-vue-next'
import { useWorkerDebug } from '@/composables/useWorkerDebug'

const isVisible = ref(false)

const {
  workerStatus,
  workerDetails,
  recentMessages,
  refreshStatus,
  clearMessages
} = useWorkerDebug()

// Auto-refresh status every 2 seconds when panel is visible
let refreshInterval: NodeJS.Timeout | null = null

onMounted(() => {
  refreshInterval = setInterval(() => {
    if (isVisible.value) {
      refreshStatus()
    }
  }, 2000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})

function getMessageTypeClass(type: string) {
  switch (type) {
    case 'create':
      return 'bg-blue-100 text-blue-700'
    case 'assign':
      return 'bg-green-100 text-green-700'
    case 'progress':
      return 'bg-yellow-100 text-yellow-700'
    case 'complete':
      return 'bg-green-100 text-green-700'
    case 'error':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}
</script>