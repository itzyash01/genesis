<script setup lang="ts">
import { computed, ref } from "vue";
import { Blocks, CalendarClock, ChevronRight, CircleUserRound, Code2, Link2, LoaderCircle, LogOut, Plus, Search, Trash2, Users } from "@lucide/vue";
import type { ConnectionStatus, Project } from "../lib/api";
import Button from "./ui/Button.vue";
import Input from "./ui/Input.vue";
import Textarea from "./ui/Textarea.vue";
import Badge from "./ui/Badge.vue";
import Dialog from "./ui/Dialog.vue";

const props = defineProps<{
  projects: Project[];
  connection: ConnectionStatus;
  loading?: boolean;
  creating?: boolean;
  userEmail?: string | null;
}>();
const emit = defineEmits<{
  connect: [];
  disconnect: [];
  create: [name: string, description: string];
  open: [project: Project];
  remove: [project: Project];
  signout: [];
}>();

const dialogOpen = ref(false);
const name = ref("");
const description = ref("");
const search = ref("");
const filteredProjects = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return props.projects;
  return props.projects.filter((project) =>
    (project.name + " " + project.description).toLowerCase().includes(query),
  );
});

function submitProject() {
  if (!name.value.trim()) return;
  emit("create", name.value.trim(), description.value.trim());
}
</script>

<template>
  <div class="min-h-screen bg-paper">
    <header class="sticky top-0 z-20 border-b border-line/80 bg-paper/90 backdrop-blur">
      <div class="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8">
        <a
          class="flex items-center gap-2.5 font-semibold tracking-tight text-ink"
          href="#"
        >
          <img
            src="/genesis-mark.svg"
            alt=""
            class="h-9 w-9 shrink-0 rounded-xl"
          />
          genesis <span class="ml-1 rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">studio</span>
        </a>
        <div class="flex items-center gap-3">
          <div class="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <CircleUserRound :size="16" /> {{ userEmail }}
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Sign out"
            @click="emit('signout')"
          >
            <LogOut :size="15" /><span class="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 sm:py-12">
      <section class="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Your workspace
          </p>
          <h1 class="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
            Apps that work for you.
          </h1>
          <p class="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Start with a prompt, connect HighLevel data, and shape the result in your own code workspace.
          </p>
        </div>
        <div class="flex gap-2">
          <Dialog
            v-model:open="dialogOpen"
            title="Create a project"
            description="Give your new app a name and a little context to help the AI get started."
          >
            <template #trigger>
              <Button :disabled="!connection.connected">
                <Plus :size="16" /> New project
              </Button>
            </template>
            <form
              class="space-y-4"
              @submit.prevent="submitProject"
            >
              <label class="block space-y-1.5">
                <span class="text-xs font-medium text-slate-600">Project name</span>
                <Input
                  v-model="name"
                  placeholder="Contact dashboard"
                  maxlength="80"
                  autofocus
                />
              </label>
              <label class="block space-y-1.5">
                <span class="text-xs font-medium text-slate-600">Description <span class="font-normal text-slate-400">(optional)</span></span>
                <Textarea
                  v-model="description"
                  :rows="3"
                  placeholder="What does this app help your team do?"
                  maxlength="2000"
                />
              </label>
              <div class="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  @click="dialogOpen = false"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  :disabled="creating || !name.trim()"
                >
                  <LoaderCircle
                    v-if="creating"
                    :size="15"
                    class="animate-spin"
                  />
                  Create project
                </Button>
              </div>
            </form>
          </Dialog>
        </div>
      </section>

      <section class="mb-9 rounded-2xl border border-line bg-white p-5 shadow-sm sm:flex sm:items-center sm:justify-between sm:px-6">
        <div class="flex items-start gap-3">
          <span
            class="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            :class="connection.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-paper text-slate-500'"
          >
            <Link2 :size="18" />
          </span>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-semibold text-ink">
                HighLevel connection
              </h2>
              <Badge :tone="connection.connected ? 'green' : 'amber'">
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="connection.connected ? 'bg-emerald-500' : 'bg-amber-500'"
                />
                {{ connection.connected ? "Connected" : "Not connected" }}
              </Badge>
            </div>
            <p class="mt-1 text-xs text-slate-500">
              {{ connection.connected ? connection.locationName + " · " + connection.locationId : "Connect one HighLevel location to build apps with your CRM data." }}
            </p>
          </div>
        </div>
        <div class="mt-4 flex gap-2 sm:mt-0">
          <Button
            v-if="!connection.connected"
            size="sm"
            @click="emit('connect')"
          >
            <Link2 :size="14" /> Connect HighLevel
          </Button>
          <Button
            v-else
            variant="outline"
            size="sm"
            @click="emit('disconnect')"
          >
            Disconnect
          </Button>
        </div>
      </section>

      <div class="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 class="text-lg font-semibold tracking-tight text-ink">
            Your projects
          </h2>
          <p class="mt-0.5 text-xs text-slate-500">
            {{ projects.length }} {{ projects.length === 1 ? "project" : "projects" }}
          </p>
        </div>
        <label class="relative block w-full sm:max-w-xs">
          <Search
            :size="15"
            class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <Input
            v-model="search"
            class="pl-9"
            placeholder="Search projects"
          />
        </label>
      </div>

      <div
        v-if="loading"
        class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        <div
          v-for="item in 3"
          :key="item"
          class="h-48 animate-pulse rounded-2xl border border-line bg-white"
        />
      </div>
      <div
        v-else-if="filteredProjects.length"
        class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        <article
          v-for="project in filteredProjects"
          :key="project.id"
          class="group relative flex min-h-[205px] cursor-pointer flex-col rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-panel"
          tabindex="0"
          role="button"
          @click="emit('open', project)"
          @keydown.enter="emit('open', project)"
        >
          <div class="flex items-start justify-between">
            <span class="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
              <Code2 :size="18" />
            </span>
            <button
              class="rounded-lg p-2 text-slate-300 opacity-100 transition hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
              aria-label="Delete project"
              @click.stop="emit('remove', project)"
            >
              <Trash2 :size="15" />
            </button>
          </div>
          <h3 class="mt-4 truncate text-base font-semibold text-ink">
            {{ project.name }}
          </h3>
          <p class="mt-1 line-clamp-2 min-h-9 text-xs leading-5 text-slate-500">
            {{ project.description || "No description yet. Open this project to start building." }}
          </p>
          <div class="mt-auto flex items-center justify-between border-t border-line/80 pt-3">
            <span class="flex items-center gap-1.5 text-[11px] text-slate-400">
              <CalendarClock :size="13" /> Updated {{ project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : "just now" }}
            </span>
            <span class="flex items-center gap-1 text-[11px] font-medium text-accent">v{{ project.version }} <ChevronRight :size="13" /></span>
          </div>
        </article>
      </div>
      <div
        v-else
        class="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-5 py-16 text-center"
      >
        <span class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent"><Blocks :size="22" /></span>
        <h3 class="mt-4 text-sm font-semibold text-ink">
          {{ search ? "No matching projects" : "Your first app starts here" }}
        </h3>
        <p class="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
          {{ search ? "Try another search term." : "Connect HighLevel, create a project, then describe the app you want to build." }}
        </p>
        <Button
          v-if="!connection.connected"
          variant="outline"
          size="sm"
          class="mt-4"
          @click="emit('connect')"
        >
          <Link2 :size="14" /> Connect HighLevel
        </Button>
        <Button
          v-else-if="!search"
          size="sm"
          class="mt-4"
          @click="dialogOpen = true"
        >
          <Plus :size="14" /> Create project
        </Button>
      </div>
      <footer class="mt-9 flex items-center justify-center gap-5 text-[10px] uppercase tracking-[0.13em] text-slate-400">
        <span class="flex items-center gap-1.5"><Users :size="12" /> Private to your account</span>
        <span>·</span>
        <span>Firebase secured</span>
      </footer>
    </main>
  </div>
</template>
