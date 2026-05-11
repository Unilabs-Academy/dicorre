import { ref, computed } from 'vue'

interface StudyProgress {
  isProcessing: boolean
  progress: number
  totalFiles: number
  currentFile?: string
}

// Outside main function to be global
const studyProgressMap = ref<Map<string, StudyProgress>>(new Map())

export function useAnonymizationProgress() {

  const setStudyProgress = (studyId: string, progress: StudyProgress) => {
    console.log('Setting progress for study:', studyId, progress)
    studyProgressMap.value.set(studyId, progress)
    // Force reactivity by creating a new Map
    studyProgressMap.value = new Map(studyProgressMap.value)
    console.log('Progress map now has:', studyProgressMap.value.size, 'entries')
  }

  const getStudyProgress = (studyId: string) => {
    return computed(() => studyProgressMap.value.get(studyId))
  }

  const removeStudyProgress = (studyId: string) => {
    studyProgressMap.value.delete(studyId)
    studyProgressMap.value = new Map(studyProgressMap.value)
  }

  const clearAllProgress = () => {
    studyProgressMap.value.clear()
    studyProgressMap.value = new Map()
  }

  const isStudyProcessing = (studyId: string): boolean => {
    return studyProgressMap.value.get(studyId)?.isProcessing || false
  }

  const getStudyProgressPercentage = (studyId: string): number => {
    return studyProgressMap.value.get(studyId)?.progress || 0
  }

  return {
    studyProgressMap,
    setStudyProgress,
    getStudyProgress,
    removeStudyProgress,
    clearAllProgress,
    isStudyProcessing,
    getStudyProgressPercentage
  }
}
