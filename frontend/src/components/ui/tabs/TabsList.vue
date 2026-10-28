<script setup lang="ts">
import { TabsList as RekaTabsList } from "reka-ui";
</script>

<template>
  <RekaTabsList class="flex h-10 shrink-0 items-center overflow-x-auto border-b border-line bg-white">
    <slot />
  </RekaTabsList>
</template>
