<script setup lang="ts">
import { ref } from "vue";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { ArrowRight, LoaderCircle, Sparkles } from "@lucide/vue";
import { auth } from "../lib/firebase";
import Button from "./ui/Button.vue";
import Input from "./ui/Input.vue";

const mode = ref<"signin" | "signup">("signin");
const email = ref("");
const password = ref("");
const busy = ref(false);
const error = ref("");
const notice = ref("");

async function submit() {
  error.value = "";
  notice.value = "";
  if (!email.value.trim() || password.value.length < 8) {
    error.value = "Use a valid email and a password with at least 8 characters.";
    return;
  }
  busy.value = true;
  try {
    if (mode.value === "signup") {
      await createUserWithEmailAndPassword(auth, email.value.trim(), password.value);
    } else {
      await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    }
  } catch (cause) {
    const code = cause instanceof Error && "code" in cause ? String(cause.code) : "";
    if (code.includes("email-already-in-use")) error.value = "That email already has an account. Sign in instead.";
    else if (code.includes("invalid-credential") || code.includes("user-not-found")) error.value = "Email or password is incorrect.";
    else if (code.includes("weak-password")) error.value = "Choose a stronger password.";
    else error.value = cause instanceof Error ? cause.message : "Authentication failed.";
  } finally {
    busy.value = false;
  }
}

async function resetPassword() {
  error.value = "";
  notice.value = "";
  if (!email.value.trim()) {
    error.value = "Enter your email first.";
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email.value.trim());
    notice.value = "Password reset instructions were sent if this account exists.";
  } catch {
    error.value = "We could not send the reset email. Check the address and try again.";
  }
}
</script>

<template>
  <main class="min-h-screen overflow-hidden bg-paper">
    <div class="grid min-h-screen lg:grid-cols-[1fr_1fr]">
      <section class="relative flex min-h-[360px] flex-col justify-between overflow-hidden bg-ink px-8 py-8 text-white sm:px-12 lg:px-16 lg:py-12">
        <div class="pointer-events-none absolute -right-20 -top-28 h-[420px] w-[420px] rounded-full border border-white/10" />
        <div class="pointer-events-none absolute -right-4 -top-12 h-[280px] w-[280px] rounded-full border border-white/10" />
        <a
          class="relative flex items-center gap-2.5 font-semibold tracking-tight"
          href="#"
        >
          <img
            src="/genesis-mark.svg"
            alt=""
            class="h-9 w-9 rounded-xl"
          >
          <span>genesis</span>
        </a>
        <div class="relative max-w-lg py-10">
          <div class="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70">
            <Sparkles
              :size="13"
              class="text-emerald-300"
            /> AI workspace for your CRM
          </div>
          <h1 class="text-4xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-5xl">
            Turn your workflow into an app.
          </h1>
          <p class="mt-5 max-w-md text-sm leading-7 text-white/60">
            Describe what your team needs. Genesis builds a working app connected to your CRM account.
          </p>
          <div class="mt-10 flex items-center gap-2 text-xs text-white/45">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Secure workspace · Real CRM data · Versioned code
          </div>
        </div>
        <p class="relative text-xs text-white/35">
          Genesis App Builder · Private by design
        </p>
      </section>

      <section class="flex items-center justify-center px-6 py-12">
        <div class="w-full max-w-[390px]">
          <div class="mb-8">
            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              Welcome
            </p>
            <h2 class="mt-2 text-2xl font-semibold tracking-tight text-ink">
              {{ mode === "signin" ? "Sign in to Genesis" : "Create your workspace" }}
            </h2>
            <p class="mt-2 text-sm text-slate-500">
              {{ mode === "signin" ? "Pick up where your next app begins." : "Start building with your CRM account." }}
            </p>
          </div>
          <form
            class="space-y-4"
            @submit.prevent="submit"
          >
            <label class="block space-y-1.5">
              <span class="text-xs font-medium text-slate-600">Email address</span>
              <Input
                v-model="email"
                type="email"
                autocomplete="email"
                placeholder="you@company.com"
              />
            </label>
            <label class="block space-y-1.5">
              <span class="text-xs font-medium text-slate-600">Password</span>
              <Input
                v-model="password"
                type="password"
                :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
                placeholder="At least 8 characters"
              />
            </label>
            <div
              v-if="mode === 'signin'"
              class="flex justify-end"
            >
              <button
                type="button"
                class="text-xs font-medium text-accent hover:underline"
                @click="resetPassword"
              >
                Forgot password?
              </button>
            </div>
            <p
              v-if="error"
              role="alert"
              class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            >
              {{ error }}
            </p>
            <p
              v-if="notice"
              role="status"
              class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
            >
              {{ notice }}
            </p>
            <Button
              type="submit"
              class="w-full"
              :disabled="busy"
            >
              <LoaderCircle
                v-if="busy"
                :size="16"
                class="animate-spin"
              />
              <span>{{ mode === "signin" ? "Sign in" : "Create account" }}</span>
              <ArrowRight
                v-if="!busy"
                :size="16"
              />
            </Button>
          </form>
          <div class="my-6 flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-slate-300">
            <span class="h-px flex-1 bg-line" /> Secure sign-in <span class="h-px flex-1 bg-line" />
          </div>
          <p class="text-center text-sm text-slate-500">
            {{ mode === "signin" ? "New to Genesis?" : "Already have an account?" }}
            <button
              class="ml-1 font-semibold text-accent hover:underline"
              type="button"
              @click="mode = mode === 'signin' ? 'signup' : 'signin'; error = ''; notice = ''"
            >
              {{ mode === "signin" ? "Create an account" : "Sign in" }}
            </button>
          </p>
        </div>
      </section>
    </div>
  </main>
</template>
