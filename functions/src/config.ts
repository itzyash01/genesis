import { defineSecret, defineString } from "firebase-functions/params";

export const hlClientSecret = defineSecret("HL_CLIENT_SECRET");
export const tokenEncryptionKey = defineSecret("TOKEN_ENCRYPTION_KEY");
export const groqApiKey = defineSecret("GROQ_API_KEY");

export const hlClientId = defineString("HL_CLIENT_ID", { default: "" });
export const hlRedirectUri = defineString("HL_REDIRECT_URI", { default: "" });
export const hlScopes = defineString("HL_SCOPES", {
  default:
    "contacts.readonly contacts.write conversations.readonly conversations/message.readonly conversations/message.write calendars.readonly calendars/events.readonly locations.readonly",
});
export const groqModel = defineString("GROQ_MODEL", {
  default: "openai/gpt-oss-120b",
});
export const appOrigin = defineString("APP_ORIGIN", { default: "" });
export const allowedOrigins = defineString("ALLOWED_ORIGINS", { default: "" });
