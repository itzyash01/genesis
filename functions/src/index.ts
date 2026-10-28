import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getAppCheck } from "firebase-admin/app-check";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { z } from "zod";
import {
  allowedOrigins,
  appOrigin,
  hlClientId,
  hlClientSecret,
  hlRedirectUri,
  hlScopes,
  openAiApiKey,
  tokenEncryptionKey,
} from "./config.js";
import { auth, db } from "./admin.js";
import {
  createHighLevelAuthorizationUrl,
  disconnectHighLevel,
  finishHighLevelOAuth,
  getHighLevelConnection,
  getHighLevelData,
  HighLevelApiError,
} from "./highlevel.js";
import { generateProjectFiles } from "./generation.js";
import { pruneOldSnapshots } from "./snapshot-retention.js";
import {
  fileDocumentId,
  filePathSchema,
  projectDescriptionSchema,
  projectIdSchema,
  projectNameSchema,
} from "./validation.js";

const REGION = "us-central1";
const PROJECT_LIMIT = 50;
const FILE_LIMIT_BYTES = 220_000;
const PROJECT_FILE_LIMIT = 150;
const PROJECT_TOTAL_BYTES_LIMIT = 1_500_000;
const APP_CHECK_REQUIRED = process.env.APP_CHECK_REQUIRED === "true";
const callableOptions = {
  region: REGION,
  maxInstances: 30,
  enforceAppCheck: APP_CHECK_REQUIRED,
};

function requireUid(request: { auth?: { uid: string } | null }): string {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in to continue.");
  }
  return request.auth.uid;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpsError("invalid-argument", "Request data is invalid.");
  }
  return result.data;
}

function projectRef(uid: string, projectId: string) {
  return db.doc("users/" + uid + "/projects/" + projectId);
}

function assertProjectExists(data: DocumentData | undefined) {
  if (!data || data.deletedAt) throw new HttpsError("not-found", "Project not found.");
  if (
    data.activeGenerationId &&
    Number(data.generationLeaseUntilMs ?? Number.POSITIVE_INFINITY) > Date.now()
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Project files cannot be changed while generation is running.",
    );
  }
}

function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return null;
}

function publicProject(id: string, data: DocumentData) {
  return {
    id,
    name: data.name,
    description: data.description ?? "",
    highLevelLocationId: data.highLevelLocationId ?? null,
    version: Number(data.version ?? 0),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    activeGenerationId: data.activeGenerationId ?? null,
  };
}

export const createProject = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(
    z.object({
      name: projectNameSchema,
      description: projectDescriptionSchema.default(""),
    }),
    request.data,
  );
  const connection = await getHighLevelConnection(uid);
  if (!connection.connected) {
    throw new HttpsError("failed-precondition", "Connect a CRM account before creating a project.");
  }
  const projects = db.collection("users/" + uid + "/projects");
  const active = await projects.where("deletedAt", "==", null).limit(PROJECT_LIMIT).get();
  if (active.size >= PROJECT_LIMIT) {
    throw new HttpsError("resource-exhausted", "A user can have up to " + PROJECT_LIMIT + " active projects.");
  }
  const id = randomUUID();
  const now = FieldValue.serverTimestamp();
  await projectRef(uid, id).create({
    name: parsed.name,
    description: parsed.description,
    highLevelLocationId: connection.locationId,
    highLevelLocationName: connection.locationName,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ownerUid: uid,
  });
  return { project: { id, name: parsed.name, description: parsed.description, highLevelLocationId: connection.locationId, version: 0 } };
});

export const listProjects = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const snapshot = await db
    .collection("users/" + uid + "/projects")
    .where("deletedAt", "==", null)
    .orderBy("updatedAt", "desc")
    .limit(PROJECT_LIMIT)
    .get();
  return {
    projects: snapshot.docs.map((document) => publicProject(document.id, document.data())),
    connection: await getHighLevelConnection(uid),
  };
});

export const getProject = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(z.object({ projectId: projectIdSchema }), request.data);
  const ref = projectRef(uid, parsed.projectId);
  const snapshot = await ref.get();
  assertProjectExists(snapshot.data());
  const filesSnapshot = await ref.collection("files").limit(150).get();
  return {
    project: publicProject(snapshot.id, snapshot.data() as DocumentData),
    files: filesSnapshot.docs.map((file) => ({
      path: file.data().path,
      content: file.data().content,
      updatedAt: toIso(file.data().updatedAt),
    })),
  };
});

export const listProjectMessages = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(z.object({ projectId: projectIdSchema }), request.data);
  const ref = projectRef(uid, parsed.projectId);
  const project = await ref.get();
  assertProjectExists(project.data());
  const messages = await ref
    .collection("messages")
    .orderBy("createdAt", "asc")
    .limit(100)
    .get();
  return {
    messages: messages.docs.map((document) => ({
      id: document.id,
      role: document.data().role,
      content: document.data().content,
      createdAt: toIso(document.data().createdAt),
    })),
  };
});

export const appendProjectMessage = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(
    z.object({
      projectId: projectIdSchema,
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(8_000),
    }),
    request.data,
  );
  const ref = projectRef(uid, parsed.projectId);
  const project = await ref.get();
  assertProjectExists(project.data());
  const messages = ref.collection("messages");
  const messageRef = messages.doc();
  await db.runTransaction(async (transaction) => {
    const prior = await transaction.get(messages.orderBy("createdAt", "asc").limit(100));
    const currentProject = await transaction.get(ref);
    assertProjectExists(currentProject.data());
    if (prior.size === 100) transaction.delete(prior.docs[0].ref);
    transaction.create(messageRef, {
      role: parsed.role,
      content: parsed.content,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { id: messageRef.id };
});

export const updateProject = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(
    z.object({
      projectId: projectIdSchema,
      name: projectNameSchema.optional(),
      description: projectDescriptionSchema.optional(),
    })
      .refine((value) => value.name !== undefined || value.description !== undefined),
    request.data,
  );
  const ref = projectRef(uid, parsed.projectId);
  await db.runTransaction(async (transaction) => {
    const project = await transaction.get(ref);
    assertProjectExists(project.data());
    transaction.update(ref, {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const updated = await ref.get();
  return { project: publicProject(updated.id, updated.data() as DocumentData) };
});

export const softDeleteProject = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(z.object({ projectId: projectIdSchema }), request.data);
  const ref = projectRef(uid, parsed.projectId);
  await db.runTransaction(async (transaction) => {
    const project = await transaction.get(ref);
    assertProjectExists(project.data());
    transaction.update(ref, {
      deletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      activeGenerationId: FieldValue.delete(),
      generationLeaseUntilMs: FieldValue.delete(),
    });
  });
  return { success: true };
});

export const listFiles = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(z.object({ projectId: projectIdSchema }), request.data);
  const ref = projectRef(uid, parsed.projectId);
  const project = await ref.get();
  assertProjectExists(project.data());
  const files = await ref.collection("files").limit(150).get();
  return {
    files: files.docs.map((document) => ({
      path: document.data().path,
      content: document.data().content,
      updatedAt: toIso(document.data().updatedAt),
    })),
  };
});

export const saveFile = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(
    z.object({
      projectId: projectIdSchema,
      path: filePathSchema,
      content: z.string().max(FILE_LIMIT_BYTES),
    }),
    request.data,
  );
  const ref = projectRef(uid, parsed.projectId);
  const currentFiles = ref.collection("files");
  await db.runTransaction(async (transaction) => {
    const project = await transaction.get(ref);
    assertProjectExists(project.data());
    const fileRef = currentFiles.doc(fileDocumentId(parsed.path));
    const files = await transaction.get(currentFiles.limit(PROJECT_FILE_LIMIT + 1));
    if (files.size > PROJECT_FILE_LIMIT) {
      throw new HttpsError("failed-precondition", "Project contains too many files to update safely.");
    }
    const existingFile = files.docs.find((document) => document.id === fileRef.id);
    if (!existingFile && files.size >= PROJECT_FILE_LIMIT) {
      throw new HttpsError("resource-exhausted", "A project can contain up to 150 files.");
    }
    const currentBytes = files.docs.reduce(
      (total, document) => total + Buffer.byteLength(String(document.data().content ?? ""), "utf8"),
      0,
    );
    const previousBytes = existingFile
      ? Buffer.byteLength(String(existingFile.data().content ?? ""), "utf8")
      : 0;
    const nextBytes = currentBytes - previousBytes + Buffer.byteLength(parsed.content, "utf8");
    if (nextBytes > PROJECT_TOTAL_BYTES_LIMIT) {
      throw new HttpsError("resource-exhausted", "A project can contain up to 1.5 MB of files.");
    }
    transaction.set(fileRef, {
      path: parsed.path,
      content: parsed.content,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(ref, { updatedAt: FieldValue.serverTimestamp() });
  });
  return { success: true, path: parsed.path };
});

export const listSnapshots = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(z.object({ projectId: projectIdSchema }), request.data);
  const ref = projectRef(uid, parsed.projectId);
  const project = await ref.get();
  assertProjectExists(project.data());
  const snapshots = await ref
    .collection("snapshots")
    .where("status", "==", "complete")
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();
  return {
    snapshots: snapshots.docs.map((document) => ({
      id: document.id,
      version: document.data().version,
      fileCount: document.data().fileCount,
      prompt: document.data().prompt,
      createdAt: toIso(document.data().createdAt),
    })),
  };
});

export const restoreSnapshot = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = parseInput(
    z.object({
      projectId: projectIdSchema,
      snapshotId: z.string().uuid(),
    }),
    request.data,
  );
  const ref = projectRef(uid, parsed.projectId);
  const snapshotRef = ref.collection("snapshots").doc(parsed.snapshotId);
  const restoreId = randomUUID();
  const locked = await db.runTransaction(async (transaction) => {
    const [project, snapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(snapshotRef),
    ]);
    assertProjectExists(project.data());
    if (!snapshot.exists || snapshot.data()?.status !== "complete") {
      throw new HttpsError("not-found", "Snapshot not found.");
    }
    transaction.update(ref, {
      activeGenerationId: restoreId,
      generationLeaseUntilMs: Date.now() + 60_000,
    });
    return {
      version: (Number(project.data()?.version) || 0) + 1,
      sourceVersion: Number(snapshot.data()?.version) || 0,
    };
  });

  try {
    const [previousFiles, savedFiles] = await Promise.all([
      ref.collection("files").limit(151).get(),
      snapshotRef.collection("files").limit(151).get(),
    ]);
    if (previousFiles.size > 150 || savedFiles.size > 150) {
      throw new HttpsError("failed-precondition", "Project or snapshot has too many files to restore safely.");
    }
    const batch = db.batch();
    const nextSnapshotRef = ref.collection("snapshots").doc(randomUUID());
    previousFiles.docs.forEach((document) => batch.delete(document.ref));
    batch.set(nextSnapshotRef, {
      version: locked.version,
      status: "complete",
      fileCount: savedFiles.size,
      prompt: "Restored snapshot version " + locked.sourceVersion,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      restoredFromSnapshotId: parsed.snapshotId,
    });
    savedFiles.docs.forEach((document) => {
      const data = document.data();
      batch.set(ref.collection("files").doc(document.id), {
        path: data.path,
        content: data.content,
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(nextSnapshotRef.collection("files").doc(document.id), {
        path: data.path,
        content: data.content,
      });
    });
    batch.update(ref, {
      version: locked.version,
      lastSnapshotId: nextSnapshotRef.id,
      updatedAt: FieldValue.serverTimestamp(),
      restoredFromSnapshotId: parsed.snapshotId,
      activeGenerationId: FieldValue.delete(),
      generationStartedAt: FieldValue.delete(),
      generationLeaseUntilMs: FieldValue.delete(),
    });
    await batch.commit();
    await pruneOldSnapshots(ref);
    return { success: true, fileCount: savedFiles.size, version: locked.version };
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.exists && current.data()?.activeGenerationId === restoreId) {
        transaction.update(ref, {
          activeGenerationId: FieldValue.delete(),
          generationLeaseUntilMs: FieldValue.delete(),
        });
      }
    });
    throw error;
  }
});

export const getHighLevelConnectionStatus = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  return getHighLevelConnection(uid);
});

export const startHighLevelOAuth = onCall(
  callableOptions,
  async (request) => {
    const uid = requireUid(request);
    const url = await createHighLevelAuthorizationUrl({
      uid,
      clientId: hlClientId.value(),
      redirectUri: hlRedirectUri.value(),
      scopes: hlScopes.value(),
    });
    return { authorizationUrl: url };
  },
);

export const disconnectHighLevelAccount = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  await disconnectHighLevel(uid);
  return { success: true };
});

export const highLevelData = onCall(
  { ...callableOptions, secrets: [hlClientSecret, tokenEncryptionKey] },
  async (request) => {
    const uid = requireUid(request);
    const parsed = parseInput(
      z.object({
        projectId: projectIdSchema,
        kind: z.enum(["contacts", "conversations", "messages", "calendars", "appointments"]),
        query: z.string().max(100).optional(),
        conversationId: z.string().max(128).optional(),
      }),
      request.data,
    );
    try {
      const rateRef = db.doc("users/" + uid + "/rateLimits/highlevel");
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(rateRef);
        const now = Date.now();
        const data = current.data() as { windowStartMs?: number; count?: number } | undefined;
        const expired = !data || now - (data.windowStartMs ?? 0) >= 60_000;
        const count = expired ? 0 : data.count ?? 0;
        if (count >= 60) {
          throw new HttpsError("resource-exhausted", "CRM preview request limit reached.");
        }
        transaction.set(rateRef, {
          windowStartMs: expired ? now : data?.windowStartMs,
          count: count + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return await getHighLevelData({
        uid,
        ...parsed,
        clientId: hlClientId.value(),
        clientSecret: hlClientSecret.value(),
        encryptionKey: tokenEncryptionKey.value(),
      });
    } catch (error) {
      if (error instanceof HighLevelApiError) {
        if (error.status === 401) {
          throw new HttpsError("failed-precondition", error.message);
        }
        if (error.status === 429) {
          throw new HttpsError("resource-exhausted", error.message);
        }
        throw new HttpsError("unavailable", error.message);
      }
      throw error;
    }
  },
);

export const oauthCallback = onRequest(
  {
    region: REGION,
    timeoutSeconds: 60,
    maxInstances: 20,
    secrets: [hlClientSecret, tokenEncryptionKey],
  },
  async (request, response) => {
    if (request.method !== "GET") {
      response.status(405).send("Method not allowed.");
      return;
    }
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const oauthError = typeof request.query.error === "string" ? request.query.error : "";
    const origin = appOrigin.value();
    if (!origin) {
      response.status(500).send("Application origin is not configured.");
      return;
    }
    if (oauthError) {
      response.redirect(302, origin + "/?highlevel=error");
      return;
    }
    if (!code || !state || code.length > 2_048 || state.length > 256) {
      response.status(400).send("OAuth callback is missing required parameters.");
      return;
    }
    try {
      await finishHighLevelOAuth({
        code,
        state,
        clientId: hlClientId.value(),
        clientSecret: hlClientSecret.value(),
        redirectUri: hlRedirectUri.value(),
        encryptionKey: tokenEncryptionKey.value(),
      });
      response.redirect(302, origin + "/?highlevel=connected");
    } catch (error) {
      logger.error("HighLevel OAuth callback failed", {
        code: error instanceof HttpsError ? error.code : "internal",
      });
      response.redirect(302, origin + "/?highlevel=error");
    }
  },
);

function addCorsHeaders(
  request: { headers: { origin?: string | string[] } },
  response: { setHeader: (name: string, value: string) => unknown },
) {
  const origin = request.headers.origin;
  const configuredOrigins = allowedOrigins
    .value()
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (typeof origin === "string" && configuredOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Firebase-AppCheck");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Max-Age", "600");
  }
}

export const api = onRequest(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 20,
    concurrency: 10,
    secrets: [hlClientSecret, tokenEncryptionKey, openAiApiKey],
  },
  async (request, response) => {
    addCorsHeaders(request, response);
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    const path = request.path.replace(/\/+$/, "") || "/";
    if (request.method !== "POST" || !["/", "/generate", "/api/generate"].includes(path)) {
      response.status(404).json({ error: "Not found." });
      return;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    const rawBodyLength = (request as typeof request & { rawBody?: Buffer }).rawBody?.length ?? 0;
    if (contentLength > 40_000 || rawBodyLength > 40_000) {
      response.status(413).json({ error: "Request is too large." });
      return;
    }
    const origin = request.headers.origin;
    const configuredOrigins = allowedOrigins
      .value()
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (origin && !configuredOrigins.includes(origin)) {
      response.status(403).json({ error: "Origin is not allowed." });
      return;
    }
    const authorization = request.headers.authorization ?? "";
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) {
      response.status(401).json({ error: "Sign in to continue." });
      return;
    }
    let uid: string;
    try {
      uid = (await auth.verifyIdToken(match[1], true)).uid;
    } catch {
      response.status(401).json({ error: "Your session expired. Sign in again." });
      return;
    }
    if (APP_CHECK_REQUIRED) {
      const appCheckToken = request.headers["x-firebase-appcheck"];
      if (typeof appCheckToken !== "string") {
        response.status(401).json({ error: "A valid Firebase App Check token is required." });
        return;
      }
      try {
        await getAppCheck().verifyToken(appCheckToken);
      } catch {
        response.status(401).json({ error: "A valid Firebase App Check token is required." });
        return;
      }
    }
    let input: { projectId: string; prompt: string };
    try {
      input = z
        .object({
          projectId: projectIdSchema,
          prompt: z.string().trim().min(1).max(8_000),
        })
        .parse(request.body);
    } catch {
      response.status(400).json({ error: "Provide a project ID and a prompt under 8,000 characters." });
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    let closed = false;
    const controller = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) {
        closed = true;
        controller.abort();
      }
    });
    const send = async (event: string, data: Record<string, unknown>) => {
      if (closed || response.destroyed) throw new Error("Client disconnected.");
      response.write("event: " + event + "\n");
      response.write("data: " + JSON.stringify(data) + "\n\n");
    };

    try {
      await generateProjectFiles({
        uid,
        projectId: input.projectId,
        prompt: input.prompt,
        apiKey: openAiApiKey.value(),
        signal: controller.signal,
        send,
      });
    } catch (error) {
      const message = error instanceof HttpsError ? error.message : "Generation could not be started.";
      const status =
        error instanceof HttpsError && error.code === "resource-exhausted"
          ? 429
          : error instanceof HttpsError && error.code === "not-found"
            ? 404
            : 400;
      if (!closed && !response.destroyed) {
        if (response.headersSent) {
          response.write(
            "event: error\ndata: " +
              JSON.stringify({
                code: error instanceof HttpsError ? error.code : "internal",
                message,
              }) +
              "\n\n",
          );
          response.write("event: complete\ndata: " + JSON.stringify({ files: [], partial: true }) + "\n\n");
          response.end();
        } else {
          response.status(status).json({ error: message });
        }
      }
      return;
    }
    if (!closed && !response.writableEnded) response.end();
  },
);
