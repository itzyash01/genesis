<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { Blocks, LoaderCircle, TriangleAlert } from "@lucide/vue";
import { api, type ConnectionStatus, type Project, type ProjectFile } from "./lib/api";
import { auth } from "./lib/firebase";
import AuthView from "./components/AuthView.vue";
import ProjectList from "./components/ProjectList.vue";
import Button from "./components/ui/Button.vue";

const Workspace = defineAsyncComponent(() => import("./components/Workspace.vue"));

const user = ref<User | null>(null);
const authReady = ref(false);
const projects = ref<Project[]>([]);
const connection = ref<ConnectionStatus>({ connected: false });
const loadingProjects = ref(false);
const creatingProject = ref(false);
const globalError = ref("");
const workspaceProject = ref<Project | null>(null);
const workspaceFiles = ref<ProjectFile[]>([]);
const launchError = ref("");
const globalNotice = ref("");
let stopAuthListener: (() => void) | undefined;

onMounted(() => {
  const url = new URL(window.location.href);
  const highLevelStatus = url.searchParams.get("highlevel");
  if (highLevelStatus === "connected") {
    globalNotice.value = "HighLevel connected. Create a project to start building.";
    url.searchParams.delete("highlevel");
    window.history.replaceState({}, "", url.toString());
  } else if (highLevelStatus === "error") {
    globalError.value = "HighLevel connection was not completed. Check OAuth setup and try again.";
    url.searchParams.delete("highlevel");
    window.history.replaceState({}, "", url.toString());
  }
  stopAuthListener = onAuthStateChanged(auth, async (currentUser) => {
    user.value = currentUser;
    authReady.value = true;
    workspaceProject.value = null;
    if (currentUser) await loadProjects();
    else {
      projects.value = [];
      connection.value = { connected: false };
    }
  });
});
onBeforeUnmount(() => stopAuthListener?.());

async function loadProjects() {
  if (!user.value) return;
  loadingProjects.value = true;
  globalError.value = "";
  try {
    const result = await api.listProjects();
    projects.value = result.projects;
    connection.value = result.connection;
  } catch (cause) {
    globalError.value = cause instanceof Error ? cause.message : "Your projects could not be loaded.";
  } finally {
    loadingProjects.value = false;
  }
}

async function createProject(name: string, description: string) {
  creatingProject.value = true;
  globalError.value = "";
  try {
    const result = await api.createProject(name, description);
    projects.value = [result.project, ...projects.value];
    const loaded = await api.getProject(result.project.id);
    workspaceProject.value = loaded.project;
    workspaceFiles.value = loaded.files;
  } catch (cause) {
    globalError.value = cause instanceof Error ? cause.message : "Project could not be created.";
  } finally {
    creatingProject.value = false;
  }
}

async function openProject(project: Project) {
  launchError.value = "";
  globalError.value = "";
  try {
    const result = await api.getProject(project.id);
    workspaceProject.value = result.project;
    workspaceFiles.value = result.files;
  } catch (cause) {
    launchError.value = cause instanceof Error ? cause.message : "Project could not be opened.";
  }
}

async function connectHighLevel() {
  globalError.value = "";
  try {
    const result = await api.startHighLevelOAuth();
    window.location.assign(result.authorizationUrl);
  } catch (cause) {
    globalError.value = cause instanceof Error ? cause.message : "HighLevel connection could not start.";
  }
}

async function disconnectHighLevel() {
  const confirmed = window.confirm("Disconnect HighLevel? Existing project files stay saved, but CRM data will no longer load.");
  if (!confirmed) return;
  globalError.value = "";
  try {
    await api.disconnectHighLevel();
    connection.value = { connected: false };
    globalNotice.value = "HighLevel was disconnected.";
  } catch (cause) {
    globalError.value = cause instanceof Error ? cause.message : "HighLevel could not be disconnected.";
  }
}

async function deleteProject(project: Project) {
  const confirmed = window.confirm("Delete “" + project.name + "”? The project will be hidden from your workspace.");
  if (!confirmed) return;
  globalError.value = "";
  try {
    await api.softDeleteProject(project.id);
    projects.value = projects.value.filter((item) => item.id !== project.id);
  } catch (cause) {
    globalError.value = cause instanceof Error ? cause.message : "Project could not be deleted.";
  }
}

async function signOutUser() {
  await signOut(auth);
}

function updateProject(project: Project) {
  workspaceProject.value = project;
  projects.value = projects.value.map((item) => item.id === project.id ? project : item);
}
</script>

<template>
  <div>
    <div
      v-if="!authReady"
      class="grid min-h-screen place-items-center bg-paper"
    >
      <div class="flex items-center gap-2 text-sm text-slate-500">
        <LoaderCircle
          :size="17"
          class="animate-spin text-accent"
        /> Loading Genesis…
      </div>
    </div>
    <AuthView v-else-if="!user" />
    <Suspense v-else-if="workspaceProject">
      <Workspace
        :project="workspaceProject"
        :initial-files="workspaceFiles"
        @back="workspaceProject = null; void loadProjects()"
        @updated="updateProject"
      />
      <template #fallback>
        <div class="grid min-h-screen place-items-center bg-paper">
          <div class="flex items-center gap-2 text-sm text-slate-500">
            <LoaderCircle
              :size="17"
              class="animate-spin text-accent"
            /> Loading workspace…
          </div>
        </div>
      </template>
    </Suspense>
    <ProjectList
      v-else-if="user"
      :projects="projects"
      :connection="connection"
      :loading="loadingProjects"
      :creating="creatingProject"
      :user-email="user.email"
      @connect="connectHighLevel"
      @disconnect="disconnectHighLevel"
      @create="createProject"
      @open="openProject"
      @remove="deleteProject"
      @signout="signOutUser"
    />
    <div
      v-if="globalError || launchError"
      class="fixed bottom-5 left-1/2 z-[100] flex w-[min(92vw,520px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-rose-200 bg-white p-4 text-xs text-rose-700 shadow-xl"
      role="alert"
    >
      <TriangleAlert
        :size="16"
        class="mt-0.5 shrink-0"
      />
      <div class="min-w-0 flex-1">
        {{ globalError || launchError }}
      </div>
      <Button
        variant="ghost"
        size="sm"
        @click="globalError = ''; launchError = ''"
      >
        Dismiss
      </Button>
    </div>
    <div
      v-if="globalNotice && !globalError"
      class="fixed bottom-5 left-1/2 z-[100] flex w-[min(92vw,520px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-xs text-emerald-700 shadow-xl"
      role="status"
    >
      <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50"><Blocks :size="14" /></span>
      <div class="min-w-0 flex-1">
        {{ globalNotice }}
      </div>
      <Button
        variant="ghost"
        size="sm"
        @click="globalNotice = ''"
      >
        Dismiss
      </Button>
    </div>
  </div>
</template>
