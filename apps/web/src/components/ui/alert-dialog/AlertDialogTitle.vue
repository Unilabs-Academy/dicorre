<template>
  <DialogTitle 
    :class="cn('text-lg font-semibold')"
  >
    <slot />
  </DialogTitle>
</template>

<script setup lang="ts">
import { DialogTitle } from 'reka-ui'
import { cn } from '@/lib/utils'
</script>