<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <slot />
  </DialogRoot>
</template>

<script setup lang="ts">
import { DialogRoot } from 'reka-ui'

interface Props {
  open?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const onOpenChange = (value: boolean) => {
  emit('update:open', value)
}
</script>