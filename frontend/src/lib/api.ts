import { httpsCallable } from "firebase/functions";
import { auth, functions, getAppCheckRequestToken } from "./firebase";

export type Project = {
  id: string;
  name: string;
  description: string;
  highLevelLocationId: string | null;
  version: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  activeGenerationId?: string | null;
};

export type ProjectFile = {
  path: string;
  content: string;
  updatedAt?: string | null;
};

export type Snapshot = {
  id: string;
  version: number;
  fileCount: number;
  prompt: string;
  createdAt: string | null;
};

export type SnapshotChange = {
  path: string;
  status: "added" | "modified" | "removed";
  before: string;
  after: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string | null;
};

export type ConnectionStatus =
  | { connected: false }
  | { connected: true; locationId: string; locationName: string };

export type HighLevelReadKind =
  | "contacts"
  | "contact"
  | "conversations"
  | "messages"
  | "calendars"
  | "appointments"
  | "availability";

export type HighLevelWriteInput =
  | { action: "createContact"; contact: Record<string, string> }
  | { action: "updateContact"; contactId: string; changes: Record<string, string> }
  | { action: "createAppointment"; contactId: string; calendarId: string; title: string; startTime: string; endTime?: string }
  | { action: "sendMessage"; contactId: string; type: "SMS" | "Email"; message: string; subject?: string };

async function call<T>(
  name: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const callable = httpsCallable<Record<string, unknown>, T>(functions, name);
  const result = await callable(data);
  return result.data;
}

export const api = {
  createProject: (name: string, description: string) =>
    call<{ project: Project }>("createProject", { name, description }),
  listProjects: () =>
    call<{ projects: Project[]; connection: ConnectionStatus }>("listProjects"),
  getProject: (projectId: string) =>
    call<{ project: Project; files: ProjectFile[] }>("getProject", { projectId }),
  listMessages: (projectId: string) =>
    call<{ messages: ChatMessage[] }>("listProjectMessages", { projectId }),
  appendMessage: (projectId: string, role: ChatMessage["role"], content: string) =>
    call<{ id: string }>("appendProjectMessage", { projectId, role, content }),
  updateProject: (input: { projectId: string; name?: string; description?: string }) =>
    call<{ project: Project }>("updateProject", input),
  softDeleteProject: (projectId: string) =>
    call<{ success: boolean }>("softDeleteProject", { projectId }),
  saveFile: (projectId: string, path: string, content: string) =>
    call<{ success: boolean; path: string }>("saveFile", { projectId, path, content }),
  listSnapshots: (projectId: string) =>
    call<{ snapshots: Snapshot[] }>("listSnapshots", { projectId }),
  getSnapshotDiff: (projectId: string, snapshotId: string) =>
    call<{ available: boolean; changes: SnapshotChange[] }>("getSnapshotDiff", { projectId, snapshotId }),
  restoreSnapshot: (projectId: string, snapshotId: string) =>
    call<{ success: boolean; fileCount: number }>("restoreSnapshot", { projectId, snapshotId }),
  startHighLevelOAuth: () =>
    call<{ authorizationUrl: string }>("startHighLevelOAuth"),
  disconnectHighLevel: () =>
    call<{ success: boolean }>("disconnectHighLevelAccount"),
  getHighLevelData: (
    projectId: string,
    kind: HighLevelReadKind,
    extra: {
      query?: string;
      contactId?: string;
      conversationId?: string;
      calendarId?: string;
      startDate?: number;
      endDate?: number;
      timezone?: string;
    } = {},
  ) => call<unknown>("highLevelData", {
    projectId,
    kind,
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)),
  }),
  highLevelWrite: (projectId: string, input: HighLevelWriteInput) =>
    call<unknown>("highLevelWrite", { projectId, ...input }),
};

export type GenerationEvent =
  | { event: "token"; data: { text: string } }
  | { event: "file_start"; data: { path: string } }
  | { event: "file_content"; data: { path: string; content: string } }
  | { event: "file_end"; data: { path: string } }
  | {
      event: "complete";
      data: { generationId?: string; snapshotId?: string | null; files: string[]; partial: boolean };
    }
  | { event: "error"; data: { code: string; message: string } };

export async function streamGeneration(
  projectId: string,
  prompt: string,
  signal: AbortSignal,
  onEvent: (event: GenerationEvent) => void,
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Sign in to generate an app.");
  const idToken = await currentUser.getIdToken();
  const appCheckToken = await getAppCheckRequestToken();
  const endpoint = import.meta.env.VITE_GENERATION_URL || "/api/generate";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + idToken,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(appCheckToken ? { "X-Firebase-AppCheck": appCheckToken } : {}),
    },
    body: JSON.stringify({ projectId, prompt }),
    signal,
  });
  if (!response.ok) {
    let message = "Generation could not be started.";
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("The browser did not provide a response stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawCompletion = false;
  const emitFrame = (frame: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    try {
      const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      if (event === "complete") sawCompletion = true;
      onEvent({ event, data } as GenerationEvent);
    } catch {
      onEvent({
        event: "error",
        data: { code: "INVALID_STREAM", message: "The server returned an invalid event." },
      });
    }
  };

  try {
    while (true) {
      const result = await reader.read();
      buffer += decoder.decode(result.value, { stream: !result.done });
      let separator = buffer.search(/\r?\n\r?\n/);
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        const match = /\r?\n\r?\n/.exec(buffer.slice(separator));
        const frameLength = match?.[0].length ?? 2;
        buffer = buffer.slice(separator + frameLength);
        emitFrame(frame);
        separator = buffer.search(/\r?\n\r?\n/);
      }
      if (result.done) break;
    }
    if (buffer.trim()) emitFrame(buffer);
    if (!sawCompletion) {
      throw new Error("The generation stream disconnected before completion. Refresh the project to see any saved files.");
    }
  } finally {
    reader.releaseLock();
  }
}
