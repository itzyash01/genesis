<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "reka-ui";
defineProps<{ open?: boolean; title: string; description?: string }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
</script>

<template>
  <DialogRoot
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogTrigger as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-6 shadow-2xl focus:outline-none">
        <div class="mb-5">
          <DialogTitle class="text-lg font-semibold tracking-tight text-ink">
            {{ title }}
          </DialogTitle>
          <DialogDescription
            v-if="description"
            class="mt-1 text-sm leading-relaxed text-slate-500"
          >
            {{ description }}
          </DialogDescription>
        </div>
        <slot />
        <DialogClose
          class="absolute right-4 top-4 rounded-md px-2 py-1 text-slate-400 hover:bg-paper hover:text-ink"
          aria-label="Close"
        >
          <span aria-hidden="true">×</span>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
