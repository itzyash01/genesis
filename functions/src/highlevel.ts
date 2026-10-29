import { randomBytes, randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./admin.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { hashToken, projectIdSchema } from "./validation.js";
import { HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

const HL_API = "https://services.leadconnectorhq.com";
const TOKEN_URL = HL_API + "/oauth/token";
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_SKEW_MS = 90_000;

type OAuthToken = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_in?: number;
  expiresIn?: number;
  locationId?: string;
};

type EncryptedValue = { iv: string; tag: string; ciphertext: string };
type StoredIntegration = {
  locationId: string;
  locationName?: string;
  accessToken: EncryptedValue;
  refreshToken: EncryptedValue;
  expiresAtMs: number;
  refreshLockId?: string;
  refreshLockUntilMs?: number;
};

export class HighLevelApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function integrationRef(uid: string) {
  return db.doc("users/" + uid + "/integrations/highlevel");
}

function requireOAuthConfig(clientId: string, redirectUri: string) {
  if (!clientId || !redirectUri) {
    throw new HttpsError(
      "failed-precondition",
      "The CRM integration is not configured. Contact your administrator.",
    );
  }
}

function tokenPair(response: OAuthToken) {
  const accessToken = response.access_token ?? response.accessToken;
  const refreshToken = response.refresh_token ?? response.refreshToken;
  const expiresIn = response.expires_in ?? response.expiresIn;
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresIn !== "number"
  ) {
    throw new HttpsError(
      "internal",
      "The authorization response was incomplete.",
    );
  }
  return { accessToken, refreshToken, expiresIn };
}

async function exchangeCode(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OAuthToken> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: "authorization_code",
    code: options.code,
    user_type: "Location",
    redirect_uri: options.redirectUri,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new HttpsError(
      "failed-precondition",
      "CRM authorization could not be completed. Check the connection settings and try again.",
    );
  }
  return (await response.json()) as OAuthToken;
}

export async function createHighLevelAuthorizationUrl(options: {
  uid: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
}): Promise<string> {
  requireOAuthConfig(options.clientId, options.redirectUri);
  const state = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.doc("oauthStates/" + hashToken(state)).create({
    uid: options.uid,
    createdAt: Timestamp.fromMillis(now),
    expiresAtMs: now + STATE_TTL_MS,
    expiresAt: Timestamp.fromMillis(now + STATE_TTL_MS),
  });

  const url = new URL("https://marketplace.gohighlevel.com/oauth/chooselocation");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", options.scopes);
  url.searchParams.set("state", state);
  return url.toString();
}

async function consumeOAuthState(state: string): Promise<string> {
  const ref = db.doc("oauthStates/" + hashToken(state));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new HttpsError("invalid-argument", "The OAuth state is invalid or expired.");
    }
    const data = snapshot.data() as { uid: string; expiresAtMs: number };
    transaction.delete(ref);
    if (data.expiresAtMs < Date.now()) {
      throw new HttpsError("deadline-exceeded", "The OAuth state is invalid or expired.");
    }
    return data.uid;
  });
}

export async function finishHighLevelOAuth(options: {
  code: string;
  state: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
}): Promise<string> {
  const uid = await consumeOAuthState(options.state);
  const response = await exchangeCode({
    code: options.code,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri: options.redirectUri,
  });
  const tokens = tokenPair(response);
  const locationId = response.locationId;
  if (!locationId) {
    throw new HttpsError(
      "failed-precondition",
      "Choose one business account when installing the app.",
    );
  }

  let locationName = locationId;
  try {
    const locationResponse = await fetch(
      HL_API + "/locations/" + encodeURIComponent(locationId),
      {
        headers: {
          Authorization: "Bearer " + tokens.accessToken,
          Version: "2021-07-28",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (locationResponse.ok) {
      const locationData = (await locationResponse.json()) as {
        location?: { name?: string };
        name?: string;
      };
      locationName = locationData.location?.name ?? locationData.name ?? locationId;
    }
  } catch {
    locationName = locationId;
  }

  await integrationRef(uid).set({
    locationId,
    locationName,
    accessToken: encryptSecret(tokens.accessToken, options.encryptionKey),
    refreshToken: encryptSecret(tokens.refreshToken, options.encryptionKey),
    expiresAtMs: Date.now() + tokens.expiresIn * 1000,
    connectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return uid;
}

async function refreshAccessToken(options: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<OAuthToken> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
    user_type: "Location",
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new HttpsError(
      "failed-precondition",
      "CRM authorization expired. Reconnect your account.",
    );
  }
  return (await response.json()) as OAuthToken;
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function getHighLevelAccessToken(options: {
  uid: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
}): Promise<{ accessToken: string; locationId: string; locationName: string }> {
  const ref = integrationRef(options.uid);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new HttpsError("failed-precondition", "Connect a CRM account first.");
    }
    const stored = snapshot.data() as StoredIntegration;
    if (stored.expiresAtMs > Date.now() + TOKEN_SKEW_MS) {
      return {
        accessToken: decryptSecret(stored.accessToken, options.encryptionKey),
        locationId: stored.locationId,
        locationName: stored.locationName ?? stored.locationId,
      };
    }

    const lockId = randomUUID();
    const state = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists) return { kind: "missing" as const };
      const data = current.data() as StoredIntegration;
      if (data.expiresAtMs > Date.now() + TOKEN_SKEW_MS) {
        return { kind: "valid" as const, data };
      }
      if ((data.refreshLockUntilMs ?? 0) > Date.now()) {
        return { kind: "wait" as const };
      }
      transaction.update(ref, {
        refreshLockId: lockId,
        refreshLockUntilMs: Date.now() + 25_000,
      });
      return { kind: "refresh" as const, data };
    });

    if (state.kind === "valid") {
      return {
        accessToken: decryptSecret(state.data.accessToken, options.encryptionKey),
        locationId: state.data.locationId,
        locationName: state.data.locationName ?? state.data.locationId,
      };
    }
    if (state.kind === "missing") {
      throw new HttpsError("failed-precondition", "Connect a CRM account first.");
    }
    if (state.kind === "wait") {
      await delay(300);
      continue;
    }

    try {
      const oldRefreshToken = decryptSecret(state.data.refreshToken, options.encryptionKey);
      const renewed = tokenPair(
        await refreshAccessToken({
          refreshToken: oldRefreshToken,
          clientId: options.clientId,
          clientSecret: options.clientSecret,
        }),
      );
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (!current.exists) throw new Error("HighLevel connection was removed.");
        const currentData = current.data() as StoredIntegration;
        if (currentData.refreshLockId !== lockId) {
          throw new Error("HighLevel token refresh lock was lost.");
        }
        transaction.update(ref, {
          accessToken: encryptSecret(renewed.accessToken, options.encryptionKey),
          refreshToken: encryptSecret(renewed.refreshToken, options.encryptionKey),
          expiresAtMs: Date.now() + renewed.expiresIn * 1000,
          refreshLockId: FieldValue.delete(),
          refreshLockUntilMs: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return {
        accessToken: renewed.accessToken,
        locationId: state.data.locationId,
        locationName: state.data.locationName ?? state.data.locationId,
      };
    } catch (error) {
      await ref.update({
        refreshLockId: FieldValue.delete(),
        refreshLockUntilMs: FieldValue.delete(),
      }).catch(() => undefined);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        "failed-precondition",
        "Could not refresh CRM authorization. Reconnect your account.",
      );
    }
  }
  throw new HttpsError("deadline-exceeded", "CRM authorization refresh is still in progress. Retry shortly.");
}

async function callHighLevel(options: {
  uid: string;
  path: string;
  version: string;
  query?: URLSearchParams;
  method?: "GET" | "POST" | "PUT";
  body?: Record<string, unknown>;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
}): Promise<unknown> {
  const token = await getHighLevelAccessToken(options);
  const url = new URL(HL_API + options.path);
  if (options.query) url.search = options.query.toString();
  const startedAt = Date.now();
  const resource = ["contacts", "conversations", "calendars"].find((name) => options.path.startsWith("/" + name + "/")) ?? "other";
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: "Bearer " + token.accessToken,
        Accept: "application/json",
        Version: options.version,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    logger.warn("crm.request_failed", { resource, method: options.method ?? "GET", durationMs: Date.now() - startedAt });
    throw error;
  }
  logger.info("crm.request", {
    resource, method: options.method ?? "GET", status: response.status, durationMs: Date.now() - startedAt,
  });
  if (!response.ok) {
    let validationMessage = "";
    if (response.status === 400 || response.status === 422) {
      try {
        const body: unknown = await response.json();
        if (typeof body === "object" && body !== null && "message" in body) {
          const raw = (body as { message?: unknown }).message;
          const message = typeof raw === "string" ? raw : Array.isArray(raw)
            ? raw.filter((item): item is string => typeof item === "string").join("; ") : "";
          validationMessage = message
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
            .replace(/\+?\d[\d ()-]{7,}\d/g, "[number]")
            .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
            .replace(/[\r\n\t]+/g, " ")
            .replace(/[<>]/g, "")
            .slice(0, 300).trim();
        }
      } catch { /* An invalid error payload is handled with a generic message. */ }
    }
    throw new HighLevelApiError(
      validationMessage ? "CRM rejected the request: " + validationMessage : response.status === 401
        ? "CRM authorization was rejected. Reconnect your account."
        : response.status === 429
          ? "The CRM request limit was reached. Retry in a moment."
          : "CRM data could not be loaded (HTTP " + response.status + ").",
      response.status,
    );
  }
  return response.json();
}

export async function getHighLevelConnection(uid: string) {
  const snapshot = await integrationRef(uid).get();
  if (!snapshot.exists) return { connected: false as const };
  const data = snapshot.data() as StoredIntegration;
  return {
    connected: true as const,
    locationId: data.locationId,
    locationName: data.locationName ?? data.locationId,
  };
}

export async function disconnectHighLevel(uid: string) {
  await integrationRef(uid).delete();
}

async function verifyCalendarLocation(options: {
  uid: string; calendarId: string; locationId: string; clientId: string; clientSecret: string; encryptionKey: string;
}): Promise<void> {
  const result = await callHighLevel({
    uid: options.uid, path: "/calendars/", version: "2021-04-15",
    query: new URLSearchParams({ locationId: options.locationId }),
    clientId: options.clientId, clientSecret: options.clientSecret, encryptionKey: options.encryptionKey,
  }) as { calendars?: Array<{ id?: unknown }> };
  if (!Array.isArray(result.calendars)) throw new HttpsError("unavailable", "The CRM returned an invalid calendar list.");
  if (!result.calendars.some((calendar) => calendar.id === options.calendarId)) {
    throw new HttpsError("permission-denied", "The selected calendar is not in this connected account.");
  }
}

export async function getHighLevelData(options: {
  uid: string;
  projectId: string;
  kind: "contacts" | "contact" | "conversations" | "messages" | "calendars" | "appointments" | "availability";
  query?: string;
  contactId?: string;
  conversationId?: string;
  calendarId?: string;
  startDate?: number;
  endDate?: number;
  timezone?: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
}): Promise<unknown> {
  const projectId = projectIdSchema.parse(options.projectId);
  const projectRef = db.doc("users/" + options.uid + "/projects/" + projectId);
  const project = await projectRef.get();
  if (!project.exists || project.data()?.deletedAt) {
    throw new HttpsError("not-found", "Project not found.");
  }
  const token = await getHighLevelAccessToken({
    uid: options.uid,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    encryptionKey: options.encryptionKey,
  });
  if (project.data()?.highLevelLocationId !== token.locationId) {
    throw new HttpsError(
      "failed-precondition",
      "This project is linked to another business account. Update the project connection.",
    );
  }

  const query = new URLSearchParams();
  query.set("locationId", token.locationId);
  if (options.kind === "contact") {
    if (!options.contactId || !/^[A-Za-z0-9_-]{1,128}$/.test(options.contactId)) {
      throw new HttpsError("invalid-argument", "A valid contact ID is required.");
    }
    const result = await callHighLevel({
      uid: options.uid,
      path: "/contacts/" + encodeURIComponent(options.contactId),
      version: "2021-07-28",
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      encryptionKey: options.encryptionKey,
    }) as { contact?: { locationId?: string } };
    if (result.contact?.locationId !== token.locationId) {
      throw new HttpsError("permission-denied", "The selected contact is not in this connected account.");
    }
    return result;
  }
  if (options.kind === "contacts") {
    return callHighLevel({
      uid: options.uid,
      path: "/contacts/search",
      version: "2021-07-28",
      method: "POST",
      body: {
        locationId: token.locationId,
        page: 1,
        pageLimit: 20,
        ...(options.query?.trim() ? { query: options.query.trim().slice(0, 100) } : {}),
      },
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      encryptionKey: options.encryptionKey,
    });
  }
  if (options.kind === "conversations") {
    query.set("limit", "20");
    return callHighLevel({
      uid: options.uid,
      path: "/conversations/search",
      version: "2021-04-15",
      query,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      encryptionKey: options.encryptionKey,
    });
  }
  if (options.kind === "messages") {
    if (!options.conversationId || !/^[A-Za-z0-9_-]{1,128}$/.test(options.conversationId)) {
      throw new HttpsError("invalid-argument", "A valid conversation ID is required.");
    }
    const conversationResult = await callHighLevel({
      uid: options.uid,
      path: "/conversations/" + encodeURIComponent(options.conversationId),
      version: "2021-04-15",
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      encryptionKey: options.encryptionKey,
    }) as { locationId?: string; conversation?: { locationId?: string } };
    const conversationLocation = conversationResult.conversation?.locationId ?? conversationResult.locationId;
    if (conversationLocation !== token.locationId) {
      throw new HttpsError("permission-denied", "The selected conversation is not in this connected account.");
    }
    query.delete("locationId");
    query.set("limit", "20");
    return callHighLevel({
      uid: options.uid,
      path: "/conversations/" + encodeURIComponent(options.conversationId) + "/messages",
      version: "2021-04-15",
      query,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      encryptionKey: options.encryptionKey,
    });
  }
  if (options.kind === "calendars") {
    return callHighLevel({
      uid: options.uid,
      path: "/calendars/",
      version: "2021-04-15",
      query,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      encryptionKey: options.encryptionKey,
    });
  }

  if (options.kind === "availability") {
    if (
      !options.calendarId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(options.calendarId) ||
      !Number.isSafeInteger(options.startDate) ||
      !Number.isSafeInteger(options.endDate) ||
      !options.startDate ||
      !options.endDate ||
      options.endDate <= options.startDate ||
      options.endDate - options.startDate > 31 * 24 * 60 * 60 * 1000
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A calendar ID and a valid date range of 31 days or less are required.",
      );
    }
    await verifyCalendarLocation({
      uid: options.uid, calendarId: options.calendarId, locationId: token.locationId,
      clientId: options.clientId, clientSecret: options.clientSecret, encryptionKey: options.encryptionKey,
    });
    const availabilityQuery = new URLSearchParams({
      startDate: String(options.startDate),
      endDate: String(options.endDate),
    });
    if (options.timezone?.trim()) {
      availabilityQuery.set("timezone", options.timezone.trim().slice(0, 64));
    }
    return callHighLevel({
      uid: options.uid,
      path: "/calendars/" + encodeURIComponent(options.calendarId) + "/free-slots",
      version: "2021-04-15",
      query: availabilityQuery,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      encryptionKey: options.encryptionKey,
    });
  }

  const calendarResponse = await callHighLevel({
    uid: options.uid,
    path: "/calendars/",
    version: "2021-04-15",
    query,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    encryptionKey: options.encryptionKey,
  }) as { calendars?: Array<{ id?: unknown }> };
  if (!Array.isArray(calendarResponse.calendars)) {
    throw new HttpsError("unavailable", "The CRM returned an invalid calendar list.");
  }
  const calendarIds = calendarResponse.calendars
    .map((calendar) => calendar.id)
    .filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id));
  const requestedIds = options.calendarId
    ? calendarIds.filter((id) => id === options.calendarId)
    : calendarIds.slice(0, 20);
  if (options.calendarId && requestedIds.length === 0) {
    throw new HttpsError("permission-denied", "The selected calendar is not in this connected account.");
  }
  const now = Date.now();
  const startTime = options.startDate ?? now;
  const endTime = options.endDate ?? (startTime + 30 * 24 * 60 * 60 * 1000);
  if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) ||
    endTime <= startTime || endTime - startTime > 31 * 24 * 60 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "A valid appointment date range of 31 days or less is required.");
  }
  const results = await Promise.all(requestedIds.map(async (calendarId) => {
    const eventQuery = new URLSearchParams({
      locationId: token.locationId,
      calendarId,
      startTime: String(startTime),
      endTime: String(endTime),
    });
    return callHighLevel({
      uid: options.uid,
      path: "/calendars/events",
      version: "2021-04-15",
      query: eventQuery,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      encryptionKey: options.encryptionKey,
    }) as Promise<{ events?: unknown[] }>;
  }));
  if (results.some((result) => !Array.isArray(result.events))) {
    throw new HttpsError("unavailable", "The CRM returned an invalid appointment list.");
  }
  return {
    events: results.flatMap((result) => result.events ?? []),
    truncated: !options.calendarId && calendarIds.length > requestedIds.length,
  };
}

export type HighLevelWriteInput =
  | {
      action: "createContact";
      contact: Record<string, unknown>;
    }
  | {
      action: "updateContact";
      contactId: string;
      changes: Record<string, unknown>;
    }
  | {
      action: "createAppointment";
      contactId: string;
      calendarId: string;
      title: string;
      startTime: string;
      endTime?: string;
    }
  | {
      action: "sendMessage";
      contactId: string;
      type: "SMS" | "Email";
      message: string;
      subject?: string;
    };

async function verifyContactLocation(options: {
  uid: string;
  contactId: string;
  locationId: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
}): Promise<void> {
  const result = await callHighLevel({
    uid: options.uid,
    path: "/contacts/" + encodeURIComponent(options.contactId),
    version: "2021-07-28",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    encryptionKey: options.encryptionKey,
  }) as { contact?: { locationId?: string } };
  if (result.contact?.locationId !== options.locationId) {
    throw new HttpsError("permission-denied", "The selected contact is not in this connected account.");
  }
}

async function recordHighLevelWrite(options: {
  uid: string;
  projectId: string;
  action: HighLevelWriteInput["action"];
  outcome: "succeeded" | "failed";
  resourceId?: string;
}): Promise<void> {
  // Keep audit metadata free of contact details and message contents.
  const retentionMs = 90 * 24 * 60 * 60 * 1000;
  await db
    .collection("users/" + options.uid + "/projects/" + options.projectId + "/crmActionLogs")
    .add({
      action: options.action,
      outcome: options.outcome,
      ...(options.resourceId ? { resourceId: options.resourceId } : {}),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + retentionMs),
    });
}

export async function executeHighLevelWrite(options: {
  uid: string;
  projectId: string;
  input: HighLevelWriteInput;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
}): Promise<unknown> {
  const projectId = projectIdSchema.parse(options.projectId);
  const projectRef = db.doc("users/" + options.uid + "/projects/" + projectId);
  const project = await projectRef.get();
  if (!project.exists || project.data()?.deletedAt) {
    throw new HttpsError("not-found", "Project not found.");
  }
  const token = await getHighLevelAccessToken({
    uid: options.uid,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    encryptionKey: options.encryptionKey,
  });
  if (project.data()?.highLevelLocationId !== token.locationId) {
    throw new HttpsError(
      "failed-precondition",
      "This project is linked to another business account. Update the project connection.",
    );
  }

  try {
    let result: unknown;
    if (options.input.action === "createContact") {
      result = await callHighLevel({
        uid: options.uid,
        path: "/contacts/",
        version: "2021-07-28",
        method: "POST",
        body: { ...options.input.contact, locationId: token.locationId },
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        encryptionKey: options.encryptionKey,
      });
    } else if (options.input.action === "updateContact") {
      await verifyContactLocation({
        uid: options.uid,
        contactId: options.input.contactId,
        locationId: token.locationId,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        encryptionKey: options.encryptionKey,
      });
      result = await callHighLevel({
        uid: options.uid,
        path: "/contacts/" + encodeURIComponent(options.input.contactId),
        version: "2021-07-28",
        method: "PUT",
        body: options.input.changes,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        encryptionKey: options.encryptionKey,
      });
    } else if (options.input.action === "createAppointment") {
      await verifyContactLocation({
        uid: options.uid, contactId: options.input.contactId, locationId: token.locationId,
        clientId: options.clientId, clientSecret: options.clientSecret, encryptionKey: options.encryptionKey,
      });
      await verifyCalendarLocation({
        uid: options.uid, calendarId: options.input.calendarId, locationId: token.locationId,
        clientId: options.clientId, clientSecret: options.clientSecret, encryptionKey: options.encryptionKey,
      });
      result = await callHighLevel({
        uid: options.uid, path: "/calendars/events/appointments", version: "2021-04-15", method: "POST",
        body: { calendarId: options.input.calendarId, contactId: options.input.contactId,
          locationId: token.locationId, title: options.input.title, startTime: options.input.startTime,
          ...(options.input.endTime ? { endTime: options.input.endTime } : {}) },
        clientId: options.clientId, clientSecret: options.clientSecret, encryptionKey: options.encryptionKey,
      });
    } else {
      await verifyContactLocation({
        uid: options.uid,
        contactId: options.input.contactId,
        locationId: token.locationId,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        encryptionKey: options.encryptionKey,
      });
      result = await callHighLevel({
        uid: options.uid,
        path: "/conversations/messages",
        version: "2021-04-15",
        method: "POST",
        body: {
          type: options.input.type,
          contactId: options.input.contactId,
          message: options.input.message,
          ...(options.input.type === "Email" ? {
            html: options.input.message
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\r?\n/g, "<br>"),
          } : {}),
          ...(options.input.subject ? { subject: options.input.subject } : {}),
          status: "pending",
        },
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        encryptionKey: options.encryptionKey,
      });
    }
    const candidateResourceId = options.input.action === "createContact"
      ? (result as { contact?: { id?: unknown } } | null)?.contact?.id
      : options.input.contactId;
    await recordHighLevelWrite({
      uid: options.uid,
      projectId,
      action: options.input.action,
      outcome: "succeeded",
      resourceId: typeof candidateResourceId === "string" ? candidateResourceId : undefined,
    }).catch(() => undefined);
    return result;
  } catch (error) {
    await recordHighLevelWrite({
      uid: options.uid,
      projectId,
      action: options.input.action,
      outcome: "failed",
      resourceId: options.input.action === "createContact" ? undefined : options.input.contactId,
    }).catch(() => undefined);
    throw error;
  }
}

export async function verifyProjectLocation(
  uid: string,
  projectId: string,
  locationId: string,
): Promise<void> {
  const projectRef = db.doc(
    "users/" + uid + "/projects/" + projectIdSchema.parse(projectId),
  );
  await db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectRef);
    if (!project.exists || project.data()?.deletedAt) {
      throw new HttpsError("not-found", "Project not found.");
    }
    transaction.update(projectRef, {
      highLevelLocationId: locationId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
