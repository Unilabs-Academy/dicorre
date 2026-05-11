<template>
  <DialogDescription 
    :class="cn('text-sm text-muted-foreground')"
  >
    <slot />
  </DialogDescription>
</template>

<script setup lang="ts">
import { DialogDescription } from 'reka-ui'
import { cn } from '@/lib/utils'
</script>