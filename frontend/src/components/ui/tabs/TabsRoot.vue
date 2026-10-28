<script setup lang="ts">
import { TabsRoot as RekaTabsRoot } from "reka-ui";
defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <RekaTabsRoot
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <slot />
  </RekaTabsRoot>
</template>
