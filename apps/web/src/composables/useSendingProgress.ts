import { ref, computed } from 'vue'

export interface StudySendingProgress {
  isProcessing: boolean
  progress: number
  totalFiles: number
  sentCount?: number
  failedCount?: number
  currentFile?: string
  retryingFile?: string
  retryAttempt?: number
  statusText?: string
  lastFailureKind?: string
  lastFailedFile?: string
}

// Global state for sending progress
const studySendingProgressMap = ref<Map<string, StudySendingProgress>>(new Map())

export function useSendingProgress() {
  
  const setStudySendingProgress = (studyId: string, progress: StudySendingProgress) => {
    console.log('Setting sending progress for study:', studyId, progress)
    studySendingProgressMap.value.set(studyId, progress)
    // Force reactivity by creating a new Map
    studySendingProgressMap.value = new Map(studySendingProgressMap.value)
    console.log('Sending progress map now has:', studySendingProgressMap.value.size, 'entries')
  }

  const getStudySendingProgress = (studyId: string) => {
    return computed(() => studySendingProgressMap.value.get(studyId))
  }

  const removeStudySendingProgress = (studyId: string) => {
    studySendingProgressMap.value.delete(studyId)
    // Force reactivity by creating a new Map
    studySendingProgressMap.value = new Map(studySendingProgressMap.value)
  }

  const clearAllSendingProgress = () => {
    studySendingProgressMap.value.clear()
    // Force reactivity by creating a new Map
    studySendingProgressMap.value = new Map()
  }

  const isStudySending = (studyId: string): boolean => {
    return studySendingProgressMap.value.get(studyId)?.isProcessing || false
  }

  const getStudySendingProgressPercentage = (studyId: string): number => {
    return studySendingProgressMap.value.get(studyId)?.progress || 0
  }

  return {
    studySendingProgressMap,
    setStudySendingProgress,
    getStudySendingProgress,
    removeStudySendingProgress,
    clearAllSendingProgress,
    isStudySending,
    getStudySendingProgressPercentage
  }
}
