<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { validateDicomField } from '@/utils/dicomValidators'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RuntimeType } from '@/types/effects'
import { getAllTagNames, isValidTagName } from '@/utils/dicom-tag-dictionary'
import { Combobox, ComboboxTrigger, ComboboxList, ComboboxItem, ComboboxAnchor, ComboboxInput, ComboboxViewport } from '@/components/ui/combobox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  open: boolean
  runtime: RuntimeType
  initialOverrides?: Record<string, string>
  initialAssignedPatientId?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'save': [overrides: Record<string, string>]
  'assign-patient-id': [patientId: string]
}>()

type Row = { key: string; value: string }
const rows = ref<Row[]>([])
const patientId = ref('')
const isProcessing = ref(false)

const allTagNames = getAllTagNames()

const standardFieldNames = [
  "Patient's Age",
  "Patient's Sex",
  'Study Date'
]

function validateValueForKey(key: string, value: string): string | null {
  return validateDicomField(key, value)
}

const rowValidationErrors = computed<(string | null)[]>(() =>
  rows.value.map(r => validateValueForKey(r.key, r.value))
)

const hasValidationErrors = computed<boolean>(() =>
  rowValidationErrors.value.some(msg => Boolean(msg))
)

function addRow() {
  rows.value = [...rows.value, { key: '', value: '' }]
}

function removeRow(index: number) {
  rows.value = rows.value.filter((_, i) => i !== index)
}

function setKey(index: number, key: string) {
  const next = [...rows.value]
  next[index] = { ...next[index], key }
  rows.value = next
}

function setValue(index: number, value: string) {
  const next = [...rows.value]
  next[index] = { ...next[index], value }
  rows.value = next
}

function addStandardFields() {
  const validNames = standardFieldNames.filter(isValidTagName)
  const existingKeys = new Set(rows.value.map(r => r.key))
  const toAdd = validNames
    .filter(name => !existingKeys.has(name))
    .map(name => ({ key: name, value: '' }))
  if (toAdd.length) {
    rows.value = [...rows.value, ...toAdd]
  }
}

function toRecord(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows.value) {
    const k = r.key.trim()
    if (!k) continue
    out[k] = r.value
  }
  return out
}

function fromRecord(rec: Record<string, string>): Row[] {
  return Object.entries(rec).map(([key, value]) => ({ key, value: String(value) }))
}

async function handleSave() {
  isProcessing.value = true
  try {
    if (hasValidationErrors.value) {
      return
    }
    if (patientId.value.trim()) {
      emit('assign-patient-id', patientId.value.trim())
    }
    emit('save', toRecord())
    emit('update:open', false)
  } finally {
    isProcessing.value = false
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    rows.value = fromRecord(props.initialOverrides ?? {})
    patientId.value = props.initialAssignedPatientId ?? ''
  }
})
</script>

<template>
  <Sheet
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <SheetContent
      side="left"
      class="w-[520px] sm:max-w-[520px] overflow-y-auto"
    >
      <SheetHeader>
        <SheetTitle>Edit Custom DICOM Fields</SheetTitle>
        <SheetDescription>
          Select DICOM fields and set values to override during anonymization.
        </SheetDescription>
      </SheetHeader>

      <div class="space-y-4 py-4">
        <div class="space-y-3">
          <div class="grid grid-cols-12 gap-2 items-center">
            <div class="col-span-6">
              <div
                class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm select-none"
              >
                Patient ID
              </div>
            </div>
            <div class="col-span-5">
              <Input
                v-model="patientId"
                placeholder="Enter Patient ID"
                data-testid="custom-fields-patient-id-input"
              />
            </div>
            <div class="col-span-1"></div>
          </div>

          <div
            v-for="(row, idx) in rows"
            :key="idx"
            class="grid grid-cols-12 gap-2 items-start"
          >
            <div class="col-span-6">
              <Combobox
                :model-value="row.key"
                @update:model-value="(v) => setKey(idx, String(v))"
              >
                <ComboboxAnchor class="w-full">
                  <ComboboxTrigger
                    class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    {{ row.key || 'Select Field' }}
                  </ComboboxTrigger>
                </ComboboxAnchor>
                <ComboboxList
                  class="w-[320px]"
                  align="start"
                >
                  <ComboboxInput placeholder="Search DICOM fields..." />
                  <ComboboxViewport>
                    <ComboboxItem
                      v-for="name in allTagNames"
                      :key="name"
                      :value="name"
                    >
                      {{ name }}
                    </ComboboxItem>
                  </ComboboxViewport>
                </ComboboxList>
              </Combobox>
            </div>
            <div class="col-span-5">
              <Input
                :model-value="row.value"
                @update:model-value="(v) => setValue(idx, String(v))"
                placeholder="Value"
                :aria-invalid="Boolean(rowValidationErrors[idx])"
                :class="rowValidationErrors[idx] ? 'border-destructive focus-visible:ring-destructive' : ''"
              />
              <p
                v-if="rowValidationErrors[idx]"
                class="mt-1 text-xs text-destructive"
              >
                {{ rowValidationErrors[idx] }}
              </p>
            </div>
            <div class="col-span-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    @click="removeRow(idx)"
                  >✕</Button>
                </TooltipTrigger>
                <TooltipContent>Remove field</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              @click="addRow"
            >Add Field</Button>
            <Button
              variant="outline"
              size="sm"
              @click="addStandardFields"
              data-testid="custom-fields-add-standard"
            >Add standard</Button>
          </div>
        </div>
      </div>

      <SheetFooter class="flex sm:justify-between">
        <Button
          variant="outline"
          @click="$emit('update:open', false)"
        >Cancel</Button>
        <Button
          :disabled="isProcessing || hasValidationErrors"
          @click="handleSave"
        >{{ isProcessing ? 'Saving...' : 'Save' }}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>

</template>
