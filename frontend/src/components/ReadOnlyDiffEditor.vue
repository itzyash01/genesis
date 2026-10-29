<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "../lib/monaco";

const props = defineProps<{ before: string; after: string; language: string }>();
const container = ref<HTMLDivElement | null>(null);
let editor: monaco.editor.IStandaloneDiffEditor | undefined;
let original: monaco.editor.ITextModel | undefined;
let modified: monaco.editor.ITextModel | undefined;

onMounted(() => {
  if (!container.value) return;
  original = monaco.editor.createModel(props.before, props.language);
  modified = monaco.editor.createModel(props.after, props.language);
  editor = monaco.editor.createDiffEditor(container.value, {
    readOnly: true,
    originalEditable: false,
    automaticLayout: true,
    renderSideBySide: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "on",
  });
  editor.setModel({ original, modified });
});

watch(() => [props.before, props.after, props.language] as const, ([before, after, language]) => {
  if (!original || !modified) return;
  original.setValue(before);
  modified.setValue(after);
  monaco.editor.setModelLanguage(original, language);
  monaco.editor.setModelLanguage(modified, language);
});

onBeforeUnmount(() => {
  // Detach the diff widget before disposing its models.
  editor?.setModel(null);
  editor?.dispose();
  original?.dispose();
  modified?.dispose();
});
</script>

<template>
  <div
    ref="container"
    class="min-h-0 flex-1"
    aria-label="Read-only file comparison"
  />
</template>
