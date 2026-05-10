<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useStudyLogs } from '@/composables/useStudyLogs'

const props = defineProps<{ studyId: string }>()

const { getLogs, logsFor } = useStudyLogs()
const entries = logsFor(props.studyId)
const open = ref(false)

onMounted(() => { getLogs(props.studyId) })

const hasError = computed(() => entries.value.some(e => e.level === 'error'))

function formatTs(ts: number) {
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
}
</script>

<template>
  <div class="relative inline-block">
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          :class="hasError ? 'text-red-600' : 'text-muted-foreground'"
          @click.stop="open = !open"
        >
          📘
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle study log</TooltipContent>
    </Tooltip>
    <div
      v-if="open"
      class="absolute z-50 mt-2 right-0 w-96 shadow-lg border bg-background rounded-md p-2"
    >
      <Card>
        <CardContent class="p-2 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium">Study Log</div>
            <Badge :variant="hasError ? 'destructive' : 'secondary'">{{ hasError ? 'Errors' : 'OK' }}</Badge>
          </div>
          <div class="space-y-1 max-h-64 overflow-auto">
            <div
              v-if="entries.length === 0"
              class="text-xs text-muted-foreground"
            >No entries</div>
            <div
              v-for="(e, idx) in entries"
              :key="idx"
              class="text-xs"
            >
              <div>
                <span class="font-mono text-[10px] opacity-60">{{ formatTs(e.ts) }}</span>
                <span
                  class="ml-2"
                  :class="e.level === 'error' ? 'text-red-600' : (e.level === 'warn' ? 'text-amber-600' : 'text-foreground')"
                >
                  {{ e.message }}
                </span>
              </div>
              <div
                v-if="e.details"
                class="font-mono text-[10px] opacity-70 break-all"
              >{{ String(e.details) }}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<style scoped>
/* simple hover-to-open could be added later; keeping click reveals inline popover structure minimal */
</style>
