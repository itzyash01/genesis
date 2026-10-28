<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
defineProps<{ open: boolean; title: string; description?: string }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
</script>

<template>
  <DialogRoot
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-ink/25 backdrop-blur-sm" />
      <DialogContent class="fixed inset-y-0 right-0 z-50 flex w-[min(100vw,440px)] flex-col border-l border-line bg-white shadow-2xl focus:outline-none">
        <header class="border-b border-line px-6 py-5">
          <DialogTitle class="text-lg font-semibold text-ink">
            {{ title }}
          </DialogTitle>
          <DialogDescription
            v-if="description"
            class="mt-1 text-sm text-slate-500"
          >
            {{ description }}
          </DialogDescription>
        </header>
        <div class="min-h-0 flex-1 overflow-auto p-6">
          <slot />
        </div>
        <DialogClose
          class="absolute right-5 top-5 rounded-md px-2 py-1 text-slate-400 hover:bg-paper"
          aria-label="Close"
        >
          ×
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
