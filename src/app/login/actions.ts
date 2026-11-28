"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { User } from "@/db/schema";
import {
  endSession,
  getPendingLogin,
  nextLoginPath,
  setPendingLogin,
  startSession,
} from "@/lib/auth/session";
import { signSetupProof, verifySetupProof } from "@/lib/auth/token";
import { bootstrapProblems, changeOwnPassword, checkLogin, checkLoginCode, confirmTotpSetup } from "@/lib/auth/users";

export type FormState = { error?: string };

const EXPIRED = "Your login took too long. Please start again.";

/** After the code step: finish logging in, or go on to choose a new password. */
async function continueAfterCode(user: User): Promise<never> {
  await setPendingLogin(user, true);
  const next = nextLoginPath(user, true);
  if (next !== "/login/new-password") await startSession(user);
  redirect(next);
}

function lockedMessage(minutes?: number) {
  return `Too many wrong tries. Try again in ${minutes ?? 15} minutes.`;
}

/** Step 1: username and password. */
export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password." };

  const result = await checkLogin(getDb(), username, password);
  if (!result.ok) {
    if (result.reason === "locked") return { error: lockedMessage(result.minutesLeft) };
    if (result.reason === "disabled") return { error: "This login has been turned off. Ask the admin." };
    if (result.reason === "setup-needed") {
      return {
        error: `The app is not set up yet. In Vercel's Environment Variables: ${bootstrapProblems().join(" ")} Then redeploy. See SETUP.md.`,
      };
    }
    return { error: "That username and password do not match." };
  }
  await setPendingLogin(result.user, false);
  redirect("/login/code");
}

/** Step 2: the 6 digit code from the authenticator app, or a backup code. */
export async function submitCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const pending = await getPendingLogin();
  if (!pending) return { error: EXPIRED };
  const code = String(formData.get("code") ?? "");
  if (!code.trim()) return { error: "Enter the code from your authenticator app." };
  const result = await checkLoginCode(getDb(), pending.user.id, code);
  if (!result.ok) {
    if (result.reason === "locked") return { error: lockedMessage(result.minutesLeft) };
    return { error: "That code is not right. Codes change every 30 seconds, so use the newest one." };
  }
  return continueAfterCode(pending.user);
}

export type SetupState = { error?: string; recoveryCodes?: string[]; proof?: string };

/** First login: confirm the authenticator app works. Returns backup codes to save. */
export async function confirmSetup(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const pending = await getPendingLogin();
  if (!pending) return { error: EXPIRED };
  const result = await confirmTotpSetup(getDb(), pending.user.id, String(formData.get("code") ?? ""));
  if (!result.ok) {
    if (result.reason === "locked") return { error: lockedMessage(result.minutesLeft) };
    if (result.reason === "already-set-up") redirect("/login/code");
    return { error: "That code is not right. Check the app shows RB Collections FBA and type the newest code." };
  }
  // No cookie is set here: that would reload the page before the codes are saved.
  const proof = await signSetupProof({ userId: pending.user.id, v: pending.user.sessionVersion });
  return { recoveryCodes: result.recoveryCodes, proof };
}

/** After saving backup codes. The proof shows this browser confirmed the code a moment ago. */
export async function finishSetup(formData: FormData): Promise<void> {
  const pending = await getPendingLogin();
  const proof = await verifySetupProof(String(formData.get("proof") ?? ""));
  if (!pending || !proof || proof.userId !== pending.user.id || proof.v !== pending.user.sessionVersion) {
    redirect("/login");
  }
  await continueAfterCode(pending.user);
}

/** Step 3, when needed: choose a new password (first login, or every 365 days). */
export async function chooseNewPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const pending = await getPendingLogin();
  if (!pending || !pending.mfa) return { error: EXPIRED };
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match." };
  const result = await changeOwnPassword(getDb(), pending.user.id, password);
  if (!result.ok) return { error: result.error };
  await startSession(result.user);
  redirect(nextLoginPath(result.user, true));
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
