<script setup lang="ts">
import { onMounted, computed, watch, nextTick, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useStudyLogs } from '@/composables/useStudyLogs'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Copy } from 'lucide-vue-next'

const props = defineProps<{ open: boolean, studyId?: string }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { getLogs, logsFor } = useStudyLogs()
const entries = computed(() => props.studyId ? logsFor(props.studyId).value : [])

const loadLogs = (studyId: string) => {
  getLogs(studyId)
}

onMounted(() => {
  if (props.studyId) {
    loadLogs(props.studyId)
  }
})

// Watch for studyId changes (when sheet is opened with different study)
watch(() => props.studyId, (newStudyId, oldStudyId) => {
  if (newStudyId && newStudyId !== oldStudyId) {
    nextTick(() => loadLogs(newStudyId))
  }
}, { immediate: false })

// Also watch for when the sheet opens
watch(() => props.open, (newOpen) => {
  if (newOpen && props.studyId) {
    nextTick(() => loadLogs(props.studyId!))
  }
})

function formatTs(ts: number) {
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
}

function formatDetails(details: unknown): string | null {
  if (details == null) return null
  if (typeof details === 'string') return details
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

const expanded = ref<Set<number>>(new Set())
function toggleExpand(idx: number) {
  const next = new Set(expanded.value)
  if (next.has(idx)) next.delete(idx)
  else next.add(idx)
  expanded.value = next
}
function isExpanded(idx: number) {
  return expanded.value.has(idx)
}

function formatEntryLine(e: { ts: number, level: string, message: string, details?: unknown }): string {
  const head = `${formatTs(e.ts)} [${e.level}] ${e.message}`
  if (e.details !== undefined && e.details !== null) {
    const det = formatDetails(e.details)
    return `${head}\n${det}`
  }
  return head
}

async function copyLog() {
  const list = entries.value
  if (!list || list.length === 0) return
  const text = list.map((e) => formatEntryLine(e as any)).join('\n')
  let copied = false
  try {
    await navigator.clipboard.writeText(text)
    copied = true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      copied = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      copied = false
    }
  }
  if (copied) toast.success('Copied log to clipboard')
}
</script>

<template>
  <Sheet
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <SheetContent
      side="right"
      class="w-[480px]"
      data-testid="study-log-sheet"
    >
      <SheetHeader>
        <SheetTitle>Study Log</SheetTitle>
        <SheetDescription
          v-if="studyId"
          class="font-mono text-xs opacity-60"
        >ID: {{ studyId }}</SheetDescription>
        <div class="mt-2">
          <Button
            variant="outline"
            size="sm"
            class="w-full"
            data-testid="copy-log-button"
            @click="copyLog"
            :disabled="entries.length === 0"
          >
            <Copy class="size-4" />
            Copy log to clipboard
          </Button>
        </div>
      </SheetHeader>
      <div class="mt-4 space-y-2 max-h-[70vh] overflow-auto">
        <div
          v-if="entries.length === 0"
          class="text-sm text-muted-foreground"
          data-testid="log-no-entries"
        >No entries</div>
        <div
          v-for="(e, idx) in entries"
          :key="idx"
          class="text-xs"
          :data-testid="`log-entry-${e.level}`"
        >
          <div>
            <span class="font-mono text-[10px] opacity-60">{{ formatTs(e.ts) }}</span>
            <span
              class="ml-2"
              :class="e.level === 'error' ? 'text-red-600' : (e.level === 'warn' ? 'text-amber-600' : 'text-foreground')"
            >
              {{ e.message }}
            </span>
            <button
              v-if="e.details"
              type="button"
              class="text-[10px] opacity-70 hover:opacity-100"
              @click="toggleExpand(idx)"
            >
              <span v-if="!isExpanded(idx)">[+] Show info</span>
              <span v-else>[-] Hide info</span>
            </button>
          </div>
          <pre
            v-if="e.details && isExpanded(idx)"
            class="font-mono text-[10px] opacity-70 whitespace-pre-wrap break-all"
          >{{ formatDetails(e.details) }}</pre>
        </div>
      </div>
    </SheetContent>
  </Sheet>

</template>
