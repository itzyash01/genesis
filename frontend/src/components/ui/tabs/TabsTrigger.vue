<script setup lang="ts">
import { TabsTrigger as RekaTabsTrigger } from "reka-ui";
defineProps<{ value: string; class?: string }>();
</script>

<template>
  <RekaTabsTrigger
    :value="value"
    :class="[
      'flex h-full shrink-0 items-center gap-2 border-r border-line px-3 text-[10px] text-slate-400 transition hover:text-ink data-[state=active]:border-b-2 data-[state=active]:border-b-accent data-[state=active]:bg-[#fbfcfb] data-[state=active]:font-medium data-[state=active]:text-ink',
      $props.class,
    ]"
  >
    <slot />
  </RekaTabsTrigger>
</template>
