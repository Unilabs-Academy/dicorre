import { ref, computed, onMounted } from 'vue'
import { Effect, Stream } from 'effect'
import type { DicomFile, DicomStudy } from '@/types/dicom'
import { CancelledError, type RuntimeType } from '@/types/effects'
import { DicomProcessor } from '@/services/dicomProcessor'
import { ConfigService } from '@/services/config'
import type { AppConfig, ProjectConfig } from '@/services/config/schema'
import { PluginRegistry } from '@/services/pluginRegistry'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import { useFileProcessing } from '@/composables/useFileProcessing'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useDicomSender } from '@/composables/useDicomSender'
import type {
  SendFailureResult,
  SendProgressUpdate,
  SendStudyResult,
  SendWarningResult
} from '@/services/dicomSender'
import { toast } from 'vue-sonner'
import { getAnonymizationWorkerManager } from '@/workers/workerManager'
import { StudyLogger } from '@/services/studyLogger'
import { serializeError } from '@/services/studyLogger/errorUtils'
import { OPFSStorage } from '@/services/opfsStorage'

export function useAppState(runtime: RuntimeType) {
  // Core application state
  const uploadedFiles = ref<File[]>([])
  const dicomFiles = ref<DicomFile[]>([])
  const studies = ref<DicomStudy[]>([])
  const successMessage = ref('')
  const concurrency = ref(3)
  const appError = ref<string | null>(null)

  // Configuration state
  const config = ref<AppConfig | null>(null)
  const configError = ref<Error | null>(null)
  const serverUrl = computed<string>(() => config.value?.dicomServer?.url ?? '')
  const configLoading = computed(() => config.value === null)

  // Project state
  const currentProject = computed<ProjectConfig | undefined>(() => config.value?.project)
  const isProjectMode = computed(() => !!currentProject.value)

  // Initialize composables
  const fileProcessing = useFileProcessing(runtime)
  const dragAndDrop = useDragAndDrop()
  const dicomSender = useDicomSender(runtime)

  // Progress and UI state management
  const { setStudyProgress, removeStudyProgress, clearAllProgress } = useAnonymizationProgress()
  const { getStudySendingProgress, setStudySendingProgress, removeStudySendingProgress, clearAllSendingProgress } = useSendingProgress()
  const { getSelectedStudies, clearSelection } = useTableState()

  const totalFiles = computed(() => dicomFiles.value.length)
  const anonymizedFilesCount = computed(() => dicomFiles.value.filter(file => file.anonymized).length)
  const LARGE_STUDY_WARNING_BYTES = 3 * 1024 * 1024 * 1024
  const VERY_LARGE_STUDY_WARNING_BYTES = 5 * 1024 * 1024 * 1024

  const selectedStudies = computed(() => getSelectedStudies(studies.value))
  const selectedStudiesCount = computed(() => selectedStudies.value.length)

  const setAppError = (err: Error | string) => {
    appError.value = typeof err === 'string' ? err : err.message
    console.error('App Error:', err)
  }

  const clearAppError = () => {
    appError.value = null
  }

  const summarizeFailureKinds = (failures: SendFailureResult[]): string =>
    Object.entries(
      failures.reduce<Record<string, number>>((acc, failure) => {
        acc[failure.failureKind] = (acc[failure.failureKind] || 0) + 1
        return acc
      }, {})
    )
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(', ')

  const summarizeFailedFiles = (failures: SendFailureResult[], limit = 5): string[] =>
    failures.slice(0, limit).map((failure) => failure.fileName)

  const getFinalSendStatusText = (result: SendStudyResult): string => {
    if (result.failedCount === 0) {
      return `Sent ${result.succeededCount}/${result.attempted} file(s)`
    }
    if (result.succeededCount === 0) {
      return `Failed ${result.failedCount}/${result.attempted} file(s)`
    }
    return `Partial: ${result.succeededCount} sent, ${result.failedCount} failed`
  }

  const getFinalSendProgress = (result: SendStudyResult): number =>
    result.attempted > 0 ? Math.round(((result.succeededCount + result.failedCount) / result.attempted) * 100) : 0

  const formatGiB = (bytes: number): string => `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`

  const groupAsSamePatient = async (): Promise<void> => {
    const selected = selectedStudies.value
    if (selected.length < 2) return

    // Require an existing assignedPatientId on at least one selected study
    const targetAssignedId = selected.find(s => s.assignedPatientId)?.assignedPatientId
    if (!targetAssignedId) {
      toast.error('Cannot group studies', {
        description: 'Assign a patient ID to one of the selected studies before grouping.'
      })
      return
    }

    // Apply to all selected studies
    const selectedUids = new Set(selected.map(s => s.studyInstanceUID))
    studies.value = studies.value.map(s => selectedUids.has(s.studyInstanceUID) ? { ...s, assignedPatientId: targetAssignedId } : s)

    // Mark files for the selected studies as no longer anonymized
    dicomFiles.value = dicomFiles.value.map(file => {
      const uid = file.metadata?.studyInstanceUID
      if (!uid || !selectedUids.has(uid)) return file
      return { ...file, anonymized: false }
    })

    // Rebuild affected studies so UI reflects updated file flags
    await Promise.all(selected.map(s => rebuildStudyAfterFileChanges(s.studyInstanceUID)))
  }

  const assignPatientIdToSelected = (patientId: string): void => {
    if (!patientId || selectedStudies.value.length === 0) return
    const selectedUids = new Set(selectedStudies.value.map(s => s.studyInstanceUID))
    studies.value = studies.value.map(s => selectedUids.has(s.studyInstanceUID) ? { ...s, assignedPatientId: patientId } : s)
  }

  const setCustomFieldsForSelected = (overrides: Record<string, string>): void => {
    const selectedUids = new Set(selectedStudies.value.map(s => s.studyInstanceUID))
    const normalized: Record<string, string> = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (!k.trim()) continue
      normalized[k] = String(v)
    }
    studies.value = studies.value.map(s => selectedUids.has(s.studyInstanceUID) ? { ...s, customFields: normalized } : s)
  }

  const mergeSelectedStudiesIntoOne = async (): Promise<void> => {
    const selected = selectedStudies.value
    if (selected.length < 2) return

    const parent = selected[0]
    const parentUID = parent.studyInstanceUID
    const parentAccession = parent.accessionNumber ?? ''
    const parentPatientId = parent.patientId ?? 'Unknown'
    const parentPatientName = parent.patientName ?? 'Unknown'
    const parentStudyDate = parent.studyDate
    const parentStudyDescription = parent.studyDescription
    const parentAssignedPatientId = parent.assignedPatientId

    const selectedUids = new Set(selected.map(s => s.studyInstanceUID))


    // Rewrite metadata on files for all selected studies so they collapse into the parent study
    dicomFiles.value = dicomFiles.value.map(file => {
      const m = file.metadata
      if (!m || !m.studyInstanceUID || !selectedUids.has(m.studyInstanceUID)) return file
      return {
        ...file,
        anonymized: false,
        metadata: {
          ...m,
          studyInstanceUID: parentUID,
          accessionNumber: parentAccession,
          patientId: parentPatientId,
          patientName: parentPatientName,
          studyDate: parentStudyDate,
          studyDescription: parentStudyDescription
        }
      }
    })

    try {
      const rebuilt = await runtime.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.groupFilesByStudy(dicomFiles.value)
        })
      )

      const next = rebuilt.map(s => {
        if (s.studyInstanceUID === parentUID) {
          return {
            ...s,
            assignedPatientId: parentAssignedPatientId ?? s.assignedPatientId,
            // Pin Study Instance UID during anonymization to prevent the merged study from splitting
            customFields: { ...(s.customFields ?? {}), 'Study Instance UID': parentUID }
          }
        }
        return s
      })
      studies.value = next

      // Clear progress for non-parent merged studies
      selected.forEach(s => {
        if (s.studyInstanceUID !== parentUID) {
          removeStudyProgress(s.studyInstanceUID)
          removeStudySendingProgress(s.studyInstanceUID)
        }
      })

      clearSelection()
      successMessage.value = `Merged ${selected.length} studies into one`
    } catch (error) {
      console.error('Failed to merge studies:', error)
      setAppError(error as Error)
    }
  }

  const loadConfig = async () => { /* stream-backed; kept for API compatibility */ }

  const loadServerUrl = async () => { /* replaced by stream; keep for API compatibility */ }

  const loadPlugins = async () => {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          const config = yield* configService.getCurrentConfig

          if ((config as any).plugins) {
            const registry = yield* PluginRegistry

            // Load configuration into registry
            yield* registry.loadPluginConfig((config as any).plugins)

            // Import and register plugins
            const { initializePlugins } = yield* Effect.tryPromise({
              try: () => import('@/plugins'),
              catch: (error) => new Error(`Failed to import plugins: ${error}`)
            })

            yield* initializePlugins()
          }
        })
      )
    } catch (err) {
      console.error('Failed to load plugins:', err)
    }
  }

  const loadProjectState = async () => { /* replaced by stream; keep for API compatibility */ }

  const handleCreateProject = async (name: string): Promise<void> => {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          const project = yield* configService.createProject(name)
          // Update only the project field, preserving all other config
          yield* configService.updateProject(project)
        })
      )

      // Stream will update config/currentProject
      toast.success(`Project "${name}" created`)
    } catch (error) {
      console.error('Failed to create project:', error)
      toast.error('Failed to create project')
      throw error
    }
  }

  const handleLoadConfig = async (configData: unknown): Promise<void> => {
    try {
      const loadedConfig = await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          yield* configService.loadConfig(configData)
          // Return the loaded config
          return yield* configService.getCurrentConfig
        })
      )

      // Show success toast if there's a project in the loaded config
      if (loadedConfig.project) {
        toast.success(`Loaded project: ${loadedConfig.project.name}`)
      } else {
        toast.success('Configuration loaded successfully')
      }
    } catch (error) {
      console.error('Failed to load configuration:', error)
      toast.error('Failed to load configuration')
      throw error
    }
  }

  const handleConfigReload = async () => { await loadConfig() }

  const processNewFiles = async (newFiles: File[], isAppReady: boolean) => {
    try {
      fileProcessing.addFiles(newFiles, {
        isAppReady,
        parseConcurrency: concurrency.value,
        onAppendFiles: (files: DicomFile[]) => {
          const nextFiles = [...dicomFiles.value, ...files]
          dicomFiles.value = nextFiles
          const previousById = new Map(studies.value.map(s => [s.id, s]))
          runtime.runPromise(
            Effect.gen(function* () {
              const processor = yield* DicomProcessor
              const cfgService = yield* ConfigService
              const cfg = yield* cfgService.getAnonymizationConfig
              const grouped = yield* processor.groupFilesByStudy(nextFiles)
              // Log parse results per study
              const logger = yield* StudyLogger
              for (const s of grouped) {
                const filesCount = s.series.reduce((sum, ser) => sum + ser.files.length, 0)
                yield* logger.append(s.id, { ts: Date.now(), level: 'info', message: `Parsed ${filesCount} file(s)` })
              }
              const withAssigned = yield* processor.assignPatientIds(grouped, cfg)
              const merged = withAssigned.map(s => {
                const prev = previousById.get(s.id)
                return prev
                  ? { ...s, assignedPatientId: prev.assignedPatientId ?? s.assignedPatientId, customFields: prev.customFields ?? s.customFields }
                  : s
              })
              studies.value = merged
            })
          ).catch(err => {
            console.error('Failed to group/assign patient IDs:', err)
            // Fallback: try grouping without assignment
            runtime.runPromise(
              Effect.gen(function* () {
                const processor = yield* DicomProcessor
                const groupedOnly = yield* processor.groupFilesByStudy(nextFiles)
                const previousById = new Map(studies.value.map(s => [s.id, s]))
                const merged = groupedOnly.map(s => {
                  const prev = previousById.get(s.id)
                  return prev
                    ? { ...s, assignedPatientId: prev.assignedPatientId ?? s.assignedPatientId, customFields: prev.customFields ?? s.customFields }
                    : s
                })
                studies.value = merged
              })
            ).catch(() => { })
          })
        }
      })
      successMessage.value = ''
    } catch (error) {
      console.error('Error processing files:', error)
      fileProcessing.clearAllTasks()
      if (error instanceof Error) {
        if (error.message.includes('unsupported format')) {
          toast.error('Unsupported file format', {
            description: error.message,
            duration: 5000
          })
        } else if (error.message.includes('No valid DICOM files found')) {
          toast.error('No DICOM files found', {
            description: 'The uploaded file(s) did not contain any valid DICOM files.',
            duration: 5000
          })
        } else {
          toast.error('Failed to process files', {
            description: error.message,
            duration: 5000
          })
        }
      }
    }
  }

  const addFilesToUploaded = (newFiles: File[]) => {
    uploadedFiles.value = [...uploadedFiles.value, ...newFiles]
  }

  const processFiles = async (isAppReady: boolean) => {
    await processNewFiles(uploadedFiles.value, isAppReady)
  }

  const anonymizeSelected = async () => {
    if (!config.value) {
      setAppError('Configuration not loaded')
      return
    }

    if (selectedStudies.value.length === 0) {
      return
    }

    try {
      // Snapshot selection and clear selection early for immediate UI feedback
      const selectedSnapshot = selectedStudies.value.slice()
      clearSelection()

      selectedSnapshot.forEach(study => {
        const studyFiles = study.series.flatMap(series => series.files)
        const totalSize = studyFiles.reduce((sum, file) => sum + (file.fileSize || 0), 0)
        if (totalSize >= VERY_LARGE_STUDY_WARNING_BYTES) {
          toast.warning('Very large study', {
            description: `${formatGiB(totalSize)} will anonymize in low-memory mode. This may take significantly longer.`,
            duration: 10000
          })
        } else if (totalSize >= LARGE_STUDY_WARNING_BYTES) {
          toast.warning('Large study', {
            description: `${formatGiB(totalSize)} will anonymize in low-memory mode to reduce memory pressure.`,
            duration: 8000
          })
        }
      })

      const anonymizationConfig = await runtime.runPromise(
        Effect.gen(function* () {
          const cfgService = yield* ConfigService
          return yield* cfgService.getAnonymizationConfig
        })
      )

      const manager = getAnonymizationWorkerManager()

      const promises = selectedSnapshot.map(study => {
        const studyFiles = study.series.flatMap(series => series.files)
        const allAnonymized = studyFiles.length > 0 && studyFiles.every(f => f.anonymized)

        // Build patientIdMap based on currently assigned IDs for all studies in memory
        const patientIdMap: Record<string, string> = {}
        studies.value.forEach(s => {
          const orig = s.patientId || 'Unknown'
          if (s.assignedPatientId) {
            patientIdMap[orig] = s.assignedPatientId
          }
        })

        // Minimal intervention: only force StudyInstanceUID if an anonymized file already exists
        const existingAnonUid = studyFiles.find(f => f.anonymized && f.metadata?.studyInstanceUID)?.metadata?.studyInstanceUID
        const overrides: Record<string, string> = {
          ...(study.customFields ?? {}),
          ...(study.assignedPatientId ? { 'Patient ID': study.assignedPatientId } : {}),
          // Do not pin Study Instance UID if all files are already anonymized
          ...(!allAnonymized && existingAnonUid ? { 'Study Instance UID': existingAnonUid } : {})
        }

        // Initial progress
        setStudyProgress(study.studyInstanceUID, {
          isProcessing: true,
          progress: 0,
          totalFiles: studyFiles.length,
          currentFile: undefined
        })

        return new Promise<boolean>((resolve) => {
          manager.anonymizeStudy({
            studyId: study.studyInstanceUID,
            files: studyFiles,
            anonymizationConfig,
            concurrency: concurrency.value,
            patientIdMap,
            overrides,
            onProgress: (p) => {
              setStudyProgress(study.studyInstanceUID, {
                isProcessing: true,
                progress: Math.round((p.completed / p.total) * 100),
                totalFiles: p.total,
                currentFile: p.currentFile
              })
            },
            onComplete: (anonymizedFiles) => {
              runtime.runPromise(
                Effect.gen(function* () {
                  const logger = yield* StudyLogger
                  yield* logger.append(study.id, { ts: Date.now(), level: 'info', message: `Anonymized ${anonymizedFiles.length} file(s)` })
                })
              ).catch(() => { })
              anonymizedFiles.forEach(anonymizedFile => {
                const fileIndex = dicomFiles.value.findIndex(f => f.id === anonymizedFile.id)
                if (fileIndex !== -1) {
                  dicomFiles.value[fileIndex] = anonymizedFile
                }
              })
              removeStudyProgress(study.studyInstanceUID)
              console.log(`Study ${study.studyInstanceUID} anonymization completed with ${anonymizedFiles.length} files`)
              // Clear overrides for this study after anonymization as they are incorporated
              const idx = studies.value.findIndex(s => s.studyInstanceUID === study.studyInstanceUID)
              if (idx !== -1) {
                const next = [...studies.value]
                next[idx] = { ...next[idx], customFields: undefined }
                studies.value = next
              }
              rebuildStudyAfterAnonymization(study.studyInstanceUID, anonymizedFiles)

              resolve(true)
            },
            onError: (err) => {
              const partialFiles = ((err as Error & { partialAnonymizedFiles?: DicomFile[] }).partialAnonymizedFiles ?? [])
              if (partialFiles.length > 0) {
                partialFiles.forEach(anonymizedFile => {
                  const fileIndex = dicomFiles.value.findIndex(f => f.id === anonymizedFile.id)
                  if (fileIndex !== -1) {
                    dicomFiles.value[fileIndex] = anonymizedFile
                  }
                })
                rebuildStudyAfterAnonymization(study.studyInstanceUID, partialFiles)
              }
              runtime.runPromise(
                Effect.gen(function* () {
                  const logger = yield* StudyLogger
                  yield* logger.append(study.id, {
                    ts: Date.now(),
                    level: 'error',
                    message: `Anonymization error`,
                    details: {
                      ...serializeError(err),
                      partialAnonymizedFiles: partialFiles.length
                    }
                  })
                })
              ).catch(() => { })
              console.error(`Anonymization error for study ${study.studyInstanceUID}:`, err)
              toast.error('Anonymization failed', {
                description: err.message,
                duration: 12000
              })
              removeStudyProgress(study.studyInstanceUID)
              resolve(false)
            }
          })
        })
      })

      const results = await Promise.allSettled(promises)
      const successfulStudies = results
        .map((r, idx) => (r.status === 'fulfilled' && r.value === true) ? selectedSnapshot[idx]?.studyInstanceUID ?? null : null)
        .filter((v): v is string => v !== null)
      const failedStudies = results
        .map((r, idx) => (r.status === 'fulfilled' && r.value === false) ? selectedSnapshot[idx]?.studyInstanceUID ?? null : null)
        .filter((v): v is string => v !== null)

      if (failedStudies.length === 0) {
        successMessage.value = `Successfully anonymized ${successfulStudies.length} studies`
      } else if (successfulStudies.length === 0) {
        setAppError(new Error(`Failed to anonymize all ${failedStudies.length} studies`))
      } else {
        successMessage.value = `Anonymized ${successfulStudies.length} of ${selectedSnapshot.length} studies. ${failedStudies.length} failed.`
      }

      clearSelection()

    } catch (error) {
      console.error('Error in anonymization:', error)
      setAppError(error as Error)
    }
  }

  const testConnection = async () => {
    try {
      await runtime.runPromise(dicomSender.testConnection())
      toast.success('Connection successful', {
        description: 'DICOM server is reachable',
        duration: 3000
      })
    } catch (error) {
      console.error('Connection test failed:', error)
      toast.error('Connection failed', {
        description: (error as Error).message,
        duration: 5000
      })
      setAppError(error as Error)
    }
  }

  const handleSendSelected = async (selectedStudiesToSend: DicomStudy[]) => {
    if (selectedStudiesToSend.length === 0) {
      return
    }

    try {
      successMessage.value = ''

      // Skip studies that are already being sent right now
      const studiesForRun = selectedStudiesToSend.filter((study) => {
        const inProgress = dicomSender.isStudySending(study.studyInstanceUID)
        if (inProgress) {
          runtime.runPromise(
            Effect.gen(function* () {
              const logger = yield* StudyLogger
              yield* logger.append(study.id, { ts: Date.now(), level: 'warn', message: `Send skipped: study is already sending` })
            })
          ).catch(() => { })
          toast.info('Some studies are already sending', {
            description: `Skipped study ${study.studyInstanceUID} because sending is in progress`,
            duration: 3000
          })
          return false
        }
        return true
      })

      if (studiesForRun.length === 0) {
        return
      }

      // Build Effect per study (no streams)
      const studyEffects = studiesForRun.map(study => {
        const allFiles = study.series.flatMap(series => series.files)
        const studyFiles = allFiles.filter(file => file.anonymized)
        const nonAnonymizedFiles = allFiles.filter(file => !file.anonymized)

        // Immediately reflect sending state in UI to avoid delays before first progress callback
        if (studyFiles.length > 0) {
          setStudySendingProgress(study.studyInstanceUID, {
            isProcessing: true,
            progress: 0,
            totalFiles: studyFiles.length,
            sentCount: 0,
            failedCount: 0,
            currentFile: undefined,
            retryingFile: undefined,
            retryAttempt: undefined,
            statusText: 'Waiting for first file'
          })
        }

        const callBeforeSendHooks = Effect.gen(function* () {
          const registry = yield* PluginRegistry
          const hookPlugins = yield* registry.getHookPlugins()
          // Log per-file skips for non-anonymized files
          if (nonAnonymizedFiles.length > 0) {
            const logger = yield* StudyLogger
            for (const f of nonAnonymizedFiles) {
              yield* logger.append(study.id, { ts: Date.now(), level: 'warn', message: `Skipped file not anonymized`, details: { fileName: f.fileName, id: f.id } })
            }
          }

          // If nothing to send, record error and short-circuit hooks
          if (studyFiles.length === 0) {
            const logger = yield* StudyLogger
            yield* logger.append(study.id, { ts: Date.now(), level: 'error', message: `No anonymized files to send; aborted` })
            return undefined
          }
          for (const plugin of hookPlugins) {
            if (plugin.hooks.beforeSend) {
              yield* plugin.hooks.beforeSend(study).pipe(
                Effect.catchAll((error) => {
                  console.error(`Plugin ${plugin.id} beforeSend hook failed:`, error)
                  const message = (error && (error as any).message) ? String((error as any).message) : String(error)
                  const pluginId = (error && (error as any).pluginId) ? String((error as any).pluginId) : plugin.id
                  toast.error(`Plugin ${pluginId} beforeSend error`, { description: message })
                  return Effect.gen(function* () {
                    const logger = yield* StudyLogger
                    yield* logger.append(study.id, { ts: Date.now(), level: 'error', message: `Plugin ${pluginId} beforeSend error`, details: serializeError(error) })
                    return undefined
                  })
                })
              )
            }
          }
          const logger = yield* StudyLogger
          yield* logger.append(study.id, { ts: Date.now(), level: 'info', message: `Sending started (${studyFiles.length} file(s))` })
        })

        const sendEffect = dicomSender.sendStudyEffect(
          study.studyInstanceUID,
          studyFiles,
          concurrency.value,
          {
            onProgress: (progress: SendProgressUpdate) => {
              setStudySendingProgress(study.studyInstanceUID, {
                isProcessing: true,
                progress: progress.percentage,
                totalFiles: progress.total,
                sentCount: progress.sentCount,
                failedCount: progress.failedCount,
                currentFile: progress.currentFile?.fileName,
                retryingFile: progress.retryingFile?.fileName,
                retryAttempt: progress.retryAttempt,
                statusText: progress.statusText
              })
            },
            onSkip: (file, reason) => {
              return runtime.runPromise(
                Effect.gen(function* () {
                  const logger = yield* StudyLogger
                  yield* logger.append(study.id, { ts: Date.now(), level: 'warn', message: `Skipped file ${reason}`, details: { fileName: file.fileName, id: file.id } })
                })
              )
            },
            onFileRetry: (failure, nextAttempt, delayMs) => {
              return runtime.runPromise(
                Effect.gen(function* () {
                  const logger = yield* StudyLogger
                  yield* logger.append(study.id, {
                    ts: Date.now(),
                    level: 'warn',
                    message: `Retrying file send`,
                    details: {
                      fileName: failure.fileName,
                      attemptsSoFar: failure.attempts,
                      nextAttempt,
                      delayMs,
                      failureKind: failure.failureKind,
                      httpStatus: failure.httpStatus,
                      message: failure.message
                    }
                  })
                })
              )
            },
            onFileFailure: (failure) => {
              return runtime.runPromise(
                Effect.gen(function* () {
                  const logger = yield* StudyLogger
                  yield* logger.append(study.id, {
                    ts: Date.now(),
                    level: 'error',
                    message: `File send failed`,
                    details: failure
                  })
                })
              )
            },
            onFileWarning: (warning: SendWarningResult) => {
              return runtime.runPromise(
                Effect.gen(function* () {
                  const logger = yield* StudyLogger
                  yield* logger.append(study.id, {
                    ts: Date.now(),
                    level: 'warn',
                    message: `Server warning for sent file`,
                    details: warning
                  })
                })
              )
            }
          }
        ).pipe(
          Effect.tap((sendResult) =>
            Effect.gen(function* () {
              // Mark files as sent
              sendResult.succeeded.forEach(({ file: sentFile }) => {
                const fileIndex = dicomFiles.value.findIndex(f => f.id === sentFile.id)
                if (fileIndex !== -1) {
                  dicomFiles.value[fileIndex] = { ...dicomFiles.value[fileIndex], sent: true }
                }
              })

              if (sendResult.succeeded.length > 0) {
                yield* Effect.tryPromise({
                  try: () => rebuildStudyAfterFileChanges(study.studyInstanceUID),
                  catch: (error) => new Error(String(error))
                })
              }

              const logger = yield* StudyLogger
              yield* logger.append(study.id, {
                ts: Date.now(),
                level: sendResult.failedCount > 0 ? 'warn' : 'info',
                message: `Send completed`,
                details: {
                  attempted: sendResult.attempted,
                  sent: sendResult.succeededCount,
                  failed: sendResult.failedCount,
                  skipped: sendResult.skippedCount,
                  warnings: sendResult.warningCount,
                  failureKinds: summarizeFailureKinds(sendResult.failed),
                  failedFiles: summarizeFailedFiles(sendResult.failed)
                }
              })

              setStudySendingProgress(study.studyInstanceUID, {
                isProcessing: false,
                progress: getFinalSendProgress(sendResult),
                totalFiles: sendResult.attempted,
                sentCount: sendResult.succeededCount,
                failedCount: sendResult.failedCount,
                currentFile: undefined,
                retryingFile: undefined,
                retryAttempt: undefined,
                statusText: getFinalSendStatusText(sendResult),
                lastFailureKind: sendResult.failed[0]?.failureKind,
                lastFailedFile: sendResult.failed[0]?.fileName
              })

              if (sendResult.failedCount > 0) {
                toast.error(
                  sendResult.succeededCount > 0 ? 'Some files failed to send' : 'Study send failed',
                  {
                    description: `${sendResult.failedCount} file(s) failed to send. More info is available in the logs.`,
                    duration: 12000
                  }
                )
              }

              // afterSend hooks
              if (sendResult.failedCount === 0) {
                const registry = yield* PluginRegistry
                const hookPlugins = yield* registry.getHookPlugins()
                const sentStudy = studies.value.find(s => s.studyInstanceUID === study.studyInstanceUID)
                if (sentStudy) {
                  for (const plugin of hookPlugins) {
                    if (plugin.hooks.afterSend) {
                      yield* plugin.hooks.afterSend(sentStudy).pipe(
                        Effect.catchAll((error) => {
                          console.error(`Plugin ${plugin.id} afterSend hook failed:`, error)
                          const message = (error && (error as any).message) ? String((error as any).message) : String(error)
                          const pluginId = (error && (error as any).pluginId) ? String((error as any).pluginId) : plugin.id
                          toast.error(`Plugin ${pluginId} afterSend error`, { description: message })
                          return Effect.gen(function* () {
                            const logger = yield* StudyLogger
                            yield* logger.append(study.id, { ts: Date.now(), level: 'error', message: `Plugin ${pluginId} afterSend error`, details: serializeError(error) })
                            return undefined
                          })
                        })
                      )
                    }
                  }
                }
              }
            })
          ),
          Effect.catchAll((err) =>
            Effect.gen(function* () {
              if (err instanceof CancelledError) {
                const currentProgress = getStudySendingProgress(study.studyInstanceUID).value
                setStudySendingProgress(study.studyInstanceUID, {
                  isProcessing: false,
                  progress: currentProgress?.progress ?? 0,
                  totalFiles: studyFiles.length,
                  sentCount: currentProgress?.sentCount ?? 0,
                  failedCount: currentProgress?.failedCount ?? 0,
                  currentFile: undefined,
                  retryingFile: undefined,
                  retryAttempt: undefined,
                  statusText: 'Send cancelled',
                  lastFailureKind: currentProgress?.lastFailureKind,
                  lastFailedFile: currentProgress?.lastFailedFile
                })
                const logger = yield* StudyLogger
                yield* logger.append(study.id, {
                  ts: Date.now(),
                  level: 'warn',
                  message: 'Sending cancelled'
                })
                return {
                  succeeded: [],
                  failed: [],
                  skipped: [],
                  warnings: [],
                  total: studyFiles.length,
                  attempted: currentProgress?.sentCount ?? 0,
                  succeededCount: currentProgress?.sentCount ?? 0,
                  failedCount: currentProgress?.failedCount ?? 0,
                  skippedCount: 0,
                  warningCount: 0
                } satisfies SendStudyResult
              }

              console.error(`Error sending study ${study.studyInstanceUID}:`, err)
              setStudySendingProgress(study.studyInstanceUID, {
                isProcessing: false,
                progress: 0,
                totalFiles: studyFiles.length,
                sentCount: 0,
                failedCount: studyFiles.length,
                currentFile: undefined,
                retryingFile: undefined,
                retryAttempt: undefined,
                statusText: 'Send failed',
                lastFailureKind: 'error'
              })
              if (studyFiles.length > 0) {
                toast.error('Study send failed', {
                  description: `${studyFiles.length} file(s) failed to send. More info is available in the logs.`,
                  duration: 12000
                })
              }
              const logger = yield* StudyLogger
              yield* logger.append(study.id, { ts: Date.now(), level: 'error', message: `Send error`, details: serializeError(err) })
              // onSendError hooks
              const registry = yield* PluginRegistry
              const hookPlugins = yield* registry.getHookPlugins()
              const errorStudy = studies.value.find(s => s.studyInstanceUID === study.studyInstanceUID)
              if (errorStudy) {
                for (const plugin of hookPlugins) {
                  if (plugin.hooks.onSendError) {
                    yield* plugin.hooks.onSendError(errorStudy, err).pipe(
                      Effect.catchAll((error) => {
                        console.error(`Plugin ${plugin.id} onSendError hook failed:`, error)
                        const message = (error && (error as any).message) ? String((error as any).message) : String(error)
                        const pluginId = (error && (error as any).pluginId) ? String((error as any).pluginId) : plugin.id
                        toast.error(`Plugin ${pluginId} onSendError error`, { description: message })
                        return Effect.gen(function* () {
                          const logger2 = yield* StudyLogger
                          yield* logger2.append(study.id, { ts: Date.now(), level: 'error', message: `Plugin ${pluginId} onSendError error`, details: serializeError(error) })
                          return undefined
                        })
                      })
                    )
                  }
                }
              }

              const syntheticFailures: SendFailureResult[] = studyFiles.map((file) => ({
                file,
                fileName: file.fileName,
                id: file.id,
                sopInstanceUID: file.metadata?.sopInstanceUID,
                modality: file.metadata?.modality,
                fileSize: file.fileSize,
                attempts: 1,
                failureKind: 'network',
                message: err instanceof Error ? err.message : String(err)
              }))

              return {
                succeeded: [],
                failed: syntheticFailures,
                skipped: [],
                warnings: [],
                total: studyFiles.length,
                attempted: studyFiles.length,
                succeededCount: 0,
                failedCount: studyFiles.length,
                skippedCount: 0,
                warningCount: 0
              } satisfies SendStudyResult
            })
          )
        )

        // If no anonymized files, make this effect fail to mark study as failed in tracking
        const guardedEffect = studyFiles.length === 0
          ? Effect.fail(new Error('No anonymized files to send'))
          : sendEffect

        return Effect.flatMap(callBeforeSendHooks, () => guardedEffect)
      })

      // Track successful and failed studies
      const failedStudies: string[] = []
      const successfulStudies: string[] = []
      const partialStudies: string[] = []
      const cancelledStudies: string[] = []

      // Run all study effects concurrently with result tracking
      await runtime.runPromise(
        Effect.all(studyEffects.map((effect, index) =>
          effect.pipe(
            Effect.map((result) => {
              const currentStudy = studiesForRun[index]
              if (currentStudy) {
                if ((getStudySendingProgress(currentStudy.studyInstanceUID).value?.statusText) === 'Send cancelled') {
                  cancelledStudies.push(currentStudy.studyInstanceUID)
                } else if (result.failedCount === 0) {
                  successfulStudies.push(currentStudy.studyInstanceUID)
                } else if (result.succeededCount > 0) {
                  partialStudies.push(currentStudy.studyInstanceUID)
                } else {
                  failedStudies.push(currentStudy.studyInstanceUID)
                }
              }
              return true
            }),
            Effect.catchAll(() => {
              const currentStudy = studiesForRun[index]
              if (currentStudy) {
                failedStudies.push(currentStudy.studyInstanceUID)
              }
              return Effect.succeed(false)
            })
          )
        ), { concurrency: "unbounded" })
      )

      // Show appropriate success/error message based on results
      if (failedStudies.length === 0 && partialStudies.length === 0 && cancelledStudies.length === 0) {
        successMessage.value = `Successfully sent ${successfulStudies.length} studies`
      } else if (successfulStudies.length === 0 && partialStudies.length === 0 && cancelledStudies.length === 0) {
        setAppError(new Error(`Failed to send all ${failedStudies.length} studies`))
      } else if (successfulStudies.length === 0 && partialStudies.length === 0 && failedStudies.length === 0 && cancelledStudies.length > 0) {
        successMessage.value = `Stopped sending ${cancelledStudies.length} ${cancelledStudies.length === 1 ? 'study' : 'studies'}`
      } else {
        successMessage.value = `Sent ${successfulStudies.length} complete, ${partialStudies.length} partial, ${failedStudies.length} failed studies.${cancelledStudies.length > 0 ? ` ${cancelledStudies.length} cancelled.` : ''}`
      }

    } catch (error) {
      console.error('Error in sending:', error)
      setAppError(error as Error)
    }
  }

  async function rebuildStudyAfterFileChanges(studyId: string): Promise<void> {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          const current = studies.value
          const filesForStudy = dicomFiles.value.filter(f => f.metadata?.studyInstanceUID === studyId)
          const rebuilt = yield* processor.groupFilesByStudy(filesForStudy)
          if (rebuilt.length > 0) {
            const maybeExisting = current.find(s => s.id === rebuilt[0].id)
            const updatedStudy = { ...rebuilt[0], assignedPatientId: maybeExisting?.assignedPatientId }
            const idx = current.findIndex(s => s.id === updatedStudy.id)
            if (idx !== -1) {
              const next = [...current]
              next[idx] = updatedStudy
              studies.value = next
            } else {
              studies.value = [...current, updatedStudy]
            }
          }
        })
      )
    } catch (error) {
      console.error('Failed to rebuild study after file changes:', error)
    }
  }

  async function rebuildStudyAfterAnonymization(oldStudyId: string, anonymizedFiles: DicomFile[]): Promise<void> {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          const current = studies.value

          // Rebuild study structure from the anonymized files (may have a new StudyInstanceUID)
          const rebuilt = yield* processor.groupFilesByStudy(anonymizedFiles)
          if (rebuilt.length === 0) {
            return
          }

          const maybeExisting = current.find(s => s.id === rebuilt[0].id)
          const newStudy = { ...rebuilt[0], assignedPatientId: maybeExisting?.assignedPatientId }

          const idxById = current.findIndex(s => s.id === newStudy.id)
          if (idxById !== -1) {
            const next = [...current]
            next[idxById] = newStudy
            studies.value = next
          } else {
            studies.value = [...current, newStudy]
          }
        })
      )
    } catch (error) {
      console.error('Failed to rebuild study after anonymization:', error)
    }
  }

  const clearFiles = () => {
    dicomFiles.value.forEach(file => {
      if (file.metadata) file.metadata = undefined
    })

    uploadedFiles.value = []
    dicomFiles.value = []
    studies.value = []
    successMessage.value = ''
    fileProcessing.clearAllTasks()
    clearAllProgress()
    clearAllSendingProgress()
    clearSelection()
  }

  const clearSelected = () => {
    const selectedStudiesToClear = selectedStudies.value

    // Get study IDs to clear
    const studyIdsToClear = new Set(selectedStudiesToClear.map(s => s.studyInstanceUID))

    // Remove files associated with selected studies
    dicomFiles.value = dicomFiles.value.filter(file => {
      if (file.metadata?.studyInstanceUID && studyIdsToClear.has(file.metadata.studyInstanceUID)) {
        // Best-effort: delete OPFS file to avoid lingering PII
        runtime.runPromise(
          Effect.gen(function* () {
            const storage = yield* OPFSStorage
            yield* storage.deleteFile(file.id).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
          })
        ).catch(() => { })
        if (file.metadata) file.metadata = undefined
        return false
      }
      return true
    })

    // Remove selected studies from studies array
    studies.value = studies.value.filter(study => !studyIdsToClear.has(study.studyInstanceUID))

    // Clear progress for removed studies
    selectedStudiesToClear.forEach(study => {
      removeStudyProgress(study.studyInstanceUID)
      removeStudySendingProgress(study.studyInstanceUID)
    })

    // Clear selection
    clearSelection()

    successMessage.value = `Cleared ${selectedStudiesToClear.length} selected ${selectedStudiesToClear.length === 1 ? 'study' : 'studies'}`
  }

  onMounted(async () => {
    try {
      config.value = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConfigService
          return yield* svc.getCurrentConfig
        })
      )
    } catch (e) {
      configError.value = e as Error
    }

    runtime.runFork(
      Effect.gen(function* () {
        const svc = yield* ConfigService
        const registry = yield* PluginRegistry
        return yield* Stream.runForEach(svc.configChanges, (cfg) =>
          Effect.gen(function* () {
            // Update reactive config
            yield* Effect.sync(() => { config.value = cfg })
            // Apply plugin config dynamically (enabled list + settings)
            if ((cfg as any).plugins) {
              yield* registry.loadPluginConfig((cfg as any).plugins)
            }
          }).pipe(
            Effect.catchAll((err) => Effect.sync(() => console.error('Failed to apply plugin config from live update:', err)))
          )
        )
      })
    )

    await loadPlugins()
  })

  // Helpers for UI logic
  const isStudyCurrentlySending = (studyId: string): boolean => {
    return dicomSender.isStudySending(studyId)
  }

  const isStudyAlreadySent = (study: DicomStudy): boolean => {
    const allFiles = study.series.flatMap(series => series.files)
    const anonymizedFiles = allFiles.filter(f => f.anonymized)
    if (anonymizedFiles.length === 0) return false
    return anonymizedFiles.every(f => f.sent === true)
  }

  const cancelStudySend = (studyId: string): void => {
    dicomSender.cancelStudy(studyId)
  }

  return {
    // State
    uploadedFiles,
    dicomFiles,
    studies,
    successMessage,
    concurrency,
    appError,
    config,
    configLoading,
    configError,
    serverUrl,
    currentProject,
    isProjectMode,

    // Computed
    selectedStudies,
    selectedStudiesCount,
    totalFiles,
    anonymizedFilesCount,

    // Composables
    fileProcessing,
    dragAndDrop,

    // Methods
    setAppError,
    clearAppError,
    loadConfig,
    loadServerUrl,
    loadProjectState,
    handleConfigReload,
    handleCreateProject,
    handleLoadConfig,
    processNewFiles,
    addFilesToUploaded,
    processFiles,
    anonymizeSelected,
    groupAsSamePatient,
    assignPatientIdToSelected,
    setCustomFieldsForSelected,
    mergeSelectedStudiesIntoOne,
    testConnection,
    handleSendSelected,
    cancelStudySend,
    clearFiles,
    clearSelected,
    // Helpers
    isStudyCurrentlySending,
    isStudyAlreadySent,
  }
}
