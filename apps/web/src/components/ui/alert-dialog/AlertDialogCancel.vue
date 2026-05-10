<template>
  <DialogClose as-child>
    <Button 
      variant="outline"
      class="mt-2 sm:mt-0"
    >
      <slot />
    </Button>
  </DialogClose>
</template>

<script setup lang="ts">
import { DialogClose } from 'reka-ui'
import { Button } from '@/components/ui/button'
</script>