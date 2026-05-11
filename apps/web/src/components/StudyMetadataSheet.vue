<script setup lang="ts">
import { inject, ref, watch, computed } from 'vue'
import type { DicomStudy } from '@/types/dicom'
import type { RuntimeType } from '@/types/effects'
import { Effect } from 'effect'
import { OPFSStorage } from '@/services/opfsStorage'
import { DicomProcessor } from '@/services/dicomProcessor'
import * as dcmjs from 'dcmjs'
import { tagHexToName } from '@/utils/dicom-tag-dictionary'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

const props = defineProps<{ open: boolean, study?: DicomStudy }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const runtime = inject('appRuntime') as RuntimeType

type SeriesSample = {
  seriesInstanceUID: string
  seriesDescription?: string
  modality?: string
  sampleSOPInstanceUID?: string
  sampleInstanceNumber?: number
  sampledFileId?: string
  tags?: Array<{ hex: string, name: string, value: string }>
}

type StudySample = {
  patientName?: string
  patientId?: string
  accessionNumber?: string
  studyDate?: string
  patientSex?: string
  patientAge?: string
}

const isLoading = ref(false)
const loadError = ref<string | null>(null)
const studySample = ref<StudySample | null>(null)
const seriesSamples = ref<SeriesSample[]>([])

const hasData = computed(() => !!studySample.value || seriesSamples.value.length > 0)

async function loadSamples() {
  const study = props.study
  if (!study || !runtime) return
  isLoading.value = true
  loadError.value = null
  studySample.value = null
  seriesSamples.value = []

  try {
    // Load one file per series, in order
    const localSeriesSamples: SeriesSample[] = []
    let headerSet = false

    for (const series of study.series) {
      const firstFile = series.files[0]
      if (!firstFile) continue
      const fileId = firstFile.opfsFileId || firstFile.id

      const parsedTagged = await runtime.runPromise(
        Effect.gen(function* () {
          const opfs = yield* OPFSStorage
          const processor = yield* DicomProcessor
          const arrayBuffer = yield* opfs.loadFile(fileId)
          const parsed = yield* processor.parseFile({
            id: firstFile.id,
            fileName: firstFile.fileName,
            fileSize: firstFile.fileSize,
            arrayBuffer,
            metadata: firstFile.metadata,
            anonymized: firstFile.anonymized,
            sent: firstFile.sent,
            parsed: false,
            opfsFileId: firstFile.opfsFileId
          } as any)
          const dataset = dcmjs.data.DicomMessage.readFile(arrayBuffer as ArrayBuffer)
          const dict = (dataset as any).dict || {}
          const tags: Array<{ hex: string, name: string, value: string }> = []
          for (const [hex, elem] of Object.entries(dict)) {
            const hexClean = String(hex)
            let valueStr = ''
            try {
              const anyElem: any = elem as any
              if (anyElem?.Value != null) {
                if (Array.isArray(anyElem.Value)) {
                  // Pretty print arrays, including nested objects
                  valueStr = anyElem.Value.map((v: unknown) => {
                    if (v == null) return ''
                    if (typeof v === 'object') {
                      try { return JSON.stringify(v, null, 2) } catch { return String(v) }
                    }
                    return String(v)
                  }).join(' | ')
                } else {
                  if (typeof anyElem.Value === 'object') {
                    try { valueStr = JSON.stringify(anyElem.Value, null, 2) } catch { valueStr = String(anyElem.Value) }
                  } else {
                    valueStr = String(anyElem.Value)
                  }
                }
              } else if (anyElem?.InlineBinary) {
                const len = (anyElem.InlineBinary as string).length
                valueStr = `<binary: ${len} chars>`
              } else {
                valueStr = ''
              }
            } catch {
              valueStr = ''
            }
            let name = ''
            try {
              name = tagHexToName(hexClean)
            } catch {
              name = hexClean
            }
            tags.push({ hex: hexClean, name, value: valueStr })
          }
          return { parsed, tags }
        })
      )

      const md = (parsedTagged as any).parsed.metadata || {}
      if (!headerSet) {
        studySample.value = {
          patientName: normalizePatientName(md.patientName),
          patientId: md.patientId,
          accessionNumber: md.accessionNumber,
          studyDate: md.studyDate,
          patientSex: md.patientSex,
          patientAge: md.patientAge
        }
        headerSet = true
      }

      localSeriesSamples.push({
        seriesInstanceUID: md.seriesInstanceUID || series.seriesInstanceUID,
        seriesDescription: md.seriesDescription || series.seriesDescription,
        modality: md.modality || series.modality,
        sampleSOPInstanceUID: md.sopInstanceUID,
        sampleInstanceNumber: md.instanceNumber,
        sampledFileId: fileId,
        tags: (parsedTagged as any).tags
      })
    }

    seriesSamples.value = localSeriesSamples
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    isLoading.value = false
  }
}

// removed calculated age; we display raw DICOM patient age

watch(() => props.open, (next) => {
  if (next) loadSamples()
})

watch(() => props.study?.id, () => {
  if (props.open) loadSamples()
})

// No copy summary; we display full tag tables per sampled series
</script>

<script lang="ts">
// Local helper to normalize PN objects or other non-string representations
function normalizePatientName(value: unknown): string {
  if (value == null) return 'Unknown'
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const obj: any = value as any
    if (typeof obj.Alphabetic === 'string') return obj.Alphabetic
    const entries = Object.values(obj)
    if (entries.length > 0) {
      const first = entries[0]
      if (typeof first === 'string') return first
      try { return String(first) } catch { return 'Unknown' }
    }
    return 'Unknown'
  }
  try { return String(value) } catch { return 'Unknown' }
}
</script>

<template>
  <Sheet
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <SheetContent
      side="right"
      class="w-[520px] sm:max-w-[520px]"
      data-testid="study-metadata-sheet"
    >
      <SheetHeader>
        <SheetTitle>DICOM Metadata</SheetTitle>
        <SheetDescription v-if="study">
          Study UID: <span class="font-mono text-xs opacity-70">{{ study.studyInstanceUID }}</span>
        </SheetDescription>

      </SheetHeader>

      <div class="mt-4 space-y-4 max-h-[70vh] overflow-auto">
        <div
          v-if="isLoading"
          class="text-sm text-muted-foreground"
        >Loading sample metadata from disk…</div>
        <div
          v-else-if="loadError"
          class="text-sm text-red-600"
        >{{ loadError }}</div>

        <div
          v-if="studySample"
          class="space-y-1 text-sm"
        >
          <div><span class="opacity-60">Patient:</span> {{ studySample.patientName || 'Unknown' }} <span
              class="opacity-60"
            >[{{ studySample.patientId || 'Unknown' }}]</span></div>
          <div><span class="opacity-60">Accession:</span> {{ studySample.accessionNumber || '—' }}</div>
          <div><span class="opacity-60">Study Date:</span> {{ studySample.studyDate || '—' }}</div>
          <div><span class="opacity-60">Sex:</span> {{ studySample.patientSex || '—' }}</div>
          <div><span class="opacity-60">Age:</span> {{ studySample.patientAge || '—' }}</div>
        </div>

        <div class="space-y-2">
          <div
            class="text-xs opacity-60"
            v-if="seriesSamples.length > 0"
          >Series (sampled one file per series):</div>
          <div
            v-for="s in seriesSamples"
            :key="s.seriesInstanceUID + (s.sampledFileId || '')"
            class="border rounded p-2"
          >
            <div class="text-sm font-medium">{{ s.seriesDescription || 'Unknown Series' }}</div>
            <div class="text-xs opacity-70">
              <div>UID: <span class="font-mono">{{ s.seriesInstanceUID }}</span></div>
              <div>Modality: {{ s.modality || '—' }}</div>
              <div v-if="s.sampleSOPInstanceUID">Sample SOP: <span class="font-mono">{{ s.sampleSOPInstanceUID }}</span>
              </div>
              <div v-if="s.sampleInstanceNumber != null">Sample Instance #: {{ s.sampleInstanceNumber }}</div>
            </div>
            <div
              class="mt-2"
              v-if="s.tags && s.tags.length > 0"
            >
              <div class="text-xs opacity-60 mb-1">All tags (sample file):</div>
              <div class="max-h-64 overflow-auto border rounded">
                <table class="w-full text-[11px]">
                  <thead>
                    <tr class="text-left opacity-60">
                      <th class="px-2 py-1">Tag</th>
                      <th class="px-2 py-1">Name</th>
                      <th class="px-2 py-1">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="t in s.tags"
                      :key="s.seriesInstanceUID + t.hex"
                    >
                      <td class="px-2 py-1 font-mono">{{ t.hex }}</td>
                      <td class="px-2 py-1">{{ t.name }}</td>
                      <td class="px-2 py-1 break-all whitespace-pre-wrap">{{ t.value }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div
            v-if="!isLoading && seriesSamples.length === 0"
            class="text-sm text-muted-foreground"
          >No series found.</div>
        </div>
      </div>
    </SheetContent>
  </Sheet>

</template>
