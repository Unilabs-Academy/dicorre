<template>
  <DialogClose as-child>
    <Button 
      :variant="variant"
      :size="size"
      :class="$attrs.class"
      @click="$emit('click')"
    >
      <slot />
    </Button>
  </DialogClose>
</template>

<script setup lang="ts">
import { DialogClose } from 'reka-ui'
import { Button } from '@/components/ui/button'
import type { ButtonVariants } from '@/components/ui/button'

interface Props {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
})

const emit = defineEmits<{
  click: []
}>()
</script>