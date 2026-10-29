import { initializeApp } from "firebase/app";
import { getToken as getAppCheckToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
if (missing.length > 0) {
  console.warn("Firebase client configuration is incomplete:", missing.join(", "));
}

export const firebaseApp = initializeApp(config);
export const auth = getAuth(firebaseApp);
export const functions = getFunctions(
  firebaseApp,
  import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1",
);

const emulators = import.meta.env.VITE_FIREBASE_EMULATORS === "true";
if (emulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
let appCheckInstance: AppCheck | undefined;
if (appCheckSiteKey) {
  appCheckInstance = initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export async function getAppCheckRequestToken(): Promise<string | undefined> {
  if (!appCheckInstance) return undefined;
  return (await getAppCheckToken(appCheckInstance)).token;
}
