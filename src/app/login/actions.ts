"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { homeFor } from "@/lib/auth/access";
import { endSession, startSession } from "@/lib/auth/session";
import { checkLogin } from "@/lib/auth/users";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password." };

  const result = await checkLogin(getDb(), username, password);
  if (!result.ok) {
    if (result.reason === "locked") {
      return { error: `Too many wrong passwords. Try again in ${result.minutesLeft} minutes.` };
    }
    if (result.reason === "setup-needed") {
      return {
        error:
          "The app is not set up yet. ADMIN_PASSWORD and STAFF_PASSWORD (10 or more characters each) must be set. See SETUP.md.",
      };
    }
    return { error: "That username and password do not match." };
  }
  await startSession(result.user);
  redirect(homeFor(result.user.role));
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
