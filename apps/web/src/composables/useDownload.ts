import { ref, reactive, markRaw } from 'vue'
import { Effect } from 'effect'
import { DownloadService } from '@/services/downloadService'
import type { DicomStudy } from '@/types/dicom'
import type { RuntimeType } from '@/types/effects'
import { toast } from 'vue-sonner'
import DownloadToast from '@/components/DownloadToast.vue'
import type { DownloadFile } from '@/components/DownloadToast.vue'

export function useDownload(runtime: RuntimeType) {
  const isDownloading = ref(false)

  const downloadSelectedStudies = async (studies: DicomStudy[], selectedStudies: DicomStudy[]) => {
    if (selectedStudies.length === 0) {
      toast.warning('No studies selected for download')
      return
    }

    isDownloading.value = true

    // Reactive state that the toast component will read
    const toastState = reactive({
      status: 'preparing' as 'preparing' | 'ready' | 'error',
      files: [] as DownloadFile[],
      studyCount: selectedStudies.length,
      errorMessage: undefined as string | undefined,
    })

    // Show the custom toast — it stays until the user closes it
    const toastId = toast.custom(markRaw(DownloadToast), {
      duration: Infinity,
      componentProps: toastState,
    })

    try {
      const studyIds = selectedStudies.map((study) => study.studyInstanceUID)

      const blobs = await runtime.runPromise(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        }),
      )

      // Generate filenames
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[:]/g, '-')
      const baseName =
        selectedStudies.length === 1
          ? `DICOM_Study_${selectedStudies[0].patientId || 'Unknown'}_${timestamp}`
          : `DICOM_Studies_${selectedStudies.length}_${timestamp}`

      const files: DownloadFile[] =
        blobs.length === 1
          ? [{ blob: blobs[0], filename: `${baseName}.zip` }]
          : blobs.map((blob, i) => ({
              blob,
              filename: `${baseName}_Part${i + 1}of${blobs.length}.zip`,
            }))

      // Update the toast to show download links
      toastState.status = 'ready'
      toastState.files = files

      // If single file, auto-trigger the download as well
      if (files.length === 1) {
        const url = URL.createObjectURL(files[0].blob)
        const link = document.createElement('a')
        link.href = url
        link.download = files[0].filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error('Download failed:', error)
      toastState.status = 'error'
      toastState.errorMessage = error instanceof Error ? error.message : 'Unknown error'
    } finally {
      isDownloading.value = false
    }
  }

  return {
    isDownloading,
    downloadSelectedStudies,
  }
}
