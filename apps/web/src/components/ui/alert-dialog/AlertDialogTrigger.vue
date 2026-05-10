<template>
  <DialogTrigger as-child>
    <slot />
  </DialogTrigger>
</template>

<script setup lang="ts">
import { DialogTrigger } from 'reka-ui'
</script>