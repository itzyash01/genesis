<script setup lang="ts">
import { computed } from "vue";
import { cn } from "../../lib/cn";

const props = withDefaults(
  defineProps<{
    variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
    size?: "default" | "sm" | "icon";
    class?: string;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  { variant: "default", size: "default", class: "", type: "button" },
);
const classes = computed(() =>
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50",
    {
      "bg-ink text-white shadow-sm hover:bg-ink/90": props.variant === "default",
      "border border-line bg-white text-ink hover:bg-paper": props.variant === "outline",
      "text-ink hover:bg-paper": props.variant === "ghost",
      "bg-rose-600 text-white hover:bg-rose-700": props.variant === "destructive",
      "bg-accent-soft text-accent hover:bg-accent/15": props.variant === "secondary",
    },
    {
      "h-10 px-4": props.size === "default",
      "h-8 px-3 text-xs": props.size === "sm",
      "h-9 w-9": props.size === "icon",
    },
    props.class,
  ),
);
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>
