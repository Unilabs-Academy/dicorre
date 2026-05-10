<script setup lang="ts">
import { ref, inject } from 'vue'
import { Effect, ManagedRuntime } from 'effect'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ConfigService } from '@/services/config'
import { Settings, Upload } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps<{
  asMenuItem?: boolean
}>()

const emit = defineEmits<{
  'config-loaded': []
}>()

const fileInputRef = ref<HTMLInputElement>()
const loading = ref(false)

// Get the shared runtime from the app
const runtime = inject<ManagedRuntime.ManagedRuntime<any, never>>('appRuntime')
if (!runtime) {
  throw new Error('App runtime not found. Make sure ConfigLoader is called within a component that has access to the app runtime.')
}

const handleFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  
  if (!file) return
  
  loading.value = true
  
  try {
    // Read file content
    const text = await file.text()
    
    // Parse JSON
    let configData: unknown
    try {
      configData = JSON.parse(text)
    } catch (e) {
      throw new Error('Invalid JSON format')
    }
    
    // Load and validate config using ConfigService
    await runtime.runPromise(
      Effect.gen(function* () {
        const configService = yield* ConfigService
        yield* configService.loadConfig(configData)
      })
    )
    
    toast.success('Config loaded successfully')
    emit('config-loaded')
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to load configuration'
    toast.error(errorMessage)
    console.error('Config loading error:', err)
  } finally {
    loading.value = false
    // Reset file input
    if (fileInputRef.value) {
      fileInputRef.value.value = ''
    }
  }
}

const openFileDialog = () => {
  fileInputRef.value?.click()
}
</script>

<template>
  <div>
    <input
      ref="fileInputRef"
      type="file"
      accept=".json"
      @change="handleFileSelect"
      class="hidden"
      data-testid="config-file-input"
    />
    
    <DropdownMenuItem
      v-if="props.asMenuItem"
      @click.prevent="openFileDialog"
      :disabled="loading"
      data-testid="load-config-menu-item"
    >
      <Upload v-if="!loading" class="w-4 h-4 mr-2" />
      <Settings v-if="loading" class="w-4 h-4 mr-2 animate-spin" />
      {{ loading ? 'Loading...' : 'Load Config' }}
    </DropdownMenuItem>
    
    <Button
      v-else
      @click="openFileDialog"
      :disabled="loading"
      variant="outline"
      size="sm"
      data-testid="load-config-button"
    >
      <Upload v-if="!loading" class="w-4 h-4 mr-2" />
      <Settings v-if="loading" class="w-4 h-4 mr-2 animate-spin" />
      {{ loading ? 'Loading...' : 'Load Config' }}
    </Button>
  </div>
</template>