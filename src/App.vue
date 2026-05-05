<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, provide } from 'vue'
import { Effect, ManagedRuntime } from 'effect'
import type { DicomStudy } from '@/types/dicom'
import { useAppState } from '@/composables/useAppState'
import { AppLayer } from '@/services/shared/layers'
import { DataTable, columns } from '@/components/StudyDataTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { useSessionPersistence } from '@/composables/useSessionPersistence'
import { useDownload } from '@/composables/useDownload'
import { useProjectSharing } from '@/composables/useProjectSharing'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import FileProcessingProgress from '@/components/FileProcessingProgress.vue'
import WorkerDebugPanel from '@/components/WorkerDebugPanel.vue'
import AppToolbar from '@/components/AppToolbar.vue'
import ConfigEditSheet from '@/components/ConfigEditSheet.vue'
import CustomFieldsSheet from '@/components/CustomFieldsSheet.vue'
import StudyLogSheet from '@/components/StudyLogSheet.vue'
import StudyMetadataSheet from '@/components/StudyMetadataSheet.vue'
import { Toaster } from '@/components/ui/sonner'
import { useDropdownSheetTransition } from '@/utils/dropdownSheetTransition'
import {
  registerRatatoskrWebMcpTools,
  type RatatoskrAgentStatus,
  type RatatoskrAgentTools,
  type WebMcpRegistrationState,
} from '@/agent/webmcp'
import { StudyLogger } from '@/services/studyLogger'
import 'vue-sonner/style.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const runtime = ManagedRuntime.make(AppLayer)
provide('appRuntime', runtime)
const appState = useAppState(runtime)
provide('studyActions', {
  cancelStudySend: (studyId: string) => appState.cancelStudySend(studyId)
})

const isAgentMode = new URLSearchParams(window.location.search).get('agent') === '1'
const webMcpState = ref<WebMcpRegistrationState>(
  isAgentMode ? { kind: 'unavailable', message: 'WebMCP has not been checked yet.' } : { kind: 'disabled' }
)
let disposeWebMcpTools: (() => void) | undefined

const { isDownloading, downloadSelectedStudies } = useDownload(runtime)
const { loadConfigFromUrl } = useProjectSharing()
const error = computed(() => {
  if (appState.configError.value) {
    return `Configuration Error: ${appState.configError.value.message}`
  }
})

const isRestoring = ref(false)
const restoreProgress = ref(0)
const showConfigEditSheet = ref(false)
const showCustomFieldsSheet = ref(false)
const showLogSheet = ref(false)
const logStudyId = ref<string | undefined>(undefined)
const showMetadataSheet = ref(false)
const metadataStudyId = ref<string | undefined>(undefined)
const showSendWarningDialog = ref(false)
const pendingSendStudies = ref<DicomStudy[] | null>(null)
const showResendConfirmDialog = ref(false)
const pendingResendStudies = ref<DicomStudy[] | null>(null)

// Setup dropdown-to-sheet transitions
const customFieldsTransition = useDropdownSheetTransition()
const logSheetTransition = useDropdownSheetTransition()
const metadataSheetTransition = useDropdownSheetTransition()

const {
  isGlobalDragOver,
  handleGlobalDragEnter,
  handleGlobalDragLeave,
  handleGlobalDragOver,
  handleGlobalDrop,
} = appState.dragAndDrop

const {
  getRunningTasks,
  getAllTasks,
  hasActiveProcessing,
  cancelAll
} = appState.fileProcessing

const { studyProgressMap } = useAnonymizationProgress()
const { studySendingProgressMap } = useSendingProgress()

// Extract removeTask separately to use in template
const removeTask = (taskId: string) => {
  appState.fileProcessing.tasks.value.delete(taskId)
  appState.fileProcessing.tasks.value = new Map(appState.fileProcessing.tasks.value)
}

const isAppReady = computed(() => {
  return !appState.configLoading.value && !appState.configError.value && appState.config.value !== null
})

const studiesData = computed(() => {
  return appState.studies.value || []
})

const getActiveAnonymizations = () =>
  Array.from(studyProgressMap.value.values()).filter((progress) => progress.isProcessing).length

const getActiveSends = () =>
  Array.from(studySendingProgressMap.value.values()).filter((progress) => progress.isProcessing).length

const getAgentStatus = (): RatatoskrAgentStatus => {
  const fileProcessing = getRunningTasks().length
  const anonymization = getActiveAnonymizations()
  const sending = getActiveSends()
  const configReady = isAppReady.value
  const errors = [
    appState.appError.value,
    appState.configError.value?.message,
  ].filter((message): message is string => !!message)
  const idle = !isRestoring.value && fileProcessing === 0 && anonymization === 0 && sending === 0

  return {
    ok: configReady && errors.length === 0,
    status: !configReady ? 'not-ready' : idle ? 'ready' : 'busy',
    agentMode: isAgentMode,
    configReady,
    restoring: isRestoring.value,
    idle,
    counts: {
      studies: appState.studies.value.length,
      files: appState.dicomFiles.value.length,
      anonymizedFiles: appState.anonymizedFilesCount.value,
      sentFiles: appState.dicomFiles.value.filter((file) => file.sent).length,
      selectedStudies: appState.selectedStudiesCount.value,
    },
    activeOperations: {
      fileProcessing,
      anonymization,
      sending,
    },
    errors,
  }
}

const valuePresent = (value: unknown): boolean =>
  value !== undefined && value !== null && String(value).length > 0

const summarizeHeaders = (headers: unknown) => {
  if (!headers || typeof headers !== 'object') {
    return {
      names: [],
      valuePresentByName: {},
    }
  }

  const entries = Object.entries(headers as Record<string, unknown>)
  return {
    names: entries.map(([name]) => name),
    valuePresentByName: Object.fromEntries(entries.map(([name, value]) => [name, valuePresent(value)])),
  }
}

const getConfigSummaryForAgent = () => {
  const config = appState.config.value
  if (!config) {
    return {
      ok: false,
      configReady: false,
      status: 'not-ready',
    }
  }

  const dicomServer = config.dicomServer
  const sentNotifierSettings = (config.plugins as any)?.settings?.['sent-notifier'] ?? {}

  return {
    ok: true,
    configReady: true,
    dicomServer: {
      url: dicomServer.url,
      timeout: dicomServer.timeout,
      testConnectionPath: dicomServer.testConnectionPath,
      description: dicomServer.description,
      headers: summarizeHeaders(dicomServer.headers),
      auth: {
        type: dicomServer.auth?.type ?? 'none',
        credentialsPresent: valuePresent(dicomServer.auth?.credentials),
      },
    },
    plugins: {
      enabled: config.plugins?.enabled ?? [],
      sentNotifier: {
        url: sentNotifierSettings.url,
        authHeaderName: sentNotifierSettings.authHeaderName ?? sentNotifierSettings.apiKeyHeader,
        authHeaderValuePresent: valuePresent(sentNotifierSettings.authHeaderValue ?? sentNotifierSettings.apiKey),
        headers: summarizeHeaders(sentNotifierSettings.headers),
      },
    },
  }
}

const loadConfigForAgent = async (input: Record<string, unknown>) => {
  if (!input.config || typeof input.config !== 'object') {
    return {
      ok: false,
      status: 'invalid-input',
      message: 'Expected input.config to contain a Ratatoskr application config object.',
    }
  }

  try {
    await appState.handleLoadConfig(input.config)
    return getConfigSummaryForAgent()
  } catch (error) {
    return {
      ok: false,
      status: 'invalid-config',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

const agentModeStatusText = computed(() => {
  if (!isAgentMode) return ''
  if (webMcpState.value.kind === 'registered') {
    return `WebMCP agent mode active: ${webMcpState.value.toolNames.join(', ')}`
  }
  if (webMcpState.value.kind === 'unavailable' || webMcpState.value.kind === 'error') {
    return webMcpState.value.message
  }
  return 'WebMCP agent mode disabled'
})

const toTimeoutMs = (input: Record<string, unknown>, fallback = 120000): number => {
  const raw = input.timeoutMs
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallback
}

const shouldWait = (input: Record<string, unknown>): boolean => input.wait !== false

const waitForAgentIdle = async (timeoutMs = 120000): Promise<RatatoskrAgentStatus> => {
  const startedAt = Date.now()

  while (true) {
    const status = getAgentStatus()
    if (status.idle) return status
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for Ratatoskr to become idle after ${timeoutMs}ms`)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

const summarizeStudy = (study: DicomStudy) => {
  const files = study.series.flatMap(series => series.files)
  const sendingProgress = studySendingProgressMap.value.get(study.studyInstanceUID)
  return {
    id: study.id,
    studyInstanceUID: study.studyInstanceUID,
    accessionNumber: study.accessionNumber ?? '',
    patientId: study.patientId ?? '',
    assignedPatientId: study.assignedPatientId ?? '',
    studyDate: study.studyDate ?? '',
    studyDescription: study.studyDescription ?? '',
    seriesCount: study.series.length,
    fileCount: files.length,
    anonymizedCount: files.filter(file => file.anonymized).length,
    sentCount: files.filter(file => file.sent).length,
    selected: appState.selectedStudies.value.some(selected => selected.studyInstanceUID === study.studyInstanceUID),
    sending: sendingProgress?.isProcessing ?? false,
    lastFailureKind: sendingProgress?.lastFailureKind,
    lastFailedFile: sendingProgress?.lastFailedFile,
  }
}

const getUploadStatus = () => {
  const tasks = getAllTasks()
  return {
    ok: true,
    idle: getRunningTasks().length === 0 && !isRestoring.value,
    restoring: isRestoring.value,
    restoreProgress: restoreProgress.value,
    counts: {
      tasks: tasks.length,
      runningTasks: getRunningTasks().length,
      files: appState.dicomFiles.value.length,
      studies: appState.studies.value.length,
    },
    tasks: tasks.map(task => ({
      taskId: task.taskId,
      fileName: task.fileName,
      currentStep: task.currentStep,
      progress: task.progress,
      status: task.status,
      error: task.error,
    })),
  }
}

const prepareCaseUpload = () => {
  const input = document.querySelector<HTMLInputElement>('[data-testid="toolbar-file-input"]')
  if (input) input.value = ''
  return {
    ok: !!input && isAppReady.value,
    status: isAppReady.value ? 'ready' : 'not-ready',
    fileInputSelector: '[data-testid="toolbar-file-input"]',
    fileInputTestId: 'toolbar-file-input',
    acceptedExtensions: ['.zip', '.rar', '.dcm', '.dicom'],
    multiple: true,
    instructions:
      'Attach local case files to fileInputSelector with your browser automation file-upload primitive, then call ratatoskr.process_uploaded_cases or ratatoskr.wait_for_idle.',
    uploadStatus: getUploadStatus(),
  }
}

const processUploadedCases = async (input: Record<string, unknown>) => {
  const status = shouldWait(input)
    ? await waitForAgentIdle(toTimeoutMs(input))
    : getAgentStatus()
  return {
    ok: status.configReady && status.errors.length === 0,
    status: status.status,
    uploadStatus: getUploadStatus(),
    appStatus: status,
  }
}

const listStudiesForAgent = () => ({
  ok: true,
  counts: {
    studies: appState.studies.value.length,
    selectedStudies: appState.selectedStudiesCount.value,
  },
  studies: appState.studies.value.map(summarizeStudy),
})

const selectStudiesForAgent = (input: Record<string, unknown>) => {
  const { rowSelection, clearSelection } = useTableState()
  const existingUids = new Set(appState.studies.value.map(study => study.studyInstanceUID))
  const requestedUids = input.mode === 'all'
    ? appState.studies.value.map(study => study.studyInstanceUID)
    : Array.isArray(input.studyInstanceUIDs)
      ? input.studyInstanceUIDs.filter((uid): uid is string => typeof uid === 'string')
      : []

  const selectedUids = requestedUids.filter(uid => existingUids.has(uid))
  const missingUids = requestedUids.filter(uid => !existingUids.has(uid))

  clearSelection()
  rowSelection.value = Object.fromEntries(selectedUids.map(uid => [uid, true]))

  return {
    ok: missingUids.length === 0,
    selectedCount: selectedUids.length,
    selectedStudyInstanceUIDs: selectedUids,
    missingStudyInstanceUIDs: missingUids,
  }
}

const anonymizeSelectedForAgent = async (input: Record<string, unknown>) => {
  if (appState.selectedStudies.value.length === 0) {
    return { ok: false, status: 'no-selection', message: 'No studies are selected.' }
  }

  await appState.anonymizeSelected()
  const status = shouldWait(input)
    ? await waitForAgentIdle(toTimeoutMs(input))
    : getAgentStatus()

  return {
    ok: status.errors.length === 0,
    status: status.status,
    appStatus: status,
    studies: appState.studies.value.map(summarizeStudy),
  }
}

const sendSelectedForAgent = async (input: Record<string, unknown>) => {
  const selected = appState.selectedStudies.value.slice()
  if (selected.length === 0) {
    return { ok: false, status: 'no-selection', message: 'No studies are selected.' }
  }

  const hasNonAnonymized = selected.some(study =>
    study.series.some(series => series.files.some(file => !file.anonymized))
  )
  if (hasNonAnonymized && input.confirmNonAnonymized !== true) {
    return {
      ok: false,
      status: 'confirmation-required',
      confirmation: 'confirmNonAnonymized',
      message: 'Selected studies include non-anonymized files. Pass confirmNonAnonymized: true to send anonymized files only.',
    }
  }

  const hasAlreadySent = selected.some(study => appState.isStudyAlreadySent(study))
  if (hasAlreadySent && input.confirmResend !== true) {
    return {
      ok: false,
      status: 'confirmation-required',
      confirmation: 'confirmResend',
      message: 'One or more selected studies have already been sent. Pass confirmResend: true to resend.',
    }
  }

  await appState.handleSendSelected(selected)
  const status = shouldWait(input)
    ? await waitForAgentIdle(toTimeoutMs(input))
    : getAgentStatus()

  return {
    ok: status.errors.length === 0,
    status: status.status,
    appStatus: status,
    studies: appState.studies.value.map(summarizeStudy),
  }
}

const getLogsForAgent = async (input: Record<string, unknown>) => {
  const logs = await runtime.runPromise(
    Effect.gen(function* () {
      const logger = yield* StudyLogger
      return yield* logger.getAllLogs
    })
  )
  const studyInstanceUID = typeof input.studyInstanceUID === 'string' ? input.studyInstanceUID : undefined
  const explicitStudyId = typeof input.studyId === 'string' ? input.studyId : undefined
  const resolvedStudyId = explicitStudyId ?? appState.studies.value.find(study => study.studyInstanceUID === studyInstanceUID)?.id

  if (resolvedStudyId) {
    return {
      ok: true,
      studyId: resolvedStudyId,
      entries: logs.get(resolvedStudyId) ?? [],
    }
  }

  return {
    ok: true,
    logs: Object.fromEntries(logs),
  }
}

const waitForIdleForAgent = async (input: Record<string, unknown>) => ({
  ok: true,
  appStatus: await waitForAgentIdle(toTimeoutMs(input)),
})

const clearAllForAgent = async (input: Record<string, unknown>) => {
  clearFiles()
  await clearSession()
  const status = shouldWait(input)
    ? await waitForAgentIdle(toTimeoutMs(input, 30000))
    : getAgentStatus()
  return {
    ok: status.errors.length === 0,
    status: status.status,
    appStatus: status,
  }
}

const agentTools: RatatoskrAgentTools = {
  getStatus: getAgentStatus,
  loadConfig: loadConfigForAgent,
  getConfigSummary: getConfigSummaryForAgent,
  prepareCaseUpload,
  getUploadStatus,
  processUploadedCases,
  listStudies: listStudiesForAgent,
  selectStudies: selectStudiesForAgent,
  anonymizeSelected: anonymizeSelectedForAgent,
  sendSelected: sendSelectedForAgent,
  getLogs: getLogsForAgent,
  waitForIdle: waitForIdleForAgent,
  clearAll: clearAllForAgent,
}

const initialOverrides = computed<Record<string, string>>(() => {
  const selected = appState.selectedStudies.value
  if (selected.length === 0) return {}
  if (selected.length === 1) return selected[0].customFields ?? {}
  const maps = selected.map(s => s.customFields ?? {})
  const keys = new Set(maps.flatMap(m => Object.keys(m)))
  const common: Record<string, string> = {}
  keys.forEach(key => {
    const firstVal = maps[0][key]
    if (firstVal === undefined) return
    const allSame = maps.every(m => m[key] !== undefined && String(m[key]) === String(firstVal))
    if (allSame) common[key] = String(firstVal)
  })
  return common
})

const initialAssignedPatientId = computed<string | undefined>(() => {
  const selected = appState.selectedStudies.value
  if (selected.length === 0) return undefined
  const first = selected[0].assignedPatientId ?? ''
  const allSame = selected.every(s => (s.assignedPatientId ?? '') === first)
  return allSame ? first : ''
})

async function processNewFiles(newFiles: File[]) {
  await appState.processNewFiles(newFiles, isAppReady.value)
}

function addFilesToUploaded(newFiles: File[]) {
  appState.addFilesToUploaded(newFiles)
}

async function anonymizeSelected() {
  await appState.anonymizeSelected()
}

async function testConnection() {
  await appState.testConnection()
}

async function handleSendSelected(selectedStudiesToSend: DicomStudy[]) {
  await appState.handleSendSelected(selectedStudiesToSend)
}

function attemptSendSelected() {
  const { clearSelection: clearTableSelection } = useTableState()
  const selected = appState.selectedStudies.value.slice()
  if (selected.length === 0) return
  // Unselect immediately
  clearTableSelection()
  const hasNonAnonymized = selected.some(s =>
    s.series.some(ser => ser.files.some(f => !f.anonymized))
  )
  if (hasNonAnonymized) {
    pendingSendStudies.value = selected
    showSendWarningDialog.value = true
    return
  }
  const hasAlreadySent = selected.some(s => appState.isStudyAlreadySent(s))
  if (hasAlreadySent) {
    pendingResendStudies.value = selected
    showResendConfirmDialog.value = true
    return
  }
  handleSendSelected(selected)
}

function confirmSendAfterWarning() {
  const toSend = pendingSendStudies.value ?? []
  showSendWarningDialog.value = false
  pendingSendStudies.value = null
  if (toSend.length === 0) return
  const hasAlreadySent = toSend.some(s => appState.isStudyAlreadySent(s))
  if (hasAlreadySent) {
    pendingResendStudies.value = toSend
    showResendConfirmDialog.value = true
    return
  }
  handleSendSelected(toSend)
}

function confirmResendAfterDialog() {
  const toSend = pendingResendStudies.value ?? []
  showResendConfirmDialog.value = false
  pendingResendStudies.value = null
  if (toSend.length > 0) handleSendSelected(toSend)
}

function clearFiles() {
  appState.clearFiles()
  clearSession()
}

function clearSelectedFiles() {
  appState.clearSelected()
}

function handleConfigLoaded() {
  appState.handleConfigReload()
}

const {
  restore: restoreSession,
  clear: clearSession,
  isRestoring: persistenceRestoring,
  restoreProgress: persistenceProgress
} = useSessionPersistence(runtime, appState.dicomFiles, appState.studies)

watch(persistenceRestoring, (v) => (isRestoring.value = v))
watch(persistenceProgress, (v) => (restoreProgress.value = v))

onMounted(async () => {
  // Check for project in URL and load it
  try {
    const configData = await loadConfigFromUrl()
    if (configData) {
      await appState.handleLoadConfig(configData)
    }
  } catch (error) {
    console.error('Failed to load config from URL:', error)
  }

  // Restore session after potential project loading
  restoreSession()

  if (isAgentMode) {
    const registration = registerRatatoskrWebMcpTools({
      enabled: true,
      tools: agentTools,
    })
    webMcpState.value = registration.state
    disposeWebMcpTools = registration.dispose
  }
})

onUnmounted(() => {
  disposeWebMcpTools?.()
  runtime.dispose()
  appState.clearAppError()
})

function openCustomFieldsForStudy(row: DicomStudy): void {
  const { rowSelection } = useTableState()
  rowSelection.value = { [row.studyInstanceUID]: true }
  customFieldsTransition.openWithTransition(() => {
    showCustomFieldsSheet.value = true
  })
}

function openLogForStudy(row: DicomStudy): void {
  logSheetTransition.openWithTransition(() => {
    logStudyId.value = row.id
    showLogSheet.value = true
  })
}

function openMetadataForStudy(row: DicomStudy): void {
  metadataSheetTransition.openWithTransition(() => {
    metadataStudyId.value = row.id
    showMetadataSheet.value = true
  })
}

function openCustomFieldsFromToolbar(): void {
  customFieldsTransition.openWithTransition(() => {
    showCustomFieldsSheet.value = true
  })
}

function handleCustomFieldsUpdateOpen(next: boolean): void {
  if (!next && customFieldsTransition.suppressClose.value) return
  showCustomFieldsSheet.value = next
}

function handleLogSheetUpdateOpen(next: boolean): void {
  if (!next && logSheetTransition.suppressClose.value) return
  showLogSheet.value = next
}

function handleMetadataSheetUpdateOpen(next: boolean): void {
  if (!next && metadataSheetTransition.suppressClose.value) return
  showMetadataSheet.value = next
}
</script>

<template>
  <TooltipProvider>
    <div
      class="min-h-screen bg-background p-6 relative"
      @dragenter="(event) => handleGlobalDragEnter(event)"
      @dragleave="(event) => handleGlobalDragLeave(event)"
      @dragover="(event) => handleGlobalDragOver(event)"
      @drop="(event) => handleGlobalDrop(event, { onFilesAdded: addFilesToUploaded, onProcessFiles: processNewFiles })"
    >
      <!-- Global Drag Overlay -->
      <div
        v-if="isGlobalDragOver"
        class="fixed inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center"
        data-testid="global-drag-overlay"
      >
        <div class="bg-background border-2 border-dashed border-primary rounded-lg p-12 text-center">
          <div class="text-6xl text-primary mb-4">📁</div>
          <p class="text-2xl font-semibold text-primary">Drop files to upload</p>
          <p class="text-muted-foreground mt-2">Release to add DICOM files</p>
        </div>
      </div>

      <div class="mx-auto max-w-7xl space-y-2">
        <!-- Error Display -->
        <Alert
          v-if="error"
          :variant="error?.includes('browser') ? 'default' : 'destructive'"
        >
          <AlertDescription>
            {{ error }}
            <Button
              v-if="!error?.includes('browser')"
              variant="ghost"
              size="sm"
              @click="error ? (error = undefined) : appState.clearAppError()"
              class="ml-2 h-auto p-1"
            >
              ×
            </Button>
            <div
              v-if="error?.includes('browser')"
              class="mt-2 text-sm"
            >
              <p>This application requires modern browser features for optimal performance.</p>
              <p>Supported browsers: Chrome 86+, Edge 86+, Safari 15.2+, Firefox 111+</p>
            </div>
          </AlertDescription>
        </Alert>

        <!-- Configuration Loading State -->
        <Card v-if="appState.configLoading.value">
          <CardContent class="flex items-center justify-center py-8">
            <div class="text-center space-y-4 w-full max-w-md">
              <p class="text-muted-foreground">
                Loading configuration...
              </p>
              <Progress
                :model-value="50"
                class="w-full"
              />
            </div>
          </CardContent>
        </Card>


        <!-- Consolidated Toolbar -->
        <AppToolbar
          v-if="isAppReady"
          :current-project="appState.currentProject.value"
          :is-project-mode="appState.isProjectMode.value"
          :selected-studies-count="appState.selectedStudiesCount.value"
          :is-processing="hasActiveProcessing()"
          :is-downloading="isDownloading"
          @create-project="appState.handleCreateProject"
          @anonymize-selected="anonymizeSelected"
          @group-as-same-patient="appState.groupAsSamePatient()"
          @merge-selected="appState.mergeSelectedStudiesIntoOne()"
          @send-selected="attemptSendSelected()"
          @download-selected="downloadSelectedStudies(appState.studies.value, appState.selectedStudies.value)"
          @clear-all="clearFiles"
          @clear-selected="clearSelectedFiles"
          @test-connection="testConnection"
          @config-loaded="handleConfigLoaded"
          @add-files="(files) => { addFilesToUploaded(files); processNewFiles(files) }"
          @open-config-editor="showConfigEditSheet = true"
          @open-custom-fields-editor="openCustomFieldsFromToolbar"
        />

        <Alert
          v-if="isAgentMode"
          :variant="webMcpState.kind === 'registered' ? 'default' : 'destructive'"
          data-testid="webmcp-agent-status"
        >
          <AlertDescription>{{ agentModeStatusText }}</AlertDescription>
        </Alert>

        <!-- File Processing Progress -->
        <!-- Individual file processing progress indicators -->
        <div
          v-if="getAllTasks().length > 0"
          class="space-y-2"
        >
          <div
            v-if="getRunningTasks().length > 0"
            class="flex items-center justify-between mb-2"
          >
            <div class="text-sm font-medium text-muted-foreground">
              Processing {{ getRunningTasks().length }} file{{ getRunningTasks().length !== 1
                ? 's' : '' }} concurrently
            </div>
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-3 text-xs"
              @click="cancelAll"
            >
              Cancel All
            </Button>
          </div>

          <FileProcessingProgress
            v-for="state in getAllTasks()"
            :key="state.taskId"
            :file-name="state.fileName"
            :current-step="state.currentStep"
            :progress="state.progress"
            :error="state.error"
            @close="removeTask(state.taskId)"
          />
        </div>


        <!-- Studies Data Table or Session Restore Loading State -->
        <Card v-if="isRestoring">
          <CardContent class="flex items-center justify-center py-8">
            <div class="text-center space-y-4 w-full max-w-md">
              <p class="text-muted-foreground">
                {{ isRestoring ? 'Restoring previous session...' : 'Processing files...' }}
              </p>
              <Progress
                v-if="isRestoring && restoreProgress > 0"
                :model-value="restoreProgress"
                class="w-full"
              />
            </div>
          </CardContent>
        </Card>
        <DataTable
          v-else
          :columns="columns"
          :data="studiesData"
          :open-custom-fields-for-study="openCustomFieldsForStudy"
          :open-log-for-study="openLogForStudy"
          :open-metadata-for-study="openMetadataForStudy"
          data-testid="studies-data-table"
        />

        <!-- File counts for testing (small text at bottom) -->
        <div
          v-if="appState.dicomFiles.value.length > 0 || appState.anonymizedFilesCount.value > 0"
          class="text-xs text-muted-foreground mt-4 flex gap-4"
        >
          <span data-testid="files-count-badge">Files: {{ appState.dicomFiles.value.length }}</span>
          <span data-testid="anonymized-count-badge">Anonymized: {{ appState.anonymizedFilesCount.value }}</span>
        </div>
      </div>

      <!-- Worker Debug Panel -->
      <WorkerDebugPanel />

      <!-- Config Edit Sheet (App-level) -->
      <ConfigEditSheet
        :runtime="runtime"
        :current-project="appState.currentProject.value"
        :is-project-mode="appState.isProjectMode.value"
        :open="showConfigEditSheet"
        @update:open="showConfigEditSheet = $event"
        @config-updated="handleConfigLoaded"
        @create-project="(name) => appState.handleCreateProject(name)"
      />

      <!-- Custom Fields Sheet -->
      <CustomFieldsSheet
        :runtime="runtime"
        :open="showCustomFieldsSheet"
        :initial-overrides="initialOverrides"
        :initial-assigned-patient-id="initialAssignedPatientId"
        @update:open="handleCustomFieldsUpdateOpen"
        @save="(overrides) => appState.setCustomFieldsForSelected(overrides)"
        @assign-patient-id="(pid) => appState.assignPatientIdToSelected(pid)"
      />

      <!-- Study Log Sheet -->
      <StudyLogSheet
        :open="showLogSheet"
        :study-id="logStudyId"
        @update:open="handleLogSheetUpdateOpen"
      />

      <!-- Study Metadata Sheet -->
      <StudyMetadataSheet
        :open="showMetadataSheet"
        :study="appState.studies.value.find(s => s.id === metadataStudyId)"
        @update:open="handleMetadataSheetUpdateOpen"
      />

      <!-- Toast Notifications -->
      <Toaster />

      <!-- Send Warning Dialog -->
      <AlertDialog
        :open="showSendWarningDialog"
        @update:open="showSendWarningDialog = $event"
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Some selected studies are not anonymized</AlertDialogTitle>
            <AlertDialogDescription>
              Only anonymized files will be sent. Non-anonymized files will be skipped and logged in the study log. Do
              you
              want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="default"
              @click="confirmSendAfterWarning"
              data-testid="confirm-send-non-anonymized"
            >
              Send anonymized only
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <!-- Resend Confirmation Dialog -->
      <AlertDialog
        :open="showResendConfirmDialog"
        @update:open="showResendConfirmDialog = $event"
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resend already sent studies?</AlertDialogTitle>
            <AlertDialogDescription>
              One or more selected studies have already been sent. Do you want to resend them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="default"
              @click="confirmResendAfterDialog"
              data-testid="confirm-resend-sent-studies"
            >
              Resend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </TooltipProvider>
</template>
