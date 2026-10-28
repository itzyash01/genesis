<script setup lang="ts">
defineProps<{ modelValue?: string; placeholder?: string; rows?: number; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <textarea
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows || 4"
    :disabled="disabled"
    class="w-full resize-y rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-accent/60 focus:ring-4 focus:ring-accent/10 disabled:opacity-50"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
