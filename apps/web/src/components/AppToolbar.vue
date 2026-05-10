<script setup lang="ts">
import { ref, computed } from 'vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Shield,
  Send,
  Trash2,
  Settings2,
  Wifi,
  Download,
  Folder,
  Link,
  Plus,
  Pencil,
  Layers,
  MoreVertical
} from 'lucide-vue-next'
import { useProjectSharing } from '@/composables/useProjectSharing'
import type { ProjectConfig } from '@/services/config/schema'

const props = defineProps<{
  currentProject?: ProjectConfig
  isProjectMode: boolean
  selectedStudiesCount: number
  isProcessing: boolean
  isDownloading: boolean
}>()

const emit = defineEmits<{
  anonymizeSelected: []
  groupAsSamePatient: []
  mergeSelected: []
  sendSelected: []
  downloadSelected: []
  clearAll: []
  clearSelected: []
  testConnection: []
  configLoaded: []
  addFiles: [files: File[]]
  openConfigEditor: []
  openCustomFieldsEditor: []
}>()

const showClearDialog = ref(false)

const { copyShareableUrl } = useProjectSharing()

async function handleShareProject() {
  await copyShareableUrl()
}

function handleFileInput(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  if (files.length > 0) {
    emit('addFiles', files)
    target.value = ''
  }
}

function handleClearConfirm() {
  if (props.selectedStudiesCount > 0) {
    emit('clearSelected')
  } else {
    emit('clearAll')
  }
  showClearDialog.value = false
}

const clearButtonText = computed(() => {
  return props.selectedStudiesCount > 0
    ? 'Clear Selected'
    : 'Clear All'
})

const clearDialogTitle = computed(() => {
  return props.selectedStudiesCount > 0
    ? 'Clear Selected Studies'
    : 'Clear All Studies'
})

const clearDialogDescription = computed(() => {
  return props.selectedStudiesCount > 0
    ? `Are you sure you want to clear the ${props.selectedStudiesCount} selected ${props.selectedStudiesCount === 1 ? 'study' : 'studies'}? This action cannot be undone.`
    : 'Are you sure you want to clear all studies? This action cannot be undone.'
})
</script>

<template>
  <div
    class="flex items-center justify-between"
    data-testid="app-toolbar"
  >
    <!-- Left Side: Project Info -->
    <div class="flex items-center gap-3">
      <img
        src="/logo.webp"
        class="w-14"
      ></img>
      <div class="flex items-center gap-2">
        <div class="mr-4 flex gap-2 items-center">
          <Folder class="h-5 w-5 text-primary" />
          <span data-testid="project-title">
            <strong>{{ props.currentProject?.name || 'No active project' }}</strong>
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              @click="emit('openConfigEditor')"
              variant="outline"
              size="sm"
              data-testid="edit-project-button"
            >
              <Settings2 class="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit settings</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              @click="handleShareProject"
              variant="outline"
              size="sm"
              :disabled="!isProjectMode"
              data-testid="share-project-button"
            >
              <Link class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy shareable link</TooltipContent>
        </Tooltip>


      </div>
    </div>

    <!-- Right Side: Actions -->
    <div class="flex items-center gap-2">
      <input
        type="file"
        multiple
        @change="handleFileInput"
        class="hidden"
        id="toolbar-file-input"
        data-testid="toolbar-file-input"
      >
      <Button
        asChild
        variant="outline"
        size="sm"
      >
        <label
          for="toolbar-file-input"
          class="cursor-pointer"
          data-testid="toolbar-add-button"
        >
          <Plus class="w-4 h-4 mr-2" />
          Add Files
        </label>
      </Button>
      <Button
        @click="emit('anonymizeSelected')"
        :disabled="props.selectedStudiesCount === 0"
        variant="outline"
        size="sm"
        data-testid="anonymize-button"
      >
        <Shield class="w-4 h-4 mr-2" />
        Anonymize
      </Button>

      <Button
        @click="emit('sendSelected')"
        :disabled="props.isProcessing || props.selectedStudiesCount === 0"
        variant="outline"
        size="sm"
        data-testid="send-button"
      >
        <Send class="w-4 h-4 mr-2" />
        Send
      </Button>

      <!-- Settings Dropdown -->
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="dropdown-menu-trigger"
          >
            <MoreVertical class="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            @click="emit('groupAsSamePatient')"
            :disabled="props.selectedStudiesCount < 2"
            data-testid="group-menu-item"
          >
            <Layers class="w-4 h-4 mr-2" />
            Assign same Patient ID to Selected
          </DropdownMenuItem>

          <DropdownMenuItem
            @click="emit('mergeSelected')"
            :disabled="props.selectedStudiesCount < 2"
            data-testid="merge-menu-item"
          >
            <Layers class="w-4 h-4 mr-2" />
            Merge into One Study
          </DropdownMenuItem>

          <DropdownMenuItem
            @click="emit('openCustomFieldsEditor')"
            :disabled="props.selectedStudiesCount === 0"
            data-testid="custom-fields-menu-item"
          >
            <Pencil class="w-4 h-4 mr-2" />
            Edit Custom Fields
          </DropdownMenuItem>

          <DropdownMenuItem
            @click="emit('downloadSelected')"
            :disabled="props.isDownloading || props.selectedStudiesCount === 0"
            data-testid="download-menu-item"
          >
            <Download class="w-4 h-4 mr-2" />
            Download Selected
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            @click="showClearDialog = true"
            data-testid="clear-menu-item"
          >
            <Trash2 class="w-4 h-4 mr-2" />
            {{ clearButtonText }}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            @click="emit('testConnection')"
            data-testid="test-connection-menu-item"
          >
            <Wifi class="w-4 h-4 mr-2" />
            Test Connection
          </DropdownMenuItem>

        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Clear Confirmation Dialog -->
      <AlertDialog
        :open="showClearDialog"
        @update:open="showClearDialog = $event"
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ clearDialogTitle }}</AlertDialogTitle>
            <AlertDialogDescription>
              {{ clearDialogDescription }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              @click="handleClearConfirm"
              variant="destructive"
              data-testid="confirm-clear"
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  </div>
</template>
