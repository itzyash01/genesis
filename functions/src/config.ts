import { defineSecret, defineString } from "firebase-functions/params";

export const hlClientSecret = defineSecret("HL_CLIENT_SECRET");
export const tokenEncryptionKey = defineSecret("TOKEN_ENCRYPTION_KEY");
export const openAiApiKey = defineSecret("OPENAI_API_KEY");

export const hlClientId = defineString("HL_CLIENT_ID", { default: "" });
export const hlRedirectUri = defineString("HL_REDIRECT_URI", { default: "" });
export const hlScopes = defineString("HL_SCOPES", {
  default:
    "contacts.readonly conversations.readonly conversations/message.readonly calendars.readonly calendars/events.readonly locations.readonly",
});
export const openAiModel = defineString("OPENAI_MODEL", {
  default: "gpt-4.1-mini",
});
export const appOrigin = defineString("APP_ORIGIN", { default: "" });
export const allowedOrigins = defineString("ALLOWED_ORIGINS", { default: "" });
