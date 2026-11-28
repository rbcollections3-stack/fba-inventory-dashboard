import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { User } from "@/db/schema";
import { homeFor } from "./access";
import {
  PENDING_COOKIE,
  PENDING_MINUTES,
  SESSION_COOKIE,
  SESSION_DAYS,
  signPending,
  signSession,
  verifyPending,
  verifySession,
} from "./token";
import { getUserById, needsNewPassword } from "./users";

export type CurrentUser = Pick<User, "id" | "username" | "role">;

const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/** A user may use the app only with an active login, an authenticator set up and an unexpired password. */
export function isFullyAllowed(user: User, now = new Date()): boolean {
  return !user.disabledAt && !!user.totpEnabledAt && !needsNewPassword(user, now);
}

export async function startSession(user: User): Promise<void> {
  const jar = await cookies();
  jar.delete(PENDING_COOKIE);
  jar.set(SESSION_COOKIE, await signSession({ userId: user.id, role: user.role, v: user.sessionVersion }), {
    ...cookieBase,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(PENDING_COOKIE);
}

export async function setPendingLogin(user: User, mfa: boolean): Promise<void> {
  (await cookies()).set(PENDING_COOKIE, await signPending({ userId: user.id, v: user.sessionVersion, mfa }), {
    ...cookieBase,
    maxAge: PENDING_MINUTES * 60,
  });
}

/** The user part-way through logging in, or null if there is none (or it expired). */
export async function getPendingLogin(): Promise<{ user: User; mfa: boolean } | null> {
  const claims = await verifyPending((await cookies()).get(PENDING_COOKIE)?.value);
  if (!claims) return null;
  const user = await getUserById(getDb(), claims.userId);
  if (!user || user.disabledAt || user.sessionVersion !== claims.v) return null;
  return { user, mfa: claims.mfa };
}

/** Where a half-logged-in user goes next. */
export function nextLoginPath(user: User, mfaDone: boolean): string {
  if (!mfaDone) return "/login/code";
  if (needsNewPassword(user)) return "/login/new-password";
  return homeFor(user.role);
}

/**
 * The logged-in user, checked against the database on every request so a
 * password change, an authenticator reset or turning a login off signs old
 * sessions out.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await getUserById(getDb(), claims.userId);
  if (!user || user.sessionVersion !== claims.v || user.role !== claims.role || !isFullyAllowed(user)) return null;
  return { id: user.id, username: user.username, role: user.role };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For admin-only screens and actions. Staff are sent to their own screen. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect(homeFor(user.role));
  return user;
}
