<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ArrowUp, History, LoaderCircle, Sparkles, Square } from "@lucide/vue";
import type { ChatMessage } from "../lib/api";
import Button from "./ui/Button.vue";
import Textarea from "./ui/Textarea.vue";

const props = defineProps<{
  messages: ChatMessage[];
  generating: boolean;
  streamText: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  send: [prompt: string];
  cancel: [];
  snapshots: [];
}>();
const prompt = ref("");
const scrollArea = ref<HTMLDivElement | null>(null);
const examples = [
  "Build a recent contacts dashboard with search",
  "Create a calendar view for upcoming appointments",
  "Show recent conversations and message history",
];

function submit() {
  const value = prompt.value.trim();
  if (!value || props.generating || props.disabled) return;
  emit("send", value);
  prompt.value = "";
}

watch(
  () => [props.messages.length, props.streamText.length, props.generating],
  async () => {
    await nextTick();
    if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight;
  },
);
</script>

<template>
  <section class="flex min-h-[460px] flex-col border-r border-line bg-white lg:min-h-0">
    <header class="flex h-[58px] shrink-0 items-center justify-between border-b border-line px-4">
      <div>
        <h2 class="text-xs font-semibold text-ink">
          Build conversation
        </h2>
        <p class="mt-0.5 text-[10px] text-slate-400">
          Describe what you want to make
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Snapshot history"
        title="Snapshot history"
        @click="emit('snapshots')"
      >
        <History :size="16" />
      </Button>
    </header>
    <div
      ref="scrollArea"
      class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
    >
      <div
        v-if="messages.length === 0"
        class="rounded-xl bg-paper p-4"
      >
        <span class="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent"><Sparkles :size="16" /></span>
        <h3 class="mt-3 text-sm font-semibold text-ink">
          What should we build?
        </h3>
        <p class="mt-1 text-xs leading-5 text-slate-500">
          Ask for an app that uses contacts, conversations, or calendar data from your connected location.
        </p>
        <div class="mt-4 space-y-1.5">
          <button
            v-for="example in examples"
            :key="example"
            class="flex w-full items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-left text-[11px] text-slate-600 transition hover:border-emerald-200 hover:text-accent"
            @click="prompt = example"
          >
            {{ example }} <ArrowUp
              :size="12"
              class="rotate-45 text-slate-300"
            />
          </button>
        </div>
      </div>
      <article
        v-for="message in messages"
        :key="message.id"
        class="flex gap-2.5"
        :class="message.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <div
          class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-semibold"
          :class="message.role === 'assistant' ? 'bg-ink text-white' : 'bg-accent-soft text-accent'"
        >
          {{ message.role === "assistant" ? "G" : "You" }}
        </div>
        <div
          class="max-w-[88%] rounded-xl px-3 py-2.5 text-xs leading-5"
          :class="message.role === 'assistant' ? 'bg-paper text-slate-700' : 'bg-accent text-white'"
        >
          <p class="whitespace-pre-wrap">
            {{ message.content }}
          </p>
        </div>
      </article>
      <div
        v-if="generating"
        class="flex gap-2.5"
      >
        <div class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink text-white">
          <LoaderCircle
            :size="13"
            class="animate-spin"
          />
        </div>
        <div class="max-w-[88%] rounded-xl bg-paper px-3 py-2.5 text-xs leading-5 text-slate-600">
          <p class="font-medium text-ink">
            Generating your app…
          </p>
          <p class="mt-1 line-clamp-4 whitespace-pre-wrap font-mono text-[10px] text-slate-400">
            {{ streamText || "Planning files and connecting your project context." }}
          </p>
        </div>
      </div>
    </div>
    <form
      class="shrink-0 border-t border-line p-3"
      @submit.prevent="submit"
    >
      <Textarea
        v-model="prompt"
        :disabled="generating || disabled"
        :rows="3"
        class="min-h-[72px] resize-none border-0 bg-paper text-xs shadow-none focus:ring-2 focus:ring-accent/15"
        placeholder="Describe your HighLevel app…"
        @keydown.enter.exact.prevent="submit"
      />
      <div class="mt-2 flex items-center justify-between">
        <p class="text-[10px] text-slate-400">
          Enter to send · Shift + Enter for a new line
        </p>
        <Button
          v-if="generating"
          variant="destructive"
          size="sm"
          @click="emit('cancel')"
        >
          <Square
            :size="12"
            fill="currentColor"
          /> Stop
        </Button>
        <Button
          v-else
          size="sm"
          :disabled="!prompt.trim() || disabled"
        >
          <ArrowUp :size="14" /> Generate
        </Button>
      </div>
    </form>
  </section>
</template>
