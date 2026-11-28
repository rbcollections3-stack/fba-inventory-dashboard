"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireAdmin, startSession, type CurrentUser } from "@/lib/auth/session";
import {
  changeOwnPassword,
  createStaffUser,
  getUserById,
  passwordProblem,
  resetTotp,
  setDisabled,
  setPassword,
} from "@/lib/auth/users";

export type AccountState = { error?: string; ok?: string };

/** Admin actions on another login. The admin cannot lock themselves out from here. */
async function otherUser(admin: CurrentUser, userId: number) {
  if (userId === admin.id) return null;
  return getUserById(getDb(), userId);
}

export async function changeMyPasswordAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const admin = await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two new passwords do not match." };
  const result = await changeOwnPassword(getDb(), admin.id, password, {
    currentPassword: String(formData.get("current") ?? ""),
  });
  if (!result.ok) return { error: result.error };
  // Other devices are signed out; keep this one signed in.
  await startSession(result.user);
  return { ok: "Your password has been changed. Any other device you were logged in on has been logged out." };
}

export async function setTemporaryPasswordAction(
  userId: number,
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const admin = await requireAdmin();
  const user = await otherUser(admin, userId);
  if (!user) return { error: "That login cannot be changed here." };
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password, user.username);
  if (problem) return { error: problem };
  await setPassword(getDb(), user.id, password, { mustChange: true });
  revalidatePath("/accounts");
  return {
    ok: `Temporary password set for ${user.username}. They have been logged out and must choose their own password at their next login.`,
  };
}

export async function resetAuthenticatorAction(userId: number): Promise<AccountState> {
  const admin = await requireAdmin();
  const user = await otherUser(admin, userId);
  if (!user) return { error: "That login cannot be changed here." };
  await resetTotp(getDb(), user.id);
  revalidatePath("/accounts");
  return { ok: `${user.username} has been logged out and will set up their authenticator app again at their next login.` };
}

export async function setDisabledAction(userId: number, disabled: boolean): Promise<AccountState> {
  const admin = await requireAdmin();
  const user = await otherUser(admin, userId);
  if (!user || user.role !== "staff") return { error: "That login cannot be changed here." };
  await setDisabled(getDb(), user.id, disabled);
  revalidatePath("/accounts");
  return { ok: disabled ? `${user.username} has been turned off and logged out.` : `${user.username} can log in again.` };
}

export async function addStaffAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  await requireAdmin();
  const result = await createStaffUser(
    getDb(),
    String(formData.get("username") ?? ""),
    String(formData.get("password") ?? ""),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/accounts");
  return {
    ok: `Added ${result.user.username}. Give them the username and temporary password. At their first login they choose their own password and set up an authenticator app.`,
  };
}
