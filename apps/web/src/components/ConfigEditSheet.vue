<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Effect } from 'effect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { X, Plus } from 'lucide-vue-next'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { appConfigEditSchema, type FieldSchema, type ConfigEditSchema } from '@/services/config/editSchema'
import type { RuntimeType } from '@/types/effects'
import { toast } from 'vue-sonner'
import type { ProjectConfig } from '@/services/config/schema'
import { validateAppConfig, encodeAppConfig } from '@/services/config/schema'
import { ConfigService } from '@/services/config'
import { configId } from '@/services/config/configId'
import ConfigLoader from '@/components/ConfigLoader.vue'
import { useProjectSharing } from '@/composables/useProjectSharing'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Combobox, ComboboxTrigger, ComboboxList, ComboboxItem, ComboboxAnchor, ComboboxInput, ComboboxViewport } from '@/components/ui/combobox'
import { getAllTagNames } from '@/utils/dicom-tag-dictionary'

const props = defineProps<{
  open: boolean
  runtime: RuntimeType
  currentProject?: ProjectConfig
  isProjectMode: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'config-updated': []
  'create-project': [name: string]
  'update-project': [project: ProjectConfig]
}>()

const isProcessing = ref(false)
const editedConfig = ref<any>({})
const expandedSections = ref<Set<string>>(new Set(['project', 'dicomServer']))
const shortConfigId = ref('')

// Project-specific state
const projectName = ref('')
type ParamRow = { key: string; value: string }
const params = ref<ParamRow[]>([])

const { prepareConfigForExport, downloadConfig } = useProjectSharing()
const allTagNames = getAllTagNames()

// Local search state to avoid rendering thousands of items at once
const preserveSearchTerms = ref<Record<number, string>>({})
const replacementSearchTerms = ref<Record<string, string>>({})

function filterTagNames(term: string | undefined): string[] {
  const t = (term || '').toLowerCase().trim()
  if (!t) return allTagNames.slice(0, 200)
  const out: string[] = []
  for (const name of allTagNames) {
    if (name.toLowerCase().includes(t)) {
      out.push(name)
      if (out.length >= 200) break
    }
  }
  return out
}

function toggleSection(section: string) {
  if (expandedSections.value.has(section)) {
    expandedSections.value.delete(section)
  } else {
    expandedSections.value.add(section)
  }
}

// Load current config into editor state (on mount and when sheet opens)
function refreshEditedConfig() {
  props.runtime.runPromise(
    Effect.gen(function* () {
      const svc = yield* ConfigService
      const cfg = yield* svc.getCurrentConfig
      editedConfig.value = JSON.parse(JSON.stringify(cfg))
      syncProjectFieldsFromConfig(editedConfig.value)
    })
  ).catch((err) => {
    console.error('Failed to load current configuration:', err)
    editedConfig.value = {}
  })
}

refreshEditedConfig()

watch(() => props.open, (isOpen) => {
  if (isOpen) refreshEditedConfig()
})

watch(editedConfig, async (v) => {
  try {
    shortConfigId.value = await configId(v, { len: 8, ignoreKeys: ['project', 'projectName'] })
  } catch {
    shortConfigId.value = ''
  }
}, { deep: true, immediate: true })

// Keep simple: treat project as part of config; sync local fields from edited config
function syncProjectFieldsFromConfig(cfg: any) {
  const proj = cfg?.project
  projectName.value = proj?.name || ''
  const existingParams = ((proj as any)?.plugins?.settings?.['sent-notifier']?.params || {}) as Record<string, string>
  params.value = Object.entries(existingParams).map(([key, value]) => ({ key, value: String(value ?? '') }))
}

function toRecord(rows: ParamRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    out[k] = r.value
  }
  return out
}

function addParam() {
  params.value = [...params.value, { key: '', value: '' }]
}

function removeParam(index: number) {
  params.value = params.value.filter((_, i) => i !== index)
}

function getFieldValue(path: string): any {
  const parts = path.split('.')
  let value = editedConfig.value
  for (const part of parts) {
    value = value?.[part]
  }
  return value
}

function setFieldValue(path: string, value: any) {
  const parts = path.split('.')
  const lastPart = parts.pop()!
  let obj = editedConfig.value
  for (const part of parts) {
    if (!obj[part]) obj[part] = {}
    obj = obj[part]
  }
  obj[lastPart] = value
}

function addArrayItem(path: string) {
  const current = getFieldValue(path) || []
  setFieldValue(path, [...current, ''])
}

function removeArrayItem(path: string, index: number) {
  const current = getFieldValue(path) || []
  setFieldValue(path, current.filter((_: any, i: number) => i !== index))
}

function updateArrayItem(path: string, index: number, value: string) {
  const current = getFieldValue(path) || []
  const updated = [...current]
  updated[index] = value
  setFieldValue(path, updated)
}

function addRecordItem(path: string) {
  const current = getFieldValue(path) || {}
  const newKey = `key_${Date.now()}`
  setFieldValue(path, { ...current, [newKey]: '' })
}

function removeRecordItem(path: string, key: string | number) {
  const current = getFieldValue(path) || {}
  const { [key]: _, ...rest } = current
  setFieldValue(path, rest)
}

function updateRecordKey(path: string, oldKey: string | number, newKey: string) {
  const current = getFieldValue(path) || {}
  if (oldKey === newKey) return

  const value = current[oldKey]
  const { [oldKey]: _, ...rest } = current
  setFieldValue(path, { ...rest, [newKey]: value })
}

function updateRecordValue(path: string, key: string | number, value: string) {
  const current = getFieldValue(path) || {}
  setFieldValue(path, { ...current, [key]: value })
}

function setMultiselectOption(path: string, option: string, enabled: boolean) {
  const current: string[] = getFieldValue(path) || []
  const has = current.includes(option)
  if (enabled && !has) {
    setFieldValue(path, [...current, option])
  } else if (!enabled && has) {
    setFieldValue(path, current.filter((v: string) => v !== option))
  }
}

async function handleSaveConfig() {
  isProcessing.value = true
  try {
    // Clean up the config before saving
    const configToSave = { ...editedConfig.value }

    // Handle auth - if type is 'none', set auth to null
    if (configToSave.dicomServer?.auth?.type === 'none') {
      configToSave.dicomServer.auth = null
    }

    // Project: build from simple fields back into config
    if (projectName.value.trim()) {
      const existing = (editedConfig.value as any).project
      const nextProject = {
        ...existing,
        name: projectName.value.trim(),
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        plugins: {
          ...((existing as any)?.plugins),
          settings: {
            ...(((existing as any)?.plugins as any)?.settings),
            ['sent-notifier']: {
              ...((((existing as any)?.plugins as any)?.settings || {})['sent-notifier']),
              params: toRecord(params.value)
            }
          }
        }
      }
      configToSave.project = nextProject
    } else {
      // If no project name, clear project from config
      if (configToSave.project) delete (configToSave as any).project
    }

    // Validate before saving to avoid putting app into bad state
    await props.runtime.runPromise(
      Effect.gen(function* () {
        // Will throw with detailed message if invalid
        yield* validateAppConfig(configToSave)
      })
    )

    // Update config (project included) through the config service only after validation passes
    await props.runtime.runPromise(
      Effect.gen(function* () {
        const configService = yield* ConfigService
        yield* configService.loadConfig(configToSave)
      })
    )

    toast.success('Configuration saved successfully')
    emit('config-updated')
    emit('update:open', false)
  } catch (error) {
    console.error('Failed to save configuration:', error)
    toast.error('Failed to save configuration', {
      description: error instanceof Error ? error.message : 'Unknown error'
    })
  } finally {
    isProcessing.value = false
  }
}

function handleCancel() {
  emit('update:open', false)
}

function buildConfigForDownload() {
  return prepareConfigForExport(editedConfig.value, projectName.value, toRecord(params.value))
}

function handleDownloadConfig() {
  try {
    const configToSave = buildConfigForDownload()
    downloadConfig(configToSave, projectName.value || editedConfig.value?.project?.name)
  } catch (error) {
    console.error('Failed to download configuration:', error)
    toast.error('Failed to download configuration', {
      description: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
</script>

<template>
  <Sheet
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <SheetContent
      side="left"
      class="w-[600px] sm:max-w-[600px] overflow-y-auto"
    >
      <SheetHeader>
        <SheetTitle>
          Settings
          <span
            v-if="shortConfigId"
            class="text-muted-foreground text-xs ml-2"
          >#{{ shortConfigId }}</span>
        </SheetTitle>
        <SheetDescription>
          Configure project settings and application configuration.
        </SheetDescription>
      </SheetHeader>

      <div
        class="space-y-4 py-4"
        v-if="editedConfig"
      >
        <!-- Project Configuration -->
        <Card>
          <CardHeader
            class="cursor-pointer"
            @click="toggleSection('project')"
          >
            <CardTitle class="text-base">Project Settings</CardTitle>
            <CardDescription>Configure project name and plugin parameters</CardDescription>
          </CardHeader>
          <CardContent v-if="expandedSections.has('project')">
            <div class="space-y-4">
              <!-- Project Name -->
              <div class="space-y-2">
                <Label
                  for="project-name"
                  class="text-sm font-medium"
                >Project Name</Label>
                <div class="flex gap-2">
                  <Input
                    id="project-name"
                    v-model="projectName"
                    :placeholder="currentProject ? 'Enter project name...' : 'Enter project name (e.g., Untitled)...'"
                    :disabled="isProcessing"
                    class="flex-1"
                  />
                </div>
              </div>

              <!-- Sent Notifier Parameters -->
              <div class="space-y-2">
                <Label class="text-sm font-medium">Sent Notifier Parameters</Label>
                <div class="space-y-2">
                  <div
                    v-for="(row, idx) in params"
                    :key="idx"
                    class="flex gap-2"
                  >
                    <Input
                      v-model="row.key"
                      placeholder="Key"
                      :disabled="isProcessing"
                    />
                    <Input
                      v-model="row.value"
                      placeholder="Value"
                      :disabled="isProcessing"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          @click="removeParam(idx)"
                          :disabled="isProcessing"
                        >
                          <X class="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove parameter</TooltipContent>
                    </Tooltip>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="addParam"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Parameter
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- DICOM Server Configuration -->
        <Card>
          <CardHeader
            class="cursor-pointer"
            @click="toggleSection('dicomServer')"
          >
            <CardTitle class="text-base">DICOM Server</CardTitle>
            <CardDescription>Configure DICOM server connection settings</CardDescription>
          </CardHeader>
          <CardContent v-if="expandedSections.has('dicomServer')">
            <div class="space-y-4">
              <!-- Server URL -->
              <div class="space-y-2">
                <Label>Server URL</Label>
                <Input
                  :model-value="getFieldValue('dicomServer.url')"
                  @update:model-value="(v) => setFieldValue('dicomServer.url', v)"
                  :disabled="isProcessing"
                />
                <p class="text-xs text-muted-foreground">Must start with / or http</p>
              </div>

              <!-- Timeout -->
              <div class="space-y-2">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  :model-value="getFieldValue('dicomServer.timeout')"
                  @update:model-value="(v) => setFieldValue('dicomServer.timeout', typeof v === 'number' ? v : (parseInt(String(v)) || 30000))"
                  min="1000"
                  max="600000"
                  :disabled="isProcessing"
                />
              </div>

              <!-- Test Connection Path -->
              <div class="space-y-2">
                <Label>Test Connection Path</Label>
                <Input
                  :model-value="getFieldValue('dicomServer.testConnectionPath')"
                  @update:model-value="(v) => setFieldValue('dicomServer.testConnectionPath', v)"
                  placeholder="/studies"
                  :disabled="isProcessing"
                />
                <p class="text-xs text-muted-foreground">Relative path appended to the base URL when testing server
                  connectivity</p>
              </div>

              <!-- Headers -->
              <div class="space-y-2">
                <Label>Headers</Label>
                <div class="space-y-2">
                  <div
                    v-for="(value, key) in (getFieldValue('dicomServer.headers') || {})"
                    :key="String(key)"
                    class="flex gap-2"
                  >
                    <Input
                      :model-value="String(key)"
                      @update:model-value="(v) => updateRecordKey('dicomServer.headers', String(key), String(v))"
                      placeholder="Header name"
                      :disabled="isProcessing"
                    />
                    <Input
                      :model-value="String(value)"
                      @update:model-value="(v) => updateRecordValue('dicomServer.headers', String(key), String(v))"
                      placeholder="Header value"
                      :disabled="isProcessing"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          @click="removeRecordItem('dicomServer.headers', String(key))"
                          :disabled="isProcessing"
                        >
                          <X class="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove header</TooltipContent>
                    </Tooltip>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="addRecordItem('dicomServer.headers')"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Header
                  </Button>
                </div>
              </div>

              <!-- Authentication -->
              <div class="space-y-2">
                <Label>Authentication Type</Label>
                <select
                  class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  :value="getFieldValue('dicomServer.auth.type') || 'none'"
                  @change="setFieldValue('dicomServer.auth.type', ($event.target as HTMLSelectElement).value)"
                  :disabled="isProcessing"
                >
                  <option value="none">None</option>
                  <option value="basic">Basic Auth</option>
                  <option value="bearer">Bearer Token</option>
                </select>
              </div>

              <!-- Credentials (shown only if auth type is not 'none') -->
              <div
                v-if="getFieldValue('dicomServer.auth.type') && getFieldValue('dicomServer.auth.type') !== 'none'"
                class="space-y-2"
              >
                <Label>Credentials</Label>
                <Input
                  :model-value="getFieldValue('dicomServer.auth.credentials')"
                  @update:model-value="(v) => setFieldValue('dicomServer.auth.credentials', v)"
                  :placeholder="getFieldValue('dicomServer.auth.type') === 'basic' ? 'username:password' : 'Bearer token'"
                  :disabled="isProcessing"
                />
              </div>

              <!-- Description -->
              <div class="space-y-2">
                <Label>Description</Label>
                <Input
                  :model-value="getFieldValue('dicomServer.description')"
                  @update:model-value="(v) => setFieldValue('dicomServer.description', v)"
                  placeholder="Optional server description"
                  :disabled="isProcessing"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Anonymization Configuration -->
        <Card>
          <CardHeader
            class="cursor-pointer"
            @click="toggleSection('anonymization')"
          >
            <CardTitle class="text-base">Anonymization</CardTitle>
            <CardDescription>Configure DICOM anonymization settings</CardDescription>
          </CardHeader>
          <CardContent v-if="expandedSections.has('anonymization')">
            <div class="space-y-4">
              <!-- Profile Options -->
              <div class="space-y-2">
                <Label>Anonymization Profiles</Label>
                <div class="space-y-2 max-h-60 overflow-y-auto border rounded-md p-2">
                  <div
                    v-for="option in ((appConfigEditSchema.anonymization as ConfigEditSchema).profileOptions as FieldSchema).options || []"
                    :key="option.value"
                    class="flex items-start space-x-2"
                  >
                    <Checkbox
                      :model-value="(getFieldValue('anonymization.profileOptions') || []).includes(option.value)"
                      @update:model-value="(v) => setMultiselectOption('anonymization.profileOptions', option.value, !!v)"
                      :disabled="isProcessing"
                    />
                    <Label class="text-sm font-normal cursor-pointer">{{ option.label }}</Label>
                  </div>
                </div>
              </div>

              <!-- Boolean options -->
              <div class="space-y-2">
                <div class="flex items-center space-x-2">
                  <Checkbox
                    :model-value="getFieldValue('anonymization.removePrivateTags')"
                    @update:model-value="(v) => setFieldValue('anonymization.removePrivateTags', !!v)"
                    :disabled="isProcessing"
                  />
                  <Label>Remove Private Tags</Label>
                </div>

                <div class="flex items-center space-x-2">
                  <Checkbox
                    :model-value="getFieldValue('anonymization.useCustomHandlers')"
                    @update:model-value="(v) => setFieldValue('anonymization.useCustomHandlers', !!v)"
                    :disabled="isProcessing"
                  />
                  <Label>Use Custom Handlers</Label>
                </div>
              </div>

              <div class="space-y-2">
                <Label>UID Strategy</Label>
                <select
                  class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  :value="getFieldValue('anonymization.uidStrategy') || 'perRun'"
                  @change="setFieldValue('anonymization.uidStrategy', ($event.target as HTMLSelectElement).value)"
                  :disabled="isProcessing"
                >
                  <option
                    v-for="option in ((appConfigEditSchema.anonymization as ConfigEditSchema).uidStrategy as FieldSchema).options || []"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </div>

              <!-- Date Jitter -->
              <!-- <div class="space-y-2">
                <Label>Date Jitter (days)</Label>
                <Input
                  type="number"
                  :model-value="getFieldValue('anonymization.dateJitterDays')"
                  @update:model-value="(v) => setFieldValue('anonymization.dateJitterDays', typeof v === 'number' ? v : (parseInt(String(v)) || 0))"
                  placeholder="31"
                  min="0"
                  max="365"
                  :disabled="isProcessing"
                />
              </div> -->

              <!-- Organization Root -->
              <!-- <div class="space-y-2">
                <Label>Organization Root OID</Label>
                <Input
                  :model-value="getFieldValue('anonymization.organizationRoot')"
                  @update:model-value="(v) => setFieldValue('anonymization.organizationRoot', v)"
                  placeholder="1.2.826.0.1.3680043.8.498"
                  :disabled="isProcessing"
                />
                <p class="text-xs text-muted-foreground">Must be a valid OID (digits and dots only)</p>
              </div> -->

              <!-- Replacements -->
              <div class="space-y-2">
                <Label>Tag Replacements</Label>
                <div class="space-y-2">
                  <div
                    v-for="(value, key) in (getFieldValue('anonymization.replacements') || {})"
                    :key="key"
                    class="grid grid-cols-[1fr_auto_auto] gap-2"
                  >
                    <Combobox
                      :model-value="String(key)"
                      @update:model-value="(v) => updateRecordKey('anonymization.replacements', String(key), String(v))"
                    >
                      <ComboboxAnchor class="w-full">
                        <ComboboxTrigger
                          class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        >
                          {{ String(key) || 'Select Field' }}
                        </ComboboxTrigger>
                      </ComboboxAnchor>
                      <ComboboxList
                        class="w-[320px]"
                        align="start"
                      >
                        <div class="px-2 py-1">
                          <Input
                            :model-value="replacementSearchTerms[String(key)] || ''"
                            @update:model-value="(v) => replacementSearchTerms[String(key)] = String(v)"
                            placeholder="Search DICOM fields..."
                          />
                        </div>
                        <ComboboxViewport>
                          <ComboboxItem
                            v-for="name in filterTagNames(replacementSearchTerms[String(key)])"
                            :key="name"
                            :value="name"
                          >
                            {{ name }}
                          </ComboboxItem>
                        </ComboboxViewport>
                      </ComboboxList>
                    </Combobox>
                    <Input
                      :model-value="String(value)"
                      @update:model-value="(v) => updateRecordValue('anonymization.replacements', String(key), String(v))"
                      placeholder="Replacement value"
                      :disabled="isProcessing"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          @click="removeRecordItem('anonymization.replacements', String(key))"
                          :disabled="isProcessing"
                        >
                          <X class="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove replacement</TooltipContent>
                    </Tooltip>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="addRecordItem('anonymization.replacements')"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Replacement
                  </Button>
                </div>
                <p class="text-xs text-muted-foreground">Use {random} for random values</p>
              </div>

              <!-- Preserve Tags -->
              <div class="space-y-2">
                <Label>Preserve Tags</Label>
                <div class="space-y-2">
                  <div
                    v-for="(tag, index) in (getFieldValue('anonymization.preserveTags') || [])"
                    :key="index"
                    class="flex gap-2"
                  >
                    <div class="flex-1">
                      <Combobox
                        :model-value="tag"
                        @update:model-value="(v) => updateArrayItem('anonymization.preserveTags', index, String(v))"
                      >
                        <ComboboxAnchor class="w-full">
                          <ComboboxTrigger
                            class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                          >
                            {{ tag || 'Select Field' }}
                          </ComboboxTrigger>
                        </ComboboxAnchor>
                        <ComboboxList
                          class="w-[320px]"
                          align="start"
                        >
                          <div class="px-2 py-1">
                            <Input
                              :model-value="preserveSearchTerms[index] || ''"
                              @update:model-value="(v) => preserveSearchTerms[index] = String(v)"
                              placeholder="Search DICOM fields..."
                            />
                          </div>
                          <ComboboxViewport>
                            <ComboboxItem
                              v-for="name in filterTagNames(preserveSearchTerms[index])"
                              :key="name"
                              :value="name"
                            >
                              {{ name }}
                            </ComboboxItem>
                          </ComboboxViewport>
                        </ComboboxList>
                      </Combobox>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          @click="removeArrayItem('anonymization.preserveTags', index)"
                          :disabled="isProcessing"
                        >
                          <X class="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove tag</TooltipContent>
                    </Tooltip>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="addArrayItem('anonymization.preserveTags')"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Tag
                  </Button>
                </div>
              </div>

              <!-- Tags to Remove -->
              <div class="space-y-2">
                <Label>Tags to Remove</Label>
                <div class="space-y-2">
                  <div
                    v-for="(tag, index) in (getFieldValue('anonymization.tagsToRemove') || [])"
                    :key="index"
                    class="flex gap-2"
                  >
                    <Input
                      :model-value="tag"
                      @update:model-value="(v) => updateArrayItem('anonymization.tagsToRemove', index, String(v))"
                      placeholder="Tag pattern"
                      :disabled="isProcessing"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          @click="removeArrayItem('anonymization.tagsToRemove', index)"
                          :disabled="isProcessing"
                        >
                          <X class="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove pattern</TooltipContent>
                    </Tooltip>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="addArrayItem('anonymization.tagsToRemove')"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Pattern
                  </Button>
                </div>
                <p class="text-xs text-muted-foreground">Supports patterns like "startswith:", "contains:"</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Plugins Configuration -->
        <Card>
          <CardHeader
            class="cursor-pointer"
            @click="toggleSection('plugins')"
          >
            <CardTitle class="text-base">Plugins</CardTitle>
            <CardDescription>Configure plugin settings</CardDescription>
          </CardHeader>
          <CardContent v-if="expandedSections.has('plugins')">
            <div class="space-y-4">
              <!-- Enabled Plugins -->
              <div class="space-y-2">
                <Label>Enabled Plugins</Label>
                <div class="space-y-2 border rounded-md p-2">
                  <div
                    v-for="option in ((appConfigEditSchema.plugins as ConfigEditSchema).enabled as FieldSchema).options || []"
                    :key="option.value"
                    class="flex items-center space-x-2"
                  >
                    <Checkbox
                      :model-value="(getFieldValue('plugins.enabled') || []).includes(option.value)"
                      @update:model-value="(v) => setMultiselectOption('plugins.enabled', option.value, !!v)"
                      :disabled="isProcessing"
                    />
                    <Label class="text-sm font-normal cursor-pointer">{{ option.label }}</Label>
                  </div>
                </div>
              </div>
              <!-- Plugin Settings -->
              <div class="space-y-3">
                <Label>Plugin Settings</Label>
                <div
                  v-for="(pluginConfig, pluginId) in (getFieldValue('plugins.settings') || {})"
                  :key="String(pluginId)"
                  class="border rounded-md p-2 space-y-2"
                >
                  <div class="text-sm font-medium">{{ String(pluginId) }}</div>
                  <div class="space-y-2">
                    <div
                      v-for="(value, key) in (pluginConfig || {})"
                      :key="String(key)"
                      class="flex gap-2"
                    >
                      <Input
                        :model-value="String(key)"
                        @update:model-value="(v) => updateRecordKey(`plugins.settings.${String(pluginId)}`, String(key), String(v))"
                        placeholder="Key"
                        :disabled="isProcessing"
                      />
                      <Input
                        :model-value="String(value)"
                        @update:model-value="(v) => updateRecordValue(`plugins.settings.${String(pluginId)}`, String(key), String(v))"
                        placeholder="Value"
                        :disabled="isProcessing"
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            @click="removeRecordItem(`plugins.settings.${String(pluginId)}`, String(key))"
                            :disabled="isProcessing"
                          >
                            <X class="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove setting</TooltipContent>
                      </Tooltip>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      @click="addRecordItem(`plugins.settings.${String(pluginId)}`)"
                      :disabled="isProcessing"
                    >
                      <Plus class="w-4 h-4 mr-2" />
                      Add Setting
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <SheetFooter class="flex sm:justify-between">
        <div class="flex space-x-2">
          <Button
            variant="outline"
            @click="handleCancel"
            :disabled="isProcessing"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            @click="handleDownloadConfig"
            :disabled="isProcessing"
          >
            Download Config
          </Button>
          <ConfigLoader @config-loaded="() => { $emit('config-updated'); $emit('update:open', false) }" />
        </div>
        <Button
          @click="handleSaveConfig"
          :disabled="isProcessing"
        >
          {{ isProcessing ? 'Saving...' : 'Save Configuration' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
