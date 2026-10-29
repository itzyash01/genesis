<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ReadOnlyDiffEditor from "./ReadOnlyDiffEditor.vue";
import type { Snapshot, SnapshotChange } from "../lib/api";
import Dialog from "./ui/Dialog.vue";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  snapshot: Snapshot | null;
  result: { available: boolean; changes: SnapshotChange[] } | null;
  error: string;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const selectedPath = ref("");
watch(() => props.result, (result) => { selectedPath.value = result?.changes[0]?.path ?? ""; }, { immediate: true });
const selected = computed(() => props.result?.changes.find((change) => change.path === selectedPath.value));
const language = computed(() => {
  const ext = selectedPath.value.split(".").pop()?.toLowerCase();
  return ({ html: "html", css: "css", js: "javascript", json: "json", md: "markdown" } as Record<string, string>)[ext ?? ""] ?? "plaintext";
});
</script>

<template>
  <Dialog
    :open="open"
    :title="snapshot ? `Changes in version ${snapshot.version}` : 'Generation changes'"
    description="Compare the files before this generation with the files it saved."
    wide
    @update:open="emit('update:open', $event)"
  >
    <p
      v-if="loading"
      role="status"
      class="py-10 text-sm text-slate-500"
    >
      Loading changes…
    </p>
    <p
      v-else-if="error"
      role="alert"
      class="py-10 text-sm text-rose-600"
    >
      {{ error }}
    </p>
    <p
      v-else-if="result && !result.available"
      class="py-10 text-sm text-slate-600"
    >
      An exact comparison is unavailable for this older or restored snapshot. New generations save their original files for comparison.
    </p>
    <p
      v-else-if="result && result.changes.length === 0"
      class="py-10 text-sm text-slate-600"
    >
      This generation did not change any files.
    </p>
    <div
      v-else-if="result"
      class="flex h-[min(60vh,540px)] min-h-[300px] flex-col gap-3 md:flex-row"
    >
      <nav
        aria-label="Changed files"
        class="max-h-32 shrink-0 overflow-auto border-b border-line md:max-h-none md:w-52 md:border-b-0 md:border-r"
      >
        <button
          v-for="change in result.changes"
          :key="change.path"
          type="button"
          class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
          :class="selectedPath === change.path ? 'bg-accent-soft font-semibold text-accent' : 'text-slate-600 hover:bg-paper'"
          :aria-pressed="selectedPath === change.path"
          @click="selectedPath = change.path"
        >
          <span class="break-all">{{ change.path }}</span><span class="shrink-0 capitalize">{{ change.status }}</span>
        </button>
      </nav>
      <div
        v-if="selected"
        class="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <p class="mb-2 text-xs text-slate-500">
          Before generation <span class="mx-2">/</span> After generation
        </p>
        <ReadOnlyDiffEditor
          :key="selected.path"
          :before="selected.before"
          :after="selected.after"
          :language="language"
        />
      </div>
    </div>
  </Dialog>
</template>
