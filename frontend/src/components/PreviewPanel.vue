<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Monitor, RotateCw, ShieldCheck, Smartphone } from "@lucide/vue";
import type { ProjectFile } from "../lib/api";
import Button from "./ui/Button.vue";
import Badge from "./ui/Badge.vue";

const props = defineProps<{ files: ProjectFile[]; projectName: string; refreshKey: number }>();
const emit = defineEmits<{
  dataRequest: [request: { id: string; action: string; params: Record<string, unknown> }];
}>();
const frame = ref<HTMLIFrameElement | null>(null);
const device = ref<"desktop" | "mobile">("desktop");
const requestTimes: number[] = [];

const srcdoc = computed(() => {
  const entry = props.files.find((file) => file.path === "index.html");
  if (!entry) return "";
  const parsed = new DOMParser().parseFromString(entry.content, "text/html");
  parsed.querySelectorAll("meta[http-equiv='Content-Security-Policy']").forEach((element) => element.remove());
  parsed.querySelectorAll("meta[http-equiv]").forEach((element) => {
    if (element.getAttribute("http-equiv")?.toLowerCase() === "refresh") element.remove();
  });

  const inlineScripts: string[] = [];
  parsed.querySelectorAll("script").forEach((script) => {
    if (!script.src && script.textContent) inlineScripts.push(script.textContent);
    script.remove();
  });
  parsed.querySelectorAll("link[rel='stylesheet'], iframe, object, embed, base").forEach((element) => element.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
      if (
        ["srcdoc", "srcset"].includes(attribute.name.toLowerCase()) ||
        (["src", "href", "action", "formaction"].includes(attribute.name.toLowerCase()) &&
          /^\s*javascript:/i.test(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  const policy = parsed.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
    "font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; " +
    "object-src 'none'";
  parsed.head.prepend(policy);
  const title = parsed.createElement("title");
  title.textContent = props.projectName;
  if (!parsed.head.querySelector("title")) parsed.head.append(title);

  for (const file of props.files.filter((item) => item.path.toLowerCase().endsWith(".css"))) {
    const style = parsed.createElement("style");
    style.textContent = file.content;
    parsed.head.append(style);
  }

  const bridge = [
    "(function(){",
    "var pending=new Map();",
    "window.addEventListener('message',function(event){",
    "if(event.source!==parent||!event.data||event.data.source!=='genesis-parent')return;",
    "var item=pending.get(event.data.id);if(!item)return;pending.delete(event.data.id);",
    "if(event.data.error)item.reject(new Error(event.data.error));else item.resolve(event.data.result);",
    "});",
    "function call(action,params){return new Promise(function(resolve,reject){",
    "var id=Math.random().toString(36).slice(2)+Date.now().toString(36);",
    "var timer=setTimeout(function(){pending.delete(id);reject(new Error('Request timed out'));},20000);",
    "pending.set(id,{resolve:function(value){clearTimeout(timer);resolve(value);},reject:function(error){clearTimeout(timer);reject(error);}});",
    "parent.postMessage({source:'genesis-preview',id:id,action:action,params:params||{}},'*');",
    "});}",
    "window.genesis={highlevel:{",
    "contacts:function(options){return call('contacts',options);},",
    "conversations:function(options){return call('conversations',options);},",
    "messages:function(conversationId){return call('messages',{conversationId:conversationId});},",
    "calendars:function(options){return call('calendars',options);},",
    "appointments:function(options){return call('appointments',options);}",
    "}};",
    "})();",
  ].join("");
  const bridgeScript = parsed.createElement("script");
  bridgeScript.textContent = bridge;
  parsed.head.append(bridgeScript);

  const javascriptFiles = props.files
    .filter((file) => file.path.toLowerCase().endsWith(".js"))
    .sort((a, b) => {
      const aMain = /(^|\/)(main|app|index)\.js$/i.test(a.path) ? 0 : 1;
      const bMain = /(^|\/)(main|app|index)\.js$/i.test(b.path) ? 0 : 1;
      return aMain - bMain || a.path.localeCompare(b.path);
    });
  for (const code of [...inlineScripts, ...javascriptFiles.map((file) => file.content)]) {
    const script = parsed.createElement("script");
    script.textContent = code.replace(/<\/script/gi, "<\\/script");
    parsed.body.append(script);
  }
  return "<!doctype html>\n" + parsed.documentElement.outerHTML;
});

function onWindowMessage(event: MessageEvent) {
  if (!frame.value?.contentWindow || event.source !== frame.value.contentWindow) return;
  const data = event.data as {
    source?: unknown;
    id?: unknown;
    action?: unknown;
    params?: unknown;
  };
  const allowedActions = ["contacts", "conversations", "messages", "calendars", "appointments"];
  if (
    data?.source !== "genesis-preview" ||
    typeof data.id !== "string" ||
    typeof data.action !== "string" ||
    !allowedActions.includes(data.action) ||
    typeof data.params !== "object" ||
    data.params === null ||
    Array.isArray(data.params)
  ) {
    return;
  }
  const now = Date.now();
  while (requestTimes.length && now - requestTimes[0] > 60_000) requestTimes.shift();
  if (requestTimes.length >= 30) {
    respond(data.id, undefined, "Preview data request limit reached. Wait a moment and try again.");
    return;
  }
  requestTimes.push(now);
  emit("dataRequest", {
    id: data.id,
    action: data.action,
    params: data.params as Record<string, unknown>,
  });
}

function respond(id: string, result?: unknown, error?: string) {
  frame.value?.contentWindow?.postMessage(
    { source: "genesis-parent", id, result, error },
    "*",
  );
}

function refresh() {
  const current = frame.value;
  if (current) {
    const source = srcdoc.value;
    current.srcdoc = "";
    requestAnimationFrame(() => {
      if (frame.value) frame.value.srcdoc = source;
    });
  }
}

onMounted(() => window.addEventListener("message", onWindowMessage));
onBeforeUnmount(() => window.removeEventListener("message", onWindowMessage));
defineExpose({ respond });
</script>

<template>
  <section class="flex min-h-[520px] flex-col bg-white lg:min-h-0">
    <header class="flex h-[58px] shrink-0 items-center justify-between border-b border-line px-4">
      <div class="flex items-center gap-2">
        <h2 class="text-xs font-semibold text-ink">
          Live preview
        </h2>
        <Badge tone="green">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Sandbox
        </Badge>
      </div>
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          :class="device === 'desktop' ? 'bg-paper text-accent' : ''"
          aria-label="Desktop preview"
          @click="device = 'desktop'"
        >
          <Monitor :size="15" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :class="device === 'mobile' ? 'bg-paper text-accent' : ''"
          aria-label="Mobile preview"
          @click="device = 'mobile'"
        >
          <Smartphone :size="15" />
        </Button>
        <span class="mx-1 h-4 w-px bg-line" />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh preview"
          @click="refresh"
        >
          <RotateCw :size="14" />
        </Button>
      </div>
    </header>
    <div class="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-[#edf1ef] p-3 sm:p-5">
      <div
        v-if="!files.some((file) => file.path === 'index.html')"
        class="grid h-full min-h-[380px] w-full place-items-center text-center"
      >
        <div>
          <span class="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-400 shadow-sm"><Monitor :size="19" /></span>
          <p class="mt-3 text-xs font-semibold text-slate-600">
            Preview is waiting for your app
          </p>
          <p class="mt-1 text-[10px] text-slate-400">
            Generate an app with an index.html file to see it here.
          </p>
        </div>
      </div>
      <div
        v-else
        class="flex min-h-[430px] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg transition-all"
        :class="device === 'mobile' ? 'max-w-[390px]' : 'max-w-none'"
      >
        <div class="flex h-8 shrink-0 items-center gap-1.5 border-b border-slate-100 bg-white px-3">
          <span class="h-2 w-2 rounded-full bg-rose-300" />
          <span class="h-2 w-2 rounded-full bg-amber-300" />
          <span class="h-2 w-2 rounded-full bg-emerald-300" />
          <div class="mx-auto flex w-[60%] items-center justify-center gap-1 rounded bg-paper px-2 py-1 text-[9px] text-slate-400">
            <ShieldCheck
              :size="10"
              class="text-emerald-600"
            /> genesis-preview.local
          </div>
        </div>
        <iframe
          ref="frame"
          :key="refreshKey"
          :srcdoc="srcdoc"
          title="Generated app preview"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          class="min-h-[390px] w-full flex-1 border-0 bg-white"
        />
      </div>
    </div>
  </section>
</template>
