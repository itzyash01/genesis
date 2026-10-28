<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { VueMonacoEditor } from "@guolao/vue-monaco-editor";
import "../lib/monaco";
import { ChevronDown, FileCode2, FileJson2, FilePlus2, FileText, History, Save } from "@lucide/vue";
import type { ProjectFile } from "../lib/api";
import Button from "./ui/Button.vue";
import Dialog from "./ui/Dialog.vue";
import Input from "./ui/Input.vue";
import TabsRoot from "./ui/tabs/TabsRoot.vue";
import TabsList from "./ui/tabs/TabsList.vue";
import TabsTrigger from "./ui/tabs/TabsTrigger.vue";
import TabsContent from "./ui/tabs/TabsContent.vue";

const props = defineProps<{
  files: ProjectFile[];
  selectedPath: string;
  content: string;
  streaming: boolean;
  dirty: boolean;
  version: number;
}>();
const emit = defineEmits<{
  select: [path: string];
  change: [content: string];
  save: [];
  create: [path: string];
  snapshots: [];
}>();
const fileDialogOpen = ref(false);
const newPath = ref("");

const editorOptions = computed(() => ({
  automaticLayout: true,
  minimap: { enabled: false },
  readOnly: props.streaming,
  fontSize: 12,
  lineNumbers: "on" as const,
  wordWrap: "on" as const,
  scrollBeyondLastLine: false,
  renderLineHighlight: "gutter" as const,
  padding: { top: 16, bottom: 16 },
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
}));
const language = computed(() => {
  const extension = props.selectedPath.split(".").pop()?.toLowerCase();
  if (extension === "html") return "html";
  if (extension === "css") return "css";
  if (extension === "json") return "json";
  if (extension === "md") return "markdown";
  if (extension === "js") return "javascript";
  return "plaintext";
});
const orderedFiles = computed(() => [...props.files].sort((a, b) => a.path.localeCompare(b.path)));

watch(fileDialogOpen, (open) => {
  if (!open) newPath.value = "";
});

function addFile() {
  const path = newPath.value.trim().replace(/^\/+/, "");
  if (!path) return;
  emit("create", path);
  fileDialogOpen.value = false;
}
</script>

<template>
  <section class="flex min-h-[520px] flex-col bg-[#fbfcfb] lg:min-h-0">
    <header class="flex h-[58px] shrink-0 items-center justify-between border-b border-line bg-white px-4">
      <div class="flex items-center gap-2">
        <h2 class="text-xs font-semibold text-ink">
          Code
        </h2>
        <span class="rounded bg-paper px-1.5 py-0.5 text-[10px] font-medium text-slate-400">v{{ version }}</span>
      </div>
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          title="Version history"
          aria-label="Version history"
          @click="emit('snapshots')"
        >
          <History :size="15" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="New file"
          aria-label="New file"
          :disabled="streaming"
          @click="fileDialogOpen = true"
        >
          <FilePlus2 :size="15" />
        </Button>
        <Button
          size="sm"
          :disabled="streaming || !dirty || !selectedPath"
          @click="emit('save')"
        >
          <Save :size="13" /> {{ dirty ? "Save" : "Saved" }}
        </Button>
      </div>
    </header>
    <TabsRoot
      :model-value="selectedPath"
      class="flex min-h-0 flex-1 flex-col"
      @update:model-value="emit('select', $event)"
    >
      <div class="flex min-h-0 flex-1">
        <aside class="hidden w-[170px] shrink-0 border-r border-line bg-white md:block">
          <div class="flex h-10 items-center justify-between px-3 text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-400">
            Explorer <ChevronDown :size="12" />
          </div>
          <div
            v-if="!orderedFiles.length"
            class="px-3 py-4 text-[10px] text-slate-400"
          >
            Files appear here after generation.
          </div>
          <button
            v-for="file in orderedFiles"
            :key="file.path"
            class="flex w-full items-center gap-2 overflow-hidden px-3 py-2 text-left text-[11px] transition"
            :class="selectedPath === file.path ? 'bg-accent-soft/70 font-medium text-accent' : 'text-slate-500 hover:bg-paper'"
            @click="emit('select', file.path)"
          >
            <FileCode2
              v-if="file.path.endsWith('.html') || file.path.endsWith('.js') || file.path.endsWith('.css')"
              :size="13"
              class="shrink-0"
            />
            <FileJson2
              v-else-if="file.path.endsWith('.json')"
              :size="13"
              class="shrink-0"
            />
            <FileText
              v-else
              :size="13"
              class="shrink-0"
            />
            <span class="truncate">{{ file.path }}</span>
          </button>
        </aside>
        <div class="flex min-w-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger
              v-for="file in orderedFiles"
              :key="file.path"
              :value="file.path"
            >
              <FileCode2 :size="12" /> {{ file.path.split("/").pop() }}
              <span
                v-if="dirty && selectedPath === file.path"
                class="h-1.5 w-1.5 rounded-full bg-amber-500"
              />
            </TabsTrigger>
            <span
              v-if="streaming"
              class="ml-auto mr-3 shrink-0 self-center text-[10px] text-accent"
            >Streaming response</span>
            <span
              v-else-if="dirty"
              class="ml-auto mr-3 shrink-0 self-center text-[10px] text-amber-600"
            >Unsaved edits</span>
          </TabsList>
          <TabsContent
            v-for="file in orderedFiles"
            :key="file.path"
            :value="file.path"
          >
            <VueMonacoEditor
              v-if="selectedPath === file.path"
              :value="content"
              :language="language"
              theme="vs"
              :options="editorOptions"
              height="100%"
              @change="emit('change', $event || '')"
            />
          </TabsContent>
          <div
            v-if="!selectedPath"
            class="grid min-h-[340px] flex-1 place-items-center p-8 text-center"
          >
            <div>
              <span class="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-paper text-slate-400"><FileCode2 :size="18" /></span>
              <p class="mt-3 text-xs font-medium text-slate-500">
                Choose a file or ask Genesis to build your app.
              </p>
              <p class="mt-1 text-[10px] text-slate-400">
                Files are saved to your project workspace.
              </p>
            </div>
          </div>
        </div>
      </div>
    </TabsRoot>
    <Dialog
      v-model:open="fileDialogOpen"
      title="Create a file"
      description="Add a project file with a supported extension: html, css, js, json, md, svg, or txt."
    >
      <form
        class="space-y-4"
        @submit.prevent="addFile"
      >
        <Input
          v-model="newPath"
          placeholder="src/main.js"
          maxlength="180"
          autofocus
        />
        <div class="flex justify-end gap-2">
          <Button
            variant="outline"
            @click="fileDialogOpen = false"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            :disabled="!newPath.trim()"
          >
            Create file
          </Button>
        </div>
      </form>
    </Dialog>
  </section>
</template>
