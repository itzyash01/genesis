import { randomBytes, randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./admin.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { hashToken, projectIdSchema } from "./validation.js";
import { HttpsError } from "firebase-functions/v2/https";

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
      "HighLevel OAuth is not configured. Add HL_CLIENT_ID and HL_REDIRECT_URI.",
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
      "HighLevel returned an incomplete authorization response.",
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
      "HighLevel authorization could not be completed. Check the app credentials and redirect URI.",
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
      "Choose one HighLevel location when installing the app.",
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
      "HighLevel authorization expired. Reconnect your location.",
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
      throw new HttpsError("failed-precondition", "Connect a HighLevel location first.");
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
      throw new HttpsError("failed-precondition", "Connect a HighLevel location first.");
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
        "Could not refresh HighLevel authorization. Reconnect your location.",
      );
    }
  }
  throw new HttpsError("deadline-exceeded", "HighLevel token refresh is still in progress. Retry shortly.");
}

async function callHighLevel(options: {
  uid: string;
  path: string;
  version: string;
  query?: URLSearchParams;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
}): Promise<unknown> {
  const token = await getHighLevelAccessToken(options);
  const url = new URL(HL_API + options.path);
  if (options.query) url.search = options.query.toString();
  const response = await fetch(url, {
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
  if (!response.ok) {
    throw new HighLevelApiError(
      response.status === 401
        ? "HighLevel authorization was rejected. Reconnect the location."
        : response.status === 429
          ? "HighLevel rate limit reached. Retry in a moment."
          : "HighLevel could not return this data (HTTP " + response.status + ").",
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

export async function getHighLevelData(options: {
  uid: string;
  projectId: string;
  kind: "contacts" | "conversations" | "messages" | "calendars" | "appointments";
  query?: string;
  conversationId?: string;
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
      "This project is linked to another HighLevel location. Update the project connection.",
    );
  }

  const query = new URLSearchParams();
  query.set("locationId", token.locationId);
  if (options.kind === "contacts") {
    query.set("limit", "20");
    if (options.query?.trim()) query.set("query", options.query.trim().slice(0, 100));
    return callHighLevel({
      uid: options.uid,
      path: "/contacts/",
      version: "2021-07-28",
      query,
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

  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  query.set("startTime", start.toISOString());
  query.set("endTime", end.toISOString());
  query.set("limit", "20");
  return callHighLevel({
    uid: options.uid,
    path: "/calendars/events",
    version: "2021-04-15",
    query,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    encryptionKey: options.encryptionKey,
  });
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
