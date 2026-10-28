<script setup lang="ts">
defineProps<{ modelValue?: string; type?: string; placeholder?: string; disabled?: boolean; autocomplete?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <input
    :value="modelValue"
    :type="type || 'text'"
    :placeholder="placeholder"
    :disabled="disabled"
    :autocomplete="autocomplete"
    class="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-accent/60 focus:ring-4 focus:ring-accent/10 disabled:opacity-50"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  >
</template>
