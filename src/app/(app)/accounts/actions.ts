"use server";

import { getDb } from "@/db";
import { requireAdmin, startSession } from "@/lib/auth/session";
import { passwordProblem, setPassword } from "@/lib/auth/users";

export type PasswordState = { error?: string; ok?: string };

export async function changePasswordAction(
  userId: number,
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const admin = await requireAdmin();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (password !== confirm) return { error: "The two passwords do not match." };
  const user = await setPassword(getDb(), userId, password);
  if (!user) return { error: "That login no longer exists." };
  // Changing a password signs that login out everywhere. Keep the admin
  // signed in on this device when they change their own password.
  if (user.id === admin.id) await startSession(user);
  return { ok: `Password changed for ${user.username}. Anyone logged in as ${user.username} on another device has been logged out.` };
}
