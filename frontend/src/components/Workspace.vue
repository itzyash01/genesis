<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowLeft, Cloud, History, LoaderCircle, MoreHorizontal, ShieldCheck } from "@lucide/vue";
import type { ChatMessage, GenerationEvent, HighLevelReadKind, HighLevelWriteInput, Project, ProjectFile, Snapshot } from "../lib/api";
import { api, streamGeneration } from "../lib/api";
import ChatPanel from "./ChatPanel.vue";
import CodePanel from "./CodePanel.vue";
import PreviewPanel from "./PreviewPanel.vue";
import SnapshotDiff from "./SnapshotDiff.vue";
import Button from "./ui/Button.vue";
import Badge from "./ui/Badge.vue";
import Sheet from "./ui/Sheet.vue";
import Dialog from "./ui/Dialog.vue";

const props = defineProps<{ project: Project; initialFiles: ProjectFile[] }>();
const emit = defineEmits<{ back: []; updated: [project: Project] }>();

const files = ref<ProjectFile[]>([...props.initialFiles]);
const previewBeforeGeneration = ref<ProjectFile[]>([]);
const messages = ref<ChatMessage[]>([]);
const snapshots = ref<Snapshot[]>([]);
const selectedPath = ref(props.initialFiles.find((file) => file.path === "index.html")?.path ?? props.initialFiles[0]?.path ?? "");
const dirty = ref(false);
const busy = ref(false);
const generating = ref(false);
const historyOpen = ref(false);
const historyLoading = ref(false);
const diffOpen = ref(false);
const diffLoading = ref(false);
const diffSnapshot = ref<Snapshot | null>(null);
const diffResult = ref<Awaited<ReturnType<typeof api.getSnapshotDiff>> | null>(null);
const diffError = ref("");
const streamText = ref("");
const streamError = ref("");
const notice = ref("");
const refreshKey = ref(0);
const controller = ref<AbortController | null>(null);
const preview = ref<InstanceType<typeof PreviewPanel> | null>(null);
const initialSavedContent = ref(props.initialFiles.find((file) => file.path === selectedPath.value)?.content ?? "");
const confirmationOpen = ref(false);
const pendingCrmWrite = ref<{
  requestId: string;
  input: HighLevelWriteInput;
  title: string;
  details: string;
} | null>(null);
const crmWriteBusy = ref(false);
const crmContactLookupBusy = ref(false);
const VIRTUAL_PATH = "AI response stream";
let outputPartial = false;
let outputErrored = false;

const displayedFiles = computed<ProjectFile[]>(() =>
  generating.value
    ? [{ path: VIRTUAL_PATH, content: streamText.value }, ...files.value]
    : files.value,
);
const displayedPath = computed(() => generating.value ? VIRTUAL_PATH : selectedPath.value);
const displayedContent = computed(() => {
  if (generating.value && selectedPath.value === VIRTUAL_PATH) return streamText.value;
  return files.value.find((file) => file.path === selectedPath.value)?.content ?? "";
});
const currentFile = computed(() => files.value.find((file) => file.path === selectedPath.value));
const connectionLabel = computed(() => props.project.highLevelLocationId ? "Connected" : "Not connected");

watch(
  () => props.project.id,
  async () => {
    diffOpen.value = false;
    files.value = [...props.initialFiles];
    selectedPath.value = files.value.find((file) => file.path === "index.html")?.path ?? files.value[0]?.path ?? "";
    await loadMessages();
  },
);
watch(selectedPath, () => {
  const file = files.value.find((item) => item.path === selectedPath.value);
  initialSavedContent.value = file?.content ?? "";
  dirty.value = false;
});
watch(confirmationOpen, (isOpen) => {
  if (!isOpen && pendingCrmWrite.value && !crmWriteBusy.value) cancelCrmWrite();
});

onMounted(async () => {
  window.addEventListener("keydown", onEditorKey);
  await loadMessages();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onEditorKey));

async function loadMessages() {
  try {
    const result = await api.listMessages(props.project.id);
    messages.value = result.messages;
  } catch (cause) {
    streamError.value = cause instanceof Error ? cause.message : "Chat history could not be loaded.";
  }
}

async function appendMessage(role: ChatMessage["role"], content: string) {
  const result = await api.appendMessage(props.project.id, role, content);
  messages.value = [
    ...messages.value,
    { id: result.id, role, content, createdAt: new Date().toISOString() },
  ];
}

function handleEvent(event: GenerationEvent) {
  if (event.event === "token") {
    streamText.value += event.data.text;
    return;
  }
  if (event.event === "file_content") {
    const index = files.value.findIndex((file) => file.path === event.data.path);
    const file = { path: event.data.path, content: event.data.content };
    if (index < 0) files.value = [...files.value, file];
    else files.value[index] = file;
    return;
  }
  if (event.event === "error") {
    outputErrored = true;
    streamError.value = event.data.message;
  }
  if (event.event === "complete") {
    outputPartial = event.data.partial;
    if (event.data.partial && !outputErrored) {
      notice.value = "Partial output was saved. Open the latest files and snapshot to review it.";
    }
  }
}

async function sendPrompt(prompt: string) {
  if (generating.value || busy.value) return;
  if (dirty.value) {
    streamError.value = "Save the current file before generating changes.";
    return;
  }
  streamError.value = "";
  notice.value = "";
  streamText.value = "";
  outputPartial = false;
  outputErrored = false;
  busy.value = true;
  try {
    await appendMessage("user", prompt);
  } catch (cause) {
    streamError.value = cause instanceof Error ? cause.message : "Your message could not be saved.";
    busy.value = false;
    return;
  }
  busy.value = false;
  previewBeforeGeneration.value = files.value.map((file) => ({ ...file }));
  generating.value = true;
  selectedPath.value = VIRTUAL_PATH;
  const abortController = new AbortController();
  controller.value = abortController;
  let completed = false;
  try {
    await streamGeneration(props.project.id, prompt, abortController.signal, handleEvent);
    completed = true;
  } catch (cause) {
    streamError.value =
      cause instanceof Error ? cause.message : "Generation stopped unexpectedly.";
    if (abortController.signal.aborted) {
      streamError.value = "Generation stopped. Any complete files from the stream were saved.";
    }
  } finally {
    generating.value = false;
    controller.value = null;
    try {
      const refreshed = await api.getProject(props.project.id);
      files.value = refreshed.files;
      emit("updated", refreshed.project);
      refreshKey.value += 1;
      if (refreshed.files.some((file) => file.path === "index.html")) selectedPath.value = "index.html";
      else selectedPath.value = refreshed.files[0]?.path ?? "";
      const saved = completed && !outputErrored && !outputPartial
        ? "Generation complete. " + refreshed.files.length + " project files are ready."
        : streamError.value || "Generation finished with partial results.";
      await appendMessage("assistant", saved);
    } catch {
      if (completed) await appendMessage("assistant", "Generation complete. Refresh the workspace to load the saved files.");
    }
    await loadSnapshots();
  }
}

function cancelGeneration() {
  controller.value?.abort();
}

function selectFile(path: string) {
  if (generating.value) return;
  if (path === selectedPath.value) return;
  if (dirty.value) {
    if (!window.confirm("Discard unsaved changes to the current file?")) return;
    const index = files.value.findIndex((item) => item.path === selectedPath.value);
    if (index >= 0) files.value[index] = { ...files.value[index], content: initialSavedContent.value };
  }
  selectedPath.value = path;
  const file = files.value.find((item) => item.path === path);
  initialSavedContent.value = file?.content ?? "";
  dirty.value = false;
}

function editContent(content: string) {
  if (!selectedPath.value || selectedPath.value === VIRTUAL_PATH) return;
  const index = files.value.findIndex((file) => file.path === selectedPath.value);
  if (index < 0) return;
  files.value[index] = { ...files.value[index], content };
  dirty.value = content !== initialSavedContent.value;
}

async function saveCurrentFile() {
  if (!currentFile.value || !dirty.value || busy.value || generating.value) return;
  busy.value = true;
  streamError.value = "";
  try {
    await api.saveFile(props.project.id, selectedPath.value, currentFile.value.content);
    initialSavedContent.value = currentFile.value.content;
    dirty.value = false;
    notice.value = "Saved " + selectedPath.value + ".";
  } catch (cause) {
    streamError.value = cause instanceof Error ? cause.message : "Could not save this file.";
  } finally {
    busy.value = false;
  }
}

async function createFile(path: string) {
  if (dirty.value) {
    streamError.value = "Save the current file before creating another file.";
    return;
  }
  const validPath = path.trim().replace(/^\/+/, "");
  if (!validPath || files.value.some((file) => file.path === validPath)) {
    streamError.value = "Choose a new file path.";
    return;
  }
  busy.value = true;
  streamError.value = "";
  try {
    await api.saveFile(props.project.id, validPath, "");
    files.value = [...files.value, { path: validPath, content: "" }];
    selectFile(validPath);
    notice.value = "Created " + validPath + ".";
  } catch (cause) {
    streamError.value = cause instanceof Error ? cause.message : "Could not create the file.";
  } finally {
    busy.value = false;
  }
}

async function openHistory() {
  historyOpen.value = true;
  await loadSnapshots();
}

async function loadSnapshots() {
  historyLoading.value = true;
  try {
    const result = await api.listSnapshots(props.project.id);
    snapshots.value = result.snapshots;
  } catch (cause) {
    streamError.value = cause instanceof Error ? cause.message : "Snapshot history could not be loaded.";
  } finally {
    historyLoading.value = false;
  }
}

async function openDiff(snapshot: Snapshot) {
  if (diffLoading.value) return;
  historyOpen.value = false;
  await nextTick();
  diffSnapshot.value = snapshot;
  diffResult.value = null;
  diffError.value = "";
  diffOpen.value = true;
  diffLoading.value = true;
  try {
    diffResult.value = await api.getSnapshotDiff(props.project.id, snapshot.id);
  } catch (cause) {
    diffError.value = cause instanceof Error ? cause.message : "Changes could not be loaded.";
  } finally {
    diffLoading.value = false;
  }
}

async function restore(snapshot: Snapshot) {
  if (dirty.value) {
    streamError.value = "Save the current file before restoring a snapshot.";
    return;
  }
  const confirmed = window.confirm("Restore version " + snapshot.version + "? Current project files will be replaced.");
  if (!confirmed) return;
  historyLoading.value = true;
  streamError.value = "";
  try {
    await api.restoreSnapshot(props.project.id, snapshot.id);
    const result = await api.getProject(props.project.id);
    files.value = result.files;
    selectedPath.value = result.files.find((file) => file.path === "index.html")?.path ?? result.files[0]?.path ?? "";
    emit("updated", result.project);
    refreshKey.value += 1;
    historyOpen.value = false;
    notice.value = "Restored project version " + snapshot.version + ".";
  } catch (cause) {
    streamError.value = cause instanceof Error ? cause.message : "The snapshot could not be restored.";
  } finally {
    historyLoading.value = false;
  }
}

function goBack() {
  if (dirty.value && !window.confirm("Discard unsaved changes to the current file?")) return;
  emit("back");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickStringFields(value: unknown, fields: string[]): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const picked: Record<string, string> = {};
  for (const field of fields) {
    const candidate = value[field];
    if (typeof candidate === "string" && candidate.trim()) picked[field] = candidate;
  }
  return picked;
}

function cancelCrmWrite() {
  const pending = pendingCrmWrite.value;
  if (!pending) return;
  pendingCrmWrite.value = null;
  confirmationOpen.value = false;
  preview.value?.respond(pending.requestId, undefined, "Action cancelled by the user.");
}

async function confirmCrmWrite() {
  const pending = pendingCrmWrite.value;
  if (!pending || crmWriteBusy.value || crmContactLookupBusy.value) return;
  crmWriteBusy.value = true;
  streamError.value = "";
  notice.value = "";
  try {
    const result = await api.highLevelWrite(props.project.id, pending.input);
    preview.value?.respond(pending.requestId, result);
    notice.value = pending.input.action === "sendMessage"
      ? "Message submitted. Check the conversation for delivery status."
      : pending.title + " completed.";
    pendingCrmWrite.value = null;
    confirmationOpen.value = false;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The CRM action could not be completed.";
    streamError.value = message;
    preview.value?.respond(pending.requestId, undefined, message);
    pendingCrmWrite.value = null;
    confirmationOpen.value = false;
  } finally {
    crmWriteBusy.value = false;
  }
}

async function previewDataRequest(request: { id: string; action: string; params: Record<string, unknown> }) {
  if (["createContact", "updateContact", "createAppointment", "sendMessage"].includes(request.action)) {
    await queueCrmWrite(request);
    return;
  }
  try {
    const kind = request.action as HighLevelReadKind;
    const result = await api.getHighLevelData(props.project.id, kind, {
      query: typeof request.params.query === "string" ? request.params.query.slice(0, 100) : undefined,
      conversationId:
        typeof request.params.conversationId === "string"
          ? request.params.conversationId.slice(0, 128)
          : undefined,
      contactId: typeof request.params.contactId === "string" ? request.params.contactId.slice(0, 128) : undefined,
      calendarId: typeof request.params.calendarId === "string" ? request.params.calendarId.slice(0, 128) : undefined,
      startDate: typeof request.params.startDate === "number" ? request.params.startDate : undefined,
      endDate: typeof request.params.endDate === "number" ? request.params.endDate : undefined,
      timezone: typeof request.params.timezone === "string" ? request.params.timezone.slice(0, 64) : undefined,
    });
    preview.value?.respond(request.id, result);
  } catch (cause) {
    preview.value?.respond(
      request.id,
      undefined,
      cause instanceof Error ? cause.message : "CRM data could not be loaded.",
    );
  }
}

async function queueCrmWrite(request: { id: string; action: string; params: Record<string, unknown> }) {
  if (pendingCrmWrite.value || crmContactLookupBusy.value || crmWriteBusy.value) {
    preview.value?.respond(request.id, undefined, "Finish or cancel the open CRM confirmation first.");
    return;
  }
  const contactFields = [
    "firstName", "lastName", "name", "email", "phone", "companyName", "address1",
    "city", "state", "postalCode", "website", "timezone",
  ];
  let input: HighLevelWriteInput | null = null;
  let title = "Review CRM change";

  if (request.action === "createContact") {
    const contact = pickStringFields(request.params.contact, contactFields);
    if (contact && (contact.email || contact.phone)) {
      input = { action: "createContact", contact };
      title = "Create a contact";
    }
  } else if (request.action === "updateContact") {
    const contactId = request.params.contactId;
    const changes = pickStringFields(request.params.changes, contactFields);
    if (typeof contactId === "string" && changes && Object.keys(changes).length) {
      input = { action: "updateContact", contactId, changes };
      title = "Update a contact";
    }
  } else if (request.action === "createAppointment") {
    const values = pickStringFields(request.params, ["contactId", "calendarId", "title", "startTime", "endTime"]);
    if (values?.contactId && values.calendarId && values.title && values.startTime) {
      input = { action: "createAppointment", contactId: values.contactId, calendarId: values.calendarId,
        title: values.title, startTime: values.startTime, ...(values.endTime ? { endTime: values.endTime } : {}) };
      title = "Create an appointment";
    }
  } else if (request.action === "sendMessage") {
    const contactId = request.params.contactId;
    const type = request.params.type;
    const message = request.params.message;
    const subject = request.params.subject;
    if (
      typeof contactId === "string" &&
      (type === "SMS" || type === "Email") &&
      typeof message === "string" &&
      message.trim() &&
      (subject === undefined || typeof subject === "string") &&
      (type !== "Email" || (typeof subject === "string" && subject.trim()))
    ) {
      input = {
        action: "sendMessage",
        contactId,
        type,
        message,
        ...(typeof subject === "string" ? { subject } : {}),
      };
      title = type === "Email" ? "Send an email" : "Send a text message";
    }
  }

  if (!input) {
    preview.value?.respond(request.id, undefined, "The requested CRM action has invalid fields.");
    return;
  }
  pendingCrmWrite.value = {
    requestId: request.id,
    input,
    title,
    details: JSON.stringify(input, null, 2),
  };
  confirmationOpen.value = true;

  if (input.action !== "createContact") {
    crmContactLookupBusy.value = true;
    try {
      const raw = await api.getHighLevelData(props.project.id, "contact", { contactId: input.contactId });
      if (pendingCrmWrite.value?.requestId !== request.id) return;
      const response = isRecord(raw) && isRecord(raw.contact) ? raw.contact : null;
      if (!response) throw new Error("The contact could not be verified in the connected account.");
      const recipient = {
        name: typeof response.name === "string"
          ? response.name
          : [response.firstName, response.lastName].filter((part) => typeof part === "string").join(" "),
        email: typeof response.email === "string" ? response.email : undefined,
        phone: typeof response.phone === "string" ? response.phone : undefined,
      };
      const review = input.action === "updateContact"
        ? { action: input.action, contact: recipient, changes: input.changes }
        : input.action === "createAppointment"
          ? { ...input, contact: recipient }
          : {
            action: input.action,
            recipient,
            type: input.type,
            ...(input.subject ? { subject: input.subject } : {}),
            message: input.message,
          };
      pendingCrmWrite.value.details = JSON.stringify(review, null, 2);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The contact could not be verified.";
      if (pendingCrmWrite.value?.requestId === request.id) {
        pendingCrmWrite.value = null;
        confirmationOpen.value = false;
        streamError.value = message;
        preview.value?.respond(request.id, undefined, message);
      }
    } finally {
      crmContactLookupBusy.value = false;
    }
  }
}

function onEditorKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveCurrentFile();
  }
}

</script>

<template>
  <main class="flex h-screen min-h-[620px] flex-col overflow-hidden bg-paper">
    <header class="z-10 flex h-[58px] shrink-0 items-center justify-between border-b border-line bg-white px-4 sm:px-6">
      <div class="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to projects"
          @click="goBack"
        >
          <ArrowLeft :size="17" />
        </Button>
        <span class="hidden h-6 w-px bg-line sm:block" />
        <img
          src="/genesis-mark.svg"
          alt=""
          class="h-8 w-8 shrink-0 rounded-lg"
        >
        <div class="min-w-0">
          <h1 class="truncate text-xs font-semibold text-ink">
            {{ project.name }}
          </h1>
          <p class="mt-0.5 truncate text-[10px] text-slate-400">
            Genesis workspace
          </p>
        </div>
        <Badge
          class="ml-1 hidden sm:inline-flex"
          tone="green"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {{ connectionLabel }}
        </Badge>
      </div>
      <div class="flex items-center gap-2">
        <a href="/help.html" target="_blank" rel="noopener noreferrer" class="text-xs font-medium text-accent hover:underline">Help</a>
        <span class="hidden items-center gap-1.5 text-[10px] text-slate-400 md:flex"><ShieldCheck
          :size="13"
          class="text-emerald-600"
        /> Preview is sandboxed</span>
        <Button
          variant="outline"
          size="sm"
          class="hidden sm:inline-flex"
          @click="openHistory"
        >
          <History :size="14" /> History
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Workspace options"
          class="sm:hidden"
          @click="openHistory"
        >
          <MoreHorizontal :size="16" />
        </Button>
      </div>
    </header>
    <div
      v-if="streamError"
      role="alert"
      class="flex shrink-0 items-center justify-between border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 sm:px-6"
    >
      <span>{{ streamError }}</span>
      <button
        class="ml-3 text-rose-500 hover:text-rose-800"
        aria-label="Dismiss error"
        @click="streamError = ''"
      >
        ×
      </button>
    </div>
    <div
      v-if="notice"
      role="status"
      class="flex shrink-0 items-center justify-between border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 sm:px-6"
    >
      <span>{{ notice }}</span>
      <button
        class="ml-3 text-emerald-500 hover:text-emerald-800"
        aria-label="Dismiss notice"
        @click="notice = ''"
      >
        ×
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto lg:overflow-hidden">
      <div class="grid min-h-full lg:h-full lg:grid-cols-[minmax(280px,0.82fr)_minmax(380px,1.18fr)_minmax(360px,1fr)]">
        <ChatPanel
          :messages="messages"
          :generating="generating"
          :stream-text="streamText"
          :disabled="busy"
          :unsaved-changes="dirty"
          @send="sendPrompt"
          @cancel="cancelGeneration"
          @snapshots="openHistory"
        />
        <CodePanel
          :files="displayedFiles"
          :selected-path="displayedPath"
          :content="displayedContent"
          :streaming="generating"
          :dirty="dirty"
          :version="project.version"
          @select="selectFile"
          @change="editContent"
          @save="saveCurrentFile"
          @create="createFile"
          @snapshots="openHistory"
        />
        <PreviewPanel
          ref="preview"
          :files="generating ? previewBeforeGeneration : files"
          :project-name="project.name"
          :refresh-key="refreshKey"
          @data-request="previewDataRequest"
        />
      </div>
    </div>
    <footer class="flex h-8 shrink-0 items-center justify-between border-t border-line bg-white px-4 text-[9px] text-slate-400 sm:px-6">
      <span class="flex items-center gap-1.5"><Cloud :size="11" /> Project files are stored securely</span>
      <span>{{ generating ? "Generation is streaming" : busy ? "Saving changes…" : "Ready" }} <LoaderCircle
        v-if="generating || busy"
        :size="10"
        class="ml-1 inline animate-spin text-accent"
      /></span>
      <span class="hidden sm:inline">CRM account · {{ connectionLabel }}</span>
    </footer>
    <Sheet
      v-model:open="historyOpen"
      title="Snapshot history"
      description="Each successful generation saves a restorable copy of every project file."
    >
      <div
        v-if="historyLoading"
        class="flex items-center gap-2 py-8 text-xs text-slate-500"
      >
        <LoaderCircle
          :size="15"
          class="animate-spin"
        /> Loading snapshots…
      </div>
      <div
        v-else-if="snapshots.length === 0"
        class="rounded-xl border border-dashed border-line px-5 py-10 text-center"
      >
        <History
          :size="22"
          class="mx-auto text-slate-300"
        />
        <p class="mt-3 text-xs font-medium text-slate-600">
          No snapshots yet
        </p>
        <p class="mt-1 text-[10px] text-slate-400">
          Snapshots are created after generation.
        </p>
      </div>
      <div
        v-else
        class="space-y-3"
      >
        <article
          v-for="snapshot in snapshots"
          :key="snapshot.id"
          class="rounded-xl border border-line p-4"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-semibold text-ink">
                Version {{ snapshot.version }}
              </p>
              <p class="mt-1 text-[10px] text-slate-400">
                {{ snapshot.createdAt ? new Date(snapshot.createdAt).toLocaleString() : "Recent" }} · {{ snapshot.fileCount }} files
              </p>
            </div>
            <div class="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                :disabled="historyLoading || diffLoading"
                @click="openDiff(snapshot)"
              >
                View changes
              </Button>
              <Button
                size="sm"
                variant="outline"
                :disabled="historyLoading"
                @click="restore(snapshot)"
              >
                <LoaderCircle
                  v-if="historyLoading"
                  :size="12"
                  class="animate-spin"
                /> Restore
              </Button>
            </div>
          </div>
          <p class="mt-3 line-clamp-3 border-t border-line pt-3 text-[11px] leading-5 text-slate-500">
            {{ snapshot.prompt }}
          </p>
        </article>
      </div>
    </Sheet>
    <SnapshotDiff
      v-model:open="diffOpen"
      :snapshot="diffSnapshot"
      :loading="diffLoading"
      :result="diffResult"
      :error="diffError"
    />
    <Dialog
      v-model:open="confirmationOpen"
      :title="pendingCrmWrite?.title ?? 'Confirm CRM action'"
      description="Review this operation before it changes the connected account. The preview cannot apply it until you confirm here."
    >
      <div class="space-y-4">
        <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          <template v-if="pendingCrmWrite?.input.action === 'sendMessage'">
            This message will be sent to the selected contact after confirmation.
          </template>
          <template v-else-if="pendingCrmWrite?.input.action === 'createAppointment'">
            This appointment will be created after confirmation.
          </template>
          <template v-else>
            This contact record will be changed after confirmation.
          </template>
        </div>
        <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-paper p-3 font-mono text-[11px] leading-5 text-slate-700">{{ pendingCrmWrite?.details }}</pre>
        <div class="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            :disabled="crmWriteBusy"
            @click="cancelCrmWrite"
          >
            Cancel
          </Button>
          <Button
            :disabled="crmWriteBusy || crmContactLookupBusy"
            @click="confirmCrmWrite"
          >
            <LoaderCircle
              v-if="crmWriteBusy || crmContactLookupBusy"
              :size="13"
              class="animate-spin"
            />
            {{ crmContactLookupBusy ? 'Verifying contact…' : crmWriteBusy ? 'Working…' : pendingCrmWrite?.input.action === 'sendMessage' ? 'Confirm and send' : 'Confirm change' }}
          </Button>
        </div>
      </div>
    </Dialog>
  </main>
</template>
