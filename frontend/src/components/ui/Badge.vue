<script setup lang="ts">
withDefaults(defineProps<{ tone?: "default" | "green" | "amber" | "gray" }>(), { tone: "gray" });
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide"
    :class="{
      'bg-slate-100 text-slate-600': tone === 'gray',
      'bg-emerald-50 text-emerald-700': tone === 'green',
      'bg-amber-50 text-amber-700': tone === 'amber',
      'bg-ink text-white': tone === 'default',
    }"
  >
    <slot />
  </span>
</template>
