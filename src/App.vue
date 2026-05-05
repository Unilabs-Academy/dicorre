<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, provide } from 'vue'
import { ManagedRuntime } from 'effect'
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
  type WebMcpRegistrationState,
} from '@/agent/webmcp'
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
      getStatus: getAgentStatus,
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
