import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { User } from "@/db/schema";
import { homeFor } from "./access";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from "./token";
import { getUserById } from "./users";

export type CurrentUser = Pick<User, "id" | "username" | "role">;

export async function startSession(user: User): Promise<void> {
  const token = await signSession({ userId: user.id, role: user.role, v: user.sessionVersion });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The logged-in user, checked against the database on every request so a
 * password change signs old sessions out.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await getUserById(getDb(), claims.userId);
  if (!user || user.sessionVersion !== claims.v || user.role !== claims.role) return null;
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
