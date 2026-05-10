import { ref, watch, type Ref } from 'vue'
import { Effect } from 'effect'
import type { RuntimeType } from '@/types/effects'
import { SessionPersistence } from '@/services/sessionPersistence'
import type { DicomFile, DicomStudy } from '@/types/dicom'

export function useSessionPersistence(
  runtime: RuntimeType,
  extractedDicomFiles: Ref<DicomFile[]>,
  studies: Ref<DicomStudy[]>
) {
  const isRestoring = ref(false)
  const restoreProgress = ref(0)

  // Persist current session to localStorage + OPFS
  async function persist() {
    if (extractedDicomFiles.value.length === 0) return
    await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionPersistence
        yield* svc.persist(extractedDicomFiles.value, studies.value)
      })
    )
  }

  // Watch for changes to extracted files and studies and persist automatically
  watch(extractedDicomFiles, persist, { deep: true })
  watch(studies, persist, { deep: true })

  // Restore previous session (if any)
  async function restore() {
    isRestoring.value = true
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* SessionPersistence
          return yield* svc.restore((p) => restoreProgress.value = p)
        })
      )
      extractedDicomFiles.value = result.files
      studies.value = result.studies
    } finally {
      isRestoring.value = false
    }
  }

  // Clear persisted session (localStorage + OPFS)j
  async function clear() {
    await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionPersistence
        return yield* svc.clear
      })
    )
  }

  return {
    restore,
    clear,
    isRestoring,
    restoreProgress
  }
}
