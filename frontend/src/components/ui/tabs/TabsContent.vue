<script setup lang="ts">
import { TabsContent as RekaTabsContent } from "reka-ui";
defineProps<{ value: string; class?: string }>();
</script>

<template>
  <RekaTabsContent
    :value="value"
    :class="['min-h-0 flex-1 outline-none', $props.class]"
  >
    <slot />
  </RekaTabsContent>
</template>
