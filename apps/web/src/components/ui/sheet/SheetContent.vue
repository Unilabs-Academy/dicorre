<script setup lang="ts">
import Sheet from './Sheet.vue'

defineOptions({
  inheritAttrs: false,
})
</script>

<template>
  <Sheet v-bind="$attrs">
    <slot />
  </Sheet>
</template>